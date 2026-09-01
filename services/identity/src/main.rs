// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{env, net::SocketAddr, sync::Arc};

use identity_bot::{
    DiscordOAuthClient, IdentityRepository, NativeAuthConfig, TelegramInitDataVerifier, api,
};
use teloxide::{
    prelude::*,
    types::{InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo},
};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;
use url::Url;

const MINI_APP_URL: &str = "https://nilx.one/telegram/";
const HELP: &str = "Commands:\n/start — open pub_dress registration\n/whoami — show your identity record\n/recover — explain the current recovery boundary";

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("identity_bot=info")),
        )
        .init();

    let bot_token = env::var("TELOXIDE_TOKEN").expect("TELOXIDE_TOKEN must be configured");
    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://identity.db".to_owned());
    let http_bind = env::var("HTTP_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_owned())
        .parse::<SocketAddr>()
        .expect("HTTP_BIND must be a socket address");
    let init_data_max_age_seconds = env::var("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS")
        .map_or(Ok(300_u64), |value| value.parse::<u64>())
        .expect("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS must be an unsigned integer");
    let native_auth = NativeAuthConfig::new(
        env::var("NATIVE_AUTH_SECRET").expect("NATIVE_AUTH_SECRET must be configured"),
        env::var("PASSWORD_PEPPER").expect("PASSWORD_PEPPER must be configured"),
    )
    .expect("native authentication secrets must satisfy the minimum length");
    let discord_oauth = discord_oauth_from_environment();
    let repository = IdentityRepository::connect(&database_url)
        .await
        .expect("identity database must initialize");
    let bot = Bot::new(bot_token.clone());
    let api = api::router(
        repository.clone(),
        TelegramInitDataVerifier::new(bot_token, init_data_max_age_seconds),
        discord_oauth,
        native_auth,
    );
    let listener = tokio::net::TcpListener::bind(http_bind)
        .await
        .expect("identity HTTP listener must bind");

    info!(%http_bind, "starting Stage 1 identity service");
    let mut dispatcher =
        Dispatcher::builder(bot, Update::filter_message().endpoint(handle_message))
            .dependencies(dptree::deps![Arc::new(repository)])
            .enable_ctrlc_handler()
            .build();

    tokio::select! {
        () = dispatcher.dispatch() => {}
        result = axum::serve(listener, api) => {
            result.expect("identity HTTP server must remain available");
        }
    }
}

fn discord_oauth_from_environment() -> Option<DiscordOAuthClient> {
    let client_id = env::var("DISCORD_CLIENT_ID")
        .ok()
        .filter(|value| !value.is_empty());
    let client_secret = env::var("DISCORD_CLIENT_SECRET")
        .ok()
        .filter(|value| !value.is_empty());

    match (client_id, client_secret) {
        (Some(client_id), Some(client_secret)) => {
            info!("Discord Activity authentication enabled");
            Some(DiscordOAuthClient::new(client_id, client_secret))
        }
        (None, None) => {
            info!("Discord Activity authentication is not configured");
            None
        }
        _ => panic!("DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be configured together"),
    }
}

async fn handle_message(
    bot: Bot,
    message: Message,
    repository: Arc<IdentityRepository>,
) -> ResponseResult<()> {
    if !message.chat.is_private() {
        bot.send_message(
            message.chat.id,
            "Open a private chat with this bot to use 0x1 identity.",
        )
        .await?;
        return Ok(());
    }

    let Some(user) = message.from.as_ref() else {
        return Ok(());
    };
    let Ok(telegram_user_id) = i64::try_from(user.id.0) else {
        error!("Telegram user ID is outside the supported SQLite integer range");
        bot.send_message(
            message.chat.id,
            "Identity registration is unavailable for this account.",
        )
        .await?;
        return Ok(());
    };
    let Some(text) = message.text() else {
        return Ok(());
    };
    let command = text
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .split('@')
        .next()
        .unwrap_or_default();

    match command {
        "/start" => {
            start_registration(&bot, &message, repository.as_ref(), telegram_user_id).await?
        }
        "/whoami" => show_identity(&bot, &message, repository.as_ref(), telegram_user_id).await?,
        "/recover" => {
            bot.send_message(
                message.chat.id,
                "Stage 1 recovery follows your active Telegram sessions and Telegram 2FA. 0x1 does not hold a seed phrase or a separate recovery secret yet.",
            )
            .await?;
        }
        "/help" => {
            bot.send_message(message.chat.id, HELP).await?;
        }
        _ => {
            bot.send_message(message.chat.id, HELP).await?;
        }
    }

    Ok(())
}

async fn start_registration(
    bot: &Bot,
    message: &Message,
    repository: &IdentityRepository,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    match repository.find_by_telegram(telegram_user_id).await {
        Ok(Some(identity)) => {
            bot.send_message(
                message.chat.id,
                format!("You are already registered as {}.", identity.pub_dress),
            )
            .await?;
        }
        Ok(None) => {
            bot.send_message(
                message.chat.id,
                "Open the 0x1 Mini App to choose and register your pub_dress.",
            )
            .reply_markup(registration_keyboard())
            .await?;
        }
        Err(error) => {
            error!(%error, "identity lookup failed");
            bot.send_message(
                message.chat.id,
                "Identity registration is temporarily unavailable.",
            )
            .await?;
        }
    }
    Ok(())
}

fn registration_keyboard() -> InlineKeyboardMarkup {
    let url = Url::parse(MINI_APP_URL).expect("MINI_APP_URL must be a valid URL");
    let button = InlineKeyboardButton::web_app("Open 0x1", WebAppInfo { url });
    InlineKeyboardMarkup::new([[button]])
}

async fn show_identity(
    bot: &Bot,
    message: &Message,
    repository: &IdentityRepository,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    match repository.find_by_telegram(telegram_user_id).await {
        Ok(Some(identity)) => {
            let identity_record = serde_json::json!({
                "pub_dress": identity.pub_dress,
                "identity_providers": [format!("tg:{telegram_user_id}")],
                "stage": "provider-backed"
            });
            bot.send_message(
                message.chat.id,
                serde_json::to_string_pretty(&identity_record)
                    .expect("identity record JSON serialization must succeed"),
            )
            .await?;
        }
        Ok(None) => {
            bot.send_message(message.chat.id, "No identity is registered. Use /start.")
                .await?;
        }
        Err(error) => {
            error!(%error, "identity lookup failed");
            bot.send_message(
                message.chat.id,
                "Identity lookup is temporarily unavailable.",
            )
            .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{MINI_APP_URL, registration_keyboard};

    #[test]
    fn registration_button_opens_the_canonical_mini_app() {
        let keyboard = serde_json::to_value(registration_keyboard())
            .expect("registration keyboard must serialize");

        assert_eq!(
            keyboard,
            json!({
                "inline_keyboard": [[{
                    "text": "Open 0x1",
                    "web_app": { "url": MINI_APP_URL }
                }]]
            })
        );
    }
}

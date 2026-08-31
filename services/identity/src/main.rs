// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{collections::HashSet, env, net::SocketAddr, str::FromStr, sync::Arc};

use identity_bot::{
    IdentityRepository, PubDress, RegistrationOutcome, TelegramInitDataVerifier, api,
};
use teloxide::{prelude::*, types::Message};
use tokio::sync::RwLock;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

type PendingRegistrations = Arc<RwLock<HashSet<i64>>>;

const HELP: &str = "Commands:\n/start — register a pub_dress\n/whoami — show your identity record\n/recover — explain the current recovery boundary";

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
    let repository = IdentityRepository::connect(&database_url)
        .await
        .expect("identity database must initialize");
    let bot = Bot::new(bot_token.clone());
    let api = api::router(
        repository.clone(),
        TelegramInitDataVerifier::new(bot_token, init_data_max_age_seconds),
    );
    let listener = tokio::net::TcpListener::bind(http_bind)
        .await
        .expect("identity HTTP listener must bind");

    info!(%http_bind, "starting Stage 1 identity service");
    let mut dispatcher =
        Dispatcher::builder(bot, Update::filter_message().endpoint(handle_message))
            .dependencies(dptree::deps![
                Arc::new(repository),
                PendingRegistrations::default()
            ])
            .enable_ctrlc_handler()
            .build();

    tokio::select! {
        () = dispatcher.dispatch() => {}
        result = axum::serve(listener, api) => {
            result.expect("identity HTTP server must remain available");
        }
    }
}

async fn handle_message(
    bot: Bot,
    message: Message,
    repository: Arc<IdentityRepository>,
    pending: PendingRegistrations,
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
            start_registration(
                &bot,
                &message,
                repository.as_ref(),
                pending.as_ref(),
                telegram_user_id,
            )
            .await?
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
        value if value.starts_with('/') => {
            bot.send_message(message.chat.id, HELP).await?;
        }
        _ if pending.read().await.contains(&telegram_user_id) => {
            complete_registration(
                &bot,
                &message,
                repository.as_ref(),
                pending.as_ref(),
                telegram_user_id,
                text,
            )
            .await?;
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
    pending: &RwLock<HashSet<i64>>,
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
            pending.write().await.insert(telegram_user_id);
            bot.send_message(
                message.chat.id,
                "Send the pub_dress you want to register: the literal 0x prefix, one lowercase hexadecimal discriminator, then a case-sensitive 2–32-character slug. Registration is final: a pub_dress cannot be renamed in place.",
            )
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

async fn complete_registration(
    bot: &Bot,
    message: &Message,
    repository: &IdentityRepository,
    pending: &RwLock<HashSet<i64>>,
    telegram_user_id: i64,
    candidate: &str,
) -> ResponseResult<()> {
    let Ok(pub_dress) = PubDress::from_str(candidate) else {
        bot.send_message(
            message.chat.id,
            "That value is not a canonical pub_dress. Use the literal 0x prefix, one lowercase hexadecimal discriminator, and a case-sensitive 2–32-character slug without spaces.",
        )
        .await?;
        return Ok(());
    };

    match repository.register(&pub_dress, telegram_user_id).await {
        Ok(RegistrationOutcome::Registered(identity)) => {
            pending.write().await.remove(&telegram_user_id);
            bot.send_message(
                message.chat.id,
                format!("Registered: {}", identity.pub_dress),
            )
            .await?;
        }
        Ok(RegistrationOutcome::AlreadyRegistered(identity)) => {
            pending.write().await.remove(&telegram_user_id);
            bot.send_message(
                message.chat.id,
                format!("You are already registered as {}.", identity.pub_dress),
            )
            .await?;
        }
        Ok(RegistrationOutcome::HandleUnavailable) => {
            bot.send_message(
                message.chat.id,
                "That pub_dress cannot be registered. Send another canonical pub_dress.",
            )
            .await?;
        }
        Err(error) => {
            error!(%error, "identity registration failed");
            bot.send_message(
                message.chat.id,
                "Identity registration is temporarily unavailable.",
            )
            .await?;
        }
    }
    Ok(())
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
                "identity_providers": [format!("tg:{}", identity.telegram_user_id)],
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

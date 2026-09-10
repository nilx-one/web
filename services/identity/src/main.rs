// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    env,
    net::SocketAddr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use identity_bot::{
    BondAccessRole, BondLocation, BondLocationMode, BondLocationRepository, BrowserOAuthConfig,
    DecimalU64, DiscordOAuthClient, GeoCoordinate, IdentityRecord, IdentityRepository,
    NativeAuthConfig, OAuthClientCredentials, PendingLocationIntent, ProviderLinkRepository,
    TelegramInitDataVerifier, TelegramLocationIntents, api, browser_web_auth,
    location_control_router, public_api, role_for_pub_dress,
};
use teloxide::{
    prelude::*,
    types::{
        ButtonRequest, InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, KeyboardMarkup,
        Message, WebAppInfo,
    },
};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;
use url::Url;

const MINI_APP_URL: &str = "https://nilx.one/telegram/";
const DEFAULT_PUBLIC_ORIGIN: &str = "https://nilx.one";
const CURRENT_POSITION_BUTTON: &str = "Поточна позиція";
const SET_POSITION_BUTTON: &str = "Встановити позицію";
const USER_HELP: &str = "Commands:\n/start — open pub_dress registration\n/whoami — show your Bond identity and location\n/current_position — передати поточну позицію й повернути live mode\n/recover — explain the current recovery boundary";
const ADMIN_HELP: &str = "\n/set_position — обрати довільну точку й перейти в manual mode";

#[derive(Clone)]
struct TelegramBotState {
    repository: IdentityRepository,
    locations: BondLocationRepository,
    intents: TelegramLocationIntents,
}

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
    let public_origin = env::var("PUBLIC_ORIGIN")
        .unwrap_or_else(|_| DEFAULT_PUBLIC_ORIGIN.to_owned())
        .parse::<Url>()
        .expect("PUBLIC_ORIGIN must be a valid URL");
    if public_origin.scheme() != "https" || public_origin.host_str().is_none() {
        panic!("PUBLIC_ORIGIN must be an https origin");
    }
    let init_data_max_age_seconds = env::var("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS")
        .map_or(Ok(300_u64), |value| value.parse::<u64>())
        .expect("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS must be an unsigned integer");
    let native_auth = NativeAuthConfig::new(
        env::var("NATIVE_AUTH_SECRET").expect("NATIVE_AUTH_SECRET must be configured"),
        env::var("PASSWORD_PEPPER").expect("PASSWORD_PEPPER must be configured"),
    )
    .expect("native authentication secrets must satisfy the minimum length");

    let telegram_browser_oauth = oauth_credentials_from_environment(
        "TELEGRAM_OIDC_CLIENT_ID",
        "TELEGRAM_OIDC_CLIENT_SECRET",
        "Telegram browser authentication",
    );
    let discord_credentials = oauth_credentials_from_environment(
        "DISCORD_CLIENT_ID",
        "DISCORD_CLIENT_SECRET",
        "Discord authentication",
    );
    let discord_activity_oauth = discord_credentials.as_ref().map(|credentials| {
        DiscordOAuthClient::new(
            credentials.client_id.clone(),
            credentials.client_secret.clone(),
        )
    });

    let repository = IdentityRepository::connect(&database_url)
        .await
        .expect("identity database must initialize");
    repository
        .initialize_avaia_configuration()
        .await
        .expect("Avaia configuration storage must initialize");
    let locations = BondLocationRepository::connect(&database_url)
        .await
        .expect("Bond location storage must initialize");
    let provider_links = ProviderLinkRepository::connect(&database_url)
        .await
        .expect("provider link database connection must initialize");
    let bot = Bot::new(bot_token.clone());
    let provider_api = browser_web_auth::router(
        repository.clone(),
        provider_links,
        native_auth.clone(),
        BrowserOAuthConfig::new(public_origin, telegram_browser_oauth, discord_credentials),
    );
    let public_api = public_api::router(repository.clone());
    let telegram_activity_verifier =
        TelegramInitDataVerifier::new(bot_token, init_data_max_age_seconds);
    let location_api = location_control_router(
        repository.clone(),
        locations.clone(),
        telegram_activity_verifier.clone(),
    );
    let avaia_api = api::avaia_router(
        repository.clone(),
        telegram_activity_verifier.clone(),
        discord_activity_oauth.clone(),
        native_auth.clone(),
    );
    let api = api::router(
        repository.clone(),
        telegram_activity_verifier,
        discord_activity_oauth,
        native_auth,
    )
    .merge(avaia_api)
    .merge(location_api)
    .merge(provider_api)
    .merge(public_api);
    let listener = tokio::net::TcpListener::bind(http_bind)
        .await
        .expect("identity HTTP listener must bind");

    let telegram_state = Arc::new(TelegramBotState {
        repository,
        locations,
        intents: TelegramLocationIntents::default(),
    });

    info!(%http_bind, "starting Stage 1 identity service");
    let mut dispatcher =
        Dispatcher::builder(bot, Update::filter_message().endpoint(handle_message))
            .dependencies(dptree::deps![telegram_state])
            .enable_ctrlc_handler()
            .build();

    tokio::select! {
        () = dispatcher.dispatch() => {}
        result = axum::serve(listener, api) => {
            result.expect("identity HTTP server must remain available");
        }
    }
}

fn oauth_credentials_from_environment(
    client_id_key: &str,
    client_secret_key: &str,
    label: &str,
) -> Option<OAuthClientCredentials> {
    let client_id = env::var(client_id_key)
        .ok()
        .filter(|value| !value.is_empty());
    let client_secret = env::var(client_secret_key)
        .ok()
        .filter(|value| !value.is_empty());

    match (client_id, client_secret) {
        (Some(client_id), Some(client_secret)) => {
            info!(provider = label, "provider authentication enabled");
            Some(OAuthClientCredentials::new(client_id, client_secret))
        }
        (None, None) => {
            info!(
                provider = label,
                "provider authentication is not configured"
            );
            None
        }
        _ => panic!("{client_id_key} and {client_secret_key} must be configured together"),
    }
}

async fn handle_message(
    bot: Bot,
    message: Message,
    state: Arc<TelegramBotState>,
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

    if let Some(location) = message.location() {
        handle_location(
            &bot,
            &message,
            state.as_ref(),
            telegram_user_id,
            location.longitude,
            location.latitude,
        )
        .await?;
        return Ok(());
    }

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
        "/start" => start_registration(&bot, &message, state.as_ref(), telegram_user_id).await?,
        "/whoami" => show_identity(&bot, &message, state.as_ref(), telegram_user_id).await?,
        "/current_position" | CURRENT_POSITION_BUTTON => {
            begin_current_position(&bot, &message, state.as_ref(), telegram_user_id).await?
        }
        "/set_position" | SET_POSITION_BUTTON => {
            begin_manual_position(&bot, &message, state.as_ref(), telegram_user_id).await?
        }
        "/recover" => {
            let role = role_for_telegram(&state.repository, telegram_user_id).await;
            bot.send_message(
                message.chat.id,
                "Stage 1 recovery follows your active Telegram sessions and Telegram 2FA. 0x1 does not hold a seed phrase or a separate recovery secret yet.",
            )
            .reply_markup(control_keyboard(role))
            .await?;
        }
        "/help" => {
            send_help(&bot, &message, state.as_ref(), telegram_user_id).await?;
        }
        _ => {
            send_help(&bot, &message, state.as_ref(), telegram_user_id).await?;
        }
    }

    Ok(())
}

fn role_for_identity(identity: &IdentityRecord) -> BondAccessRole {
    identity
        .pub_dress
        .parse()
        .map_or(BondAccessRole::User, |pub_dress| {
            role_for_pub_dress(&pub_dress)
        })
}

async fn role_for_telegram(
    repository: &IdentityRepository,
    telegram_user_id: i64,
) -> BondAccessRole {
    match repository.find_by_telegram(telegram_user_id).await {
        Ok(Some(identity)) => role_for_identity(&identity),
        Ok(None) => BondAccessRole::User,
        Err(error) => {
            error!(%error, "identity lookup failed while resolving access role");
            BondAccessRole::User
        }
    }
}

async fn registered_identity(
    bot: &Bot,
    message: &Message,
    repository: &IdentityRepository,
    telegram_user_id: i64,
) -> ResponseResult<Option<(IdentityRecord, BondAccessRole)>> {
    match repository.find_by_telegram(telegram_user_id).await {
        Ok(Some(identity)) => {
            let role = role_for_identity(&identity);
            Ok(Some((identity, role)))
        }
        Ok(None) => {
            bot.send_message(message.chat.id, "Спочатку зареєструйте Bond через /start.")
                .await?;
            Ok(None)
        }
        Err(error) => {
            error!(%error, "identity lookup failed for location control");
            bot.send_message(message.chat.id, "Identity lookup тимчасово недоступний.")
                .await?;
            Ok(None)
        }
    }
}

async fn handle_location(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
    longitude: f64,
    latitude: f64,
) -> ResponseResult<()> {
    let Some((identity, role)) =
        registered_identity(bot, message, &state.repository, telegram_user_id).await?
    else {
        return Ok(());
    };

    let Some(intent) = state.intents.consume(telegram_user_id).await else {
        bot.send_message(
            message.chat.id,
            "Спочатку оберіть «Поточна позиція» або, для admin, «Встановити позицію».",
        )
        .reply_markup(control_keyboard(role))
        .await?;
        return Ok(());
    };
    if intent == PendingLocationIntent::Manual && role != BondAccessRole::Admin {
        bot.send_message(
            message.chat.id,
            "Встановлення manual position доступне лише admin.",
        )
        .reply_markup(control_keyboard(BondAccessRole::User))
        .await?;
        return Ok(());
    }

    let coordinate = match GeoCoordinate::from_degrees(longitude, latitude) {
        Ok(coordinate) => coordinate,
        Err(error) => {
            error!(%error, "Telegram supplied an invalid location point");
            bot.send_message(message.chat.id, "Telegram передав некоректну координату.")
                .await?;
            return Ok(());
        }
    };
    let updated_at = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(value) => value.as_secs(),
        Err(_) => {
            bot.send_message(message.chat.id, "Bond location тимчасово недоступний.")
                .await?;
            return Ok(());
        }
    };
    let mode = match intent {
        PendingLocationIntent::Current => BondLocationMode::Live,
        PendingLocationIntent::Manual => BondLocationMode::Manual,
    };
    let location = BondLocation::new(coordinate, mode, DecimalU64::new(updated_at));

    if let Err(error) = state.locations.write(&identity.pub_dress, location).await {
        error!(%error, "Bond location write failed");
        bot.send_message(message.chat.id, "Bond location тимчасово недоступний.")
            .await?;
        return Ok(());
    }

    let acknowledgement = match intent {
        PendingLocationIntent::Current => {
            "Поточну позицію прийнято. Bond.location оновлено; режим: live."
        }
        PendingLocationIntent::Manual => {
            "Позицію встановлено. Bond.location оновлено; режим: manual — device location на карті не використовується."
        }
    };
    bot.send_message(message.chat.id, acknowledgement)
        .reply_markup(control_keyboard(role))
        .await?;
    Ok(())
}

async fn begin_current_position(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    if registered_identity(bot, message, &state.repository, telegram_user_id)
        .await?
        .is_none()
    {
        return Ok(());
    }
    state
        .intents
        .begin(telegram_user_id, PendingLocationIntent::Current)
        .await;
    bot.send_message(
        message.chat.id,
        "Натисніть кнопку нижче: Telegram передасть вашу поточну геолокацію, Bond.location оновиться і режим стане live.",
    )
    .reply_markup(current_position_request_keyboard())
    .await?;
    Ok(())
}

async fn begin_manual_position(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    let Some((_identity, role)) =
        registered_identity(bot, message, &state.repository, telegram_user_id).await?
    else {
        return Ok(());
    };
    if role != BondAccessRole::Admin {
        bot.send_message(
            message.chat.id,
            "Встановлення manual position доступне лише admin.",
        )
        .reply_markup(control_keyboard(BondAccessRole::User))
        .await?;
        return Ok(());
    }
    state
        .intents
        .begin(telegram_user_id, PendingLocationIntent::Manual)
        .await;
    bot.send_message(
        message.chat.id,
        "Відкрийте Telegram Location, оберіть довільну точку на мапі та надішліть її протягом 5 хвилин. Вона стане вашим Bond.location у manual mode.",
    )
    .await?;
    Ok(())
}

async fn send_help(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    let role = role_for_telegram(&state.repository, telegram_user_id).await;
    let help = if role == BondAccessRole::Admin {
        format!("{USER_HELP}{ADMIN_HELP}")
    } else {
        USER_HELP.to_owned()
    };
    bot.send_message(message.chat.id, help)
        .reply_markup(control_keyboard(role))
        .await?;
    Ok(())
}

fn control_keyboard(role: BondAccessRole) -> KeyboardMarkup {
    let keyboard =
        KeyboardMarkup::new([[KeyboardButton::new(CURRENT_POSITION_BUTTON)]]).resize_keyboard();
    if role == BondAccessRole::Admin {
        keyboard.append_row([KeyboardButton::new(SET_POSITION_BUTTON)])
    } else {
        keyboard
    }
}

fn current_position_request_keyboard() -> KeyboardMarkup {
    KeyboardMarkup::new([[
        KeyboardButton::new("Передати поточну позицію").request(ButtonRequest::Location)
    ]])
    .resize_keyboard()
    .one_time_keyboard()
}

async fn start_registration(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    match state.repository.find_by_telegram(telegram_user_id).await {
        Ok(Some(identity)) => {
            let role = role_for_identity(&identity);
            bot.send_message(
                message.chat.id,
                format!("You are already registered as {}.", identity.pub_dress),
            )
            .reply_markup(control_keyboard(role))
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
    state: &TelegramBotState,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    match state.repository.find_by_telegram(telegram_user_id).await {
        Ok(Some(identity)) => {
            let role = role_for_identity(&identity);
            let location = match state.locations.read(&identity.pub_dress).await {
                Ok(location) => location,
                Err(error) => {
                    error!(%error, "Bond location lookup failed");
                    bot.send_message(
                        message.chat.id,
                        "Bond location lookup is temporarily unavailable.",
                    )
                    .await?;
                    return Ok(());
                }
            };
            let identity_record = serde_json::json!({
                "pub_dress": identity.pub_dress,
                "role": role,
                "location": location,
                "identity_providers": [format!("tg:{telegram_user_id}")],
                "stage": "provider-backed"
            });
            bot.send_message(
                message.chat.id,
                serde_json::to_string_pretty(&identity_record)
                    .expect("identity record JSON serialization must succeed"),
            )
            .reply_markup(control_keyboard(role))
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
    use identity_bot::BondAccessRole;
    use serde_json::json;

    use super::{
        MINI_APP_URL, SET_POSITION_BUTTON, control_keyboard, current_position_request_keyboard,
        registration_keyboard,
    };

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

    #[test]
    fn current_position_button_requests_current_location() {
        let keyboard = serde_json::to_value(current_position_request_keyboard())
            .expect("current-position keyboard must serialize");
        assert_eq!(keyboard["keyboard"][0][0]["request_location"], true);
    }

    #[test]
    fn manual_position_control_is_visible_only_to_admins() {
        let user_keyboard =
            serde_json::to_value(control_keyboard(BondAccessRole::User)).expect("user keyboard");
        let admin_keyboard =
            serde_json::to_value(control_keyboard(BondAccessRole::Admin)).expect("admin keyboard");

        assert_eq!(user_keyboard["keyboard"].as_array().map(Vec::len), Some(1));
        assert_eq!(admin_keyboard["keyboard"].as_array().map(Vec::len), Some(2));
        assert_eq!(
            admin_keyboard["keyboard"][1][0]["text"],
            SET_POSITION_BUTTON
        );
    }
}

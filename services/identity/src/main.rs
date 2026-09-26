// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    collections::{HashMap, HashSet},
    env,
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use identity_bot::{
    BondAccessRole, BondLocation, BondLocationMode, BondLocationRepository, BrowserOAuthConfig,
    DecimalU64, DiscordOAuthClient, GeoCoordinate, GithubEvidenceConfig, GithubEvidenceRepository,
    IdentityProvider, IdentityRecord, IdentityRepository, NativeAuthConfig, OAuthClientCredentials,
    PendingLocationIntent, ProviderLinkRepository, ProviderSecretCipher, SelfDisconnectOutcome,
    TelegramInitDataVerifier, TelegramLocationIntents, api, browser_web_auth, github_evidence,
    location_control_router, provider_self_service_router, public_api, role_for_pub_dress,
};
use teloxide::{
    prelude::*,
    types::{
        BotCommand, BotCommandScope, ButtonRequest, InlineKeyboardButton, InlineKeyboardMarkup,
        KeyboardButton, KeyboardMarkup, MenuButton, Message, WebAppInfo,
    },
};
use tokio::sync::Mutex;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;
use url::Url;

const MINI_APP_URL: &str = "https://nilx.one/telegram/";
const DEFAULT_PUBLIC_ORIGIN: &str = "https://nilx.one";
const CURRENT_POSITION_BUTTON: &str = "Поточна позиція";
const SET_POSITION_BUTTON: &str = "Встановити позицію";
const ADMIN_LOCATION_NOTE: &str = "Admin: можна також просто надіслати точку в чат без команди — live location поверне live mode, звичайна (не-live) точка перейде в manual.";

/// Single declaration of a bot command, feeding both the Telegram command
/// menu (`/`, the composer's menu button) and the `/help` text, so the two
/// can never drift apart.
struct CommandSpec {
    command: &'static str,
    description: &'static str,
}

/// Commands every registered user sees — the default Telegram command menu
/// scope, so they show up both when typing `/` and via the composer's menu
/// button in any private chat with the bot.
const USER_COMMANDS: &[CommandSpec] = &[
    CommandSpec {
        command: "open",
        description: "Open 0x1",
    },
    CommandSpec {
        command: "start",
        description: "Open pub_dress registration",
    },
    CommandSpec {
        command: "whoami",
        description: "Show your Bond identity and location",
    },
    CommandSpec {
        command: "current_position",
        description: "Передати поточну позицію й повернути live mode",
    },
    CommandSpec {
        command: "recover",
        description: "Explain the current recovery boundary",
    },
    CommandSpec {
        command: "unlink",
        description: "Від'єднати Telegram від цього Bond",
    },
    CommandSpec {
        command: "help",
        description: "Show available commands",
    },
];

/// Commands that move `Bond.location` into manual mode. These stay off the
/// default menu and are only registered for a chat once its sender resolves
/// to [`BondAccessRole::Admin`], matching the runtime check already made in
/// [`begin_manual_position`].
const ADMIN_ONLY_COMMANDS: &[CommandSpec] = &[CommandSpec {
    command: "set_position",
    description: "Обрати довільну точку й перейти в manual mode",
}];

fn bot_commands(role: BondAccessRole) -> Vec<BotCommand> {
    let mut commands: Vec<BotCommand> = USER_COMMANDS
        .iter()
        .map(|spec| BotCommand::new(spec.command, spec.description))
        .collect();
    if role == BondAccessRole::Admin {
        commands.extend(
            ADMIN_ONLY_COMMANDS
                .iter()
                .map(|spec| BotCommand::new(spec.command, spec.description)),
        );
    }
    commands
}

fn help_text(role: BondAccessRole) -> String {
    let mut lines = vec!["Commands:".to_owned()];
    lines.extend(
        USER_COMMANDS
            .iter()
            .map(|spec| format!("/{} — {}", spec.command, spec.description)),
    );
    if role == BondAccessRole::Admin {
        lines.extend(
            ADMIN_ONLY_COMMANDS
                .iter()
                .map(|spec| format!("/{} — {}", spec.command, spec.description)),
        );
        lines.push(ADMIN_LOCATION_NOTE.to_owned());
    }
    lines.join("\n")
}

const UNLINK_CONFIRMATION_TTL: Duration = Duration::from_secs(5 * 60);

/// Tracks a `/unlink` that is waiting on its `/unlink_confirm`. Detaching
/// Telegram from a Bond is not reversible from inside the chat that just lost
/// access to it, so the bot requires this explicit second step rather than
/// acting on `/unlink` alone — mirroring how [`TelegramLocationIntents`]
/// requires an explicit button/command before consuming a location.
#[derive(Clone, Default)]
struct PendingUnlinkConfirmations(Arc<Mutex<HashMap<i64, Instant>>>);

impl PendingUnlinkConfirmations {
    /// Sweeps every entry past [`UNLINK_CONFIRMATION_TTL`] before recording a
    /// new one. Without this, a `/unlink` that is never followed by
    /// `/unlink_confirm` would leave its entry in the map forever — the TTL
    /// only gates what `consume` accepts, not how long the entry lives.
    async fn begin(&self, telegram_user_id: i64) {
        let mut pending = self.0.lock().await;
        pending.retain(|_, started| started.elapsed() <= UNLINK_CONFIRMATION_TTL);
        pending.insert(telegram_user_id, Instant::now());
    }

    /// Consumes the pending confirmation regardless of its age; the caller
    /// only proceeds when this returns `true`.
    async fn consume(&self, telegram_user_id: i64) -> bool {
        match self.0.lock().await.remove(&telegram_user_id) {
            Some(started) => started.elapsed() <= UNLINK_CONFIRMATION_TTL,
            None => false,
        }
    }
}

#[derive(Clone)]
struct TelegramBotState {
    repository: IdentityRepository,
    locations: BondLocationRepository,
    intents: TelegramLocationIntents,
    provider_links: ProviderLinkRepository,
    pending_unlinks: PendingUnlinkConfirmations,
    /// Chat ids whose command menu has already been scoped to
    /// [`ADMIN_ONLY_COMMANDS`], so a resolved admin only costs one
    /// `setMyCommands` call per chat rather than one per message.
    admin_menu_synced: Arc<Mutex<HashSet<i64>>>,
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
        .unwrap_or_else(|_| "0.0.0.0:1927".to_owned())
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
    let github_browser_oauth = oauth_credentials_from_environment(
        "GITHUB_AUTH_CLIENT_ID",
        "GITHUB_AUTH_CLIENT_SECRET",
        "GitHub browser authentication",
    );
    let github_evidence_oauth = oauth_credentials_from_environment(
        "GITHUB_EVIDENCE_CLIENT_ID",
        "GITHUB_EVIDENCE_CLIENT_SECRET",
        "GitHub evidence connection",
    );
    if github_browser_oauth
        .as_ref()
        .zip(github_evidence_oauth.as_ref())
        .is_some_and(|(auth, evidence)| auth.client_id == evidence.client_id)
    {
        panic!(
            "GitHub browser authentication and evidence access must use different OAuth clients"
        );
    }
    let github_evidence_cipher = ProviderSecretCipher::from_hex_key(
        &env::var("GITHUB_EVIDENCE_ENCRYPTION_KEY")
            .expect("GITHUB_EVIDENCE_ENCRYPTION_KEY must be configured"),
    )
    .expect("GITHUB_EVIDENCE_ENCRYPTION_KEY must be a 32-byte hexadecimal key");
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
    let github_evidence_connections = GithubEvidenceRepository::connect(&database_url)
        .await
        .expect("GitHub evidence database connection must initialize");
    let bot = Bot::new(bot_token.clone());
    bot.set_my_commands(bot_commands(BondAccessRole::User))
        .scope(BotCommandScope::AllPrivateChats)
        .await
        .expect("Telegram command menu must register for private chats");
    bot.set_chat_menu_button()
        .menu_button(MenuButton::Commands)
        .await
        .expect("Telegram default chat menu button must open the command list");
    let provider_api = browser_web_auth::router(
        repository.clone(),
        provider_links.clone(),
        native_auth.clone(),
        BrowserOAuthConfig::new(
            public_origin.clone(),
            telegram_browser_oauth,
            discord_credentials,
            github_browser_oauth,
        ),
    );
    let github_evidence_api = github_evidence::router(
        repository.clone(),
        github_evidence_connections,
        native_auth.clone(),
        GithubEvidenceConfig::new(public_origin, github_evidence_oauth, github_evidence_cipher),
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
        provider_links.clone(),
        telegram_activity_verifier.clone(),
        discord_activity_oauth.clone(),
        native_auth.clone(),
    );
    let provider_self_service_api = provider_self_service_router(
        repository.clone(),
        provider_links.clone(),
        telegram_activity_verifier.clone(),
    );
    let api = api::router(
        repository.clone(),
        provider_links.clone(),
        telegram_activity_verifier,
        discord_activity_oauth,
        native_auth,
    )
    .merge(avaia_api)
    .merge(location_api)
    .merge(provider_api)
    .merge(provider_self_service_api)
    .merge(github_evidence_api)
    .merge(public_api);
    let listener = tokio::net::TcpListener::bind(http_bind)
        .await
        .expect("identity HTTP listener must bind");

    let telegram_state = Arc::new(TelegramBotState {
        repository,
        locations,
        intents: TelegramLocationIntents::default(),
        provider_links,
        pending_unlinks: PendingUnlinkConfirmations::default(),
        admin_menu_synced: Arc::new(Mutex::new(HashSet::new())),
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

    ensure_admin_command_menu(&bot, &message, state.as_ref(), telegram_user_id).await;

    if let Some(location) = shared_point(&message) {
        handle_location(&bot, &message, state.as_ref(), telegram_user_id, location).await?;
        return Ok(());
    }

    let Some(text) = message.text() else {
        return Ok(());
    };

    match command_of(text) {
        "/open" => open_app(&bot, &message).await?,
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
        "/unlink" => begin_unlink(&bot, &message, state.as_ref(), telegram_user_id).await?,
        "/unlink_confirm" => {
            confirm_unlink(&bot, &message, state.as_ref(), telegram_user_id).await?
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

/// The point a message shares, whichever way Telegram packaged it.
///
/// Picking a spot on Telegram's own location sheet sends a plain `Location`,
/// but choosing one of the places it lists under the map — a monument, a
/// park, an address — sends a `Venue` wrapping the same point. Both are the
/// person choosing a point, so both reach [`handle_location`]; a venue is
/// never live, so it always resolves as a one-off point.
fn shared_point(message: &Message) -> Option<&teloxide::types::Location> {
    message
        .location()
        .or_else(|| message.venue().map(|venue| &venue.location))
}

/// Which command a text message is.
///
/// A reply-keyboard button sends its own label as text, and both labels are
/// more than one word, so the whole message is compared against them before
/// it is read as a slash command: taking the first word alone turned
/// «Встановити позицію» into «Встановити», which matched nothing and fell
/// through to `/help`.
fn command_of(text: &str) -> &str {
    let trimmed = text.trim();
    if trimmed == CURRENT_POSITION_BUTTON || trimmed == SET_POSITION_BUTTON {
        return trimmed;
    }
    trimmed
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .split('@')
        .next()
        .unwrap_or_default()
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

/// Keeps this chat's Telegram command menu in sync with the sender's current
/// [`BondAccessRole`]. The first time a chat resolves to
/// [`BondAccessRole::Admin`] it gets a [`BotCommandScope::Chat`] override
/// including [`ADMIN_ONLY_COMMANDS`]; the first time a previously-synced chat
/// resolves back to [`BondAccessRole::User`] (a demoted admin), that override
/// is deleted so the chat falls back to the [`BotCommandScope::AllPrivateChats`]
/// default registered at startup — otherwise a demoted admin would keep
/// seeing `/set_position`, the command that puts `Bond.location` into manual
/// mode, in both the `/` autocomplete and the composer's menu button even
/// though the runtime role check in `begin_manual_position` already rejects
/// the write. Chats that were never synced, and stay `User`, never call the
/// Telegram API at all.
async fn ensure_admin_command_menu(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
) {
    let role = role_for_telegram(&state.repository, telegram_user_id).await;
    let chat_id = message.chat.id.0;
    let previously_synced = state.admin_menu_synced.lock().await.contains(&chat_id);

    if role == BondAccessRole::Admin {
        if previously_synced {
            return;
        }
        if let Err(error) = bot
            .set_my_commands(bot_commands(BondAccessRole::Admin))
            .scope(BotCommandScope::Chat {
                chat_id: message.chat.id.into(),
            })
            .await
        {
            error!(%error, "failed to scope admin command menu");
            return;
        }
        state.admin_menu_synced.lock().await.insert(chat_id);
        return;
    }

    if !previously_synced {
        return;
    }
    if let Err(error) = bot
        .delete_my_commands()
        .scope(BotCommandScope::Chat {
            chat_id: message.chat.id.into(),
        })
        .await
    {
        error!(%error, "failed to revert command menu after admin demotion");
        return;
    }
    state.admin_menu_synced.lock().await.remove(&chat_id);
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

/// Why [`resolve_location_mode`] would not accept the location as sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocationModeRefusal {
    /// Nothing was pending and the sender cannot fall back to the automatic
    /// admin path, so the location needs an explicit button/command first.
    NoIntent,
    /// A pending or inferred manual write, from a sender who is not admin.
    ManualRequiresAdmin,
}

/// Decides `Bond.location`'s next mode from three facts: whether an explicit
/// button/command already committed to one (`intent`), who is sending
/// (`role`), and whether Telegram itself marked this point a live location
/// (`live`). No I/O here — every caller-visible refusal message stays in
/// `handle_location`, this only says which one applies.
///
/// An explicit intent, once set, always wins and is consumed regardless of
/// what the message turns out to be — that half of the contract is unchanged
/// from the original button-driven flow. What is new is the `None` arm for
/// admin: absent a prior button tap, the location's own `live_period` decides
/// the mode directly, so sending a location in the bot chat is the toggle —
/// live switches `Bond.location` back to live, anything else (a one-off share
/// or a chosen map point) declares manual, the same outcome `/set_position`
/// already produces explicitly.
fn resolve_location_mode(
    intent: Option<PendingLocationIntent>,
    role: BondAccessRole,
    live: bool,
) -> Result<BondLocationMode, LocationModeRefusal> {
    match intent {
        Some(PendingLocationIntent::Current) => Ok(BondLocationMode::Live),
        Some(PendingLocationIntent::Manual) => {
            if role == BondAccessRole::Admin {
                Ok(BondLocationMode::Manual)
            } else {
                Err(LocationModeRefusal::ManualRequiresAdmin)
            }
        }
        None if role == BondAccessRole::Admin => Ok(if live {
            BondLocationMode::Live
        } else {
            BondLocationMode::Manual
        }),
        None => Err(LocationModeRefusal::NoIntent),
    }
}

async fn handle_location(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
    location: &teloxide::types::Location,
) -> ResponseResult<()> {
    let Some((identity, role)) =
        registered_identity(bot, message, &state.repository, telegram_user_id).await?
    else {
        return Ok(());
    };

    let intent = state.intents.consume(telegram_user_id).await;
    let mode = match resolve_location_mode(intent, role, location.live_period.is_some()) {
        Ok(mode) => mode,
        Err(LocationModeRefusal::ManualRequiresAdmin) => {
            bot.send_message(
                message.chat.id,
                "Встановлення manual position доступне лише admin.",
            )
            .reply_markup(control_keyboard(BondAccessRole::User))
            .await?;
            return Ok(());
        }
        Err(LocationModeRefusal::NoIntent) => {
            bot.send_message(
                message.chat.id,
                "Спочатку оберіть «Поточна позиція» або, для admin, «Встановити позицію».",
            )
            .reply_markup(control_keyboard(role))
            .await?;
            return Ok(());
        }
    };

    let coordinate = match GeoCoordinate::from_degrees(location.longitude, location.latitude) {
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
    let location_record = BondLocation::new(coordinate, mode, DecimalU64::new(updated_at));

    if let Err(error) = state
        .locations
        .write(&identity.pub_dress, location_record)
        .await
    {
        error!(%error, "Bond location write failed");
        bot.send_message(message.chat.id, "Bond location тимчасово недоступний.")
            .await?;
        return Ok(());
    }

    let acknowledgement = match mode {
        BondLocationMode::Live => "Поточну позицію прийнято. Bond.location оновлено; режим: live.",
        BondLocationMode::Manual => {
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

/// First step of self-disconnecting this chat's Telegram identity from its
/// Bond. Requires an explicit `/unlink_confirm` within
/// [`UNLINK_CONFIRMATION_TTL`] rather than acting immediately: detaching the
/// host that is sending the command is not reversible from inside this same
/// chat once it loses access to the Bond it was linked to.
async fn begin_unlink(
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
    state.pending_unlinks.begin(telegram_user_id).await;
    bot.send_message(
        message.chat.id,
        "Це від'єднає Telegram від цього Bond: цей чат більше не зможе увійти в нього чи керувати ним. Щоб підтвердити, надішліть /unlink_confirm протягом 5 хвилин.",
    )
    .await?;
    Ok(())
}

/// Second step: performs the actual, atomic self-disconnect only when
/// `/unlink` armed it. [`ProviderLinkRepository::unlink_self_service`]
/// refuses the write when Telegram is this Bond's only way back in — the
/// same guard the Mini App Settings surface's disconnect button relies on.
async fn confirm_unlink(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    if !state.pending_unlinks.consume(telegram_user_id).await {
        bot.send_message(
            message.chat.id,
            "Немає активного запиту на відв'язання. Спочатку надішліть /unlink.",
        )
        .await?;
        return Ok(());
    }
    let Some((identity, _role)) =
        registered_identity(bot, message, &state.repository, telegram_user_id).await?
    else {
        return Ok(());
    };
    let pub_dress = match identity.pub_dress.parse() {
        Ok(value) => value,
        Err(error) => {
            error!(%error, "stored Bond pub_dress is invalid");
            bot.send_message(message.chat.id, "Bond тимчасово недоступний.")
                .await?;
            return Ok(());
        }
    };
    match state
        .provider_links
        .unlink_self_service(&pub_dress, IdentityProvider::Telegram)
        .await
    {
        Ok(SelfDisconnectOutcome::Disconnected) => {
            bot.send_message(
                message.chat.id,
                "Telegram від'єднано від цього Bond. Щоб знову користуватись 0x1 з цього чату, зареєструйте новий Bond через /start або увійдіть іншим прив'язаним способом.",
            )
            .await?;
        }
        Ok(SelfDisconnectOutcome::NotLinked) => {
            bot.send_message(message.chat.id, "Спочатку зареєструйте Bond через /start.")
                .await?;
        }
        Ok(SelfDisconnectOutcome::SoleAccessPath) => {
            bot.send_message(
                message.chat.id,
                "Telegram — єдиний спосіб увійти в цей Bond: немає пароля чи іншого прив'язаного провайдера. Спочатку встановіть пароль або прив'яжіть інший акаунт у 0x1, потім повторіть /unlink.",
            )
            .await?;
        }
        Err(error) => {
            error!(%error, "self-disconnect failed");
            bot.send_message(message.chat.id, "Від'єднання тимчасово недоступне.")
                .await?;
        }
    }
    Ok(())
}

async fn send_help(
    bot: &Bot,
    message: &Message,
    state: &TelegramBotState,
    telegram_user_id: i64,
) -> ResponseResult<()> {
    let role = role_for_telegram(&state.repository, telegram_user_id).await;
    bot.send_message(message.chat.id, help_text(role))
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

/// `/open` — the topmost command in [`USER_COMMANDS`]. Deliberately
/// stateless: no repository lookup, no role check, so it stays available to
/// every chat in every state, including one that never registered.
async fn open_app(bot: &Bot, message: &Message) -> ResponseResult<()> {
    bot.send_message(message.chat.id, "Open 0x1")
        .reply_markup(registration_keyboard())
        .await?;
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
    use identity_bot::{BondAccessRole, BondLocationMode, PendingLocationIntent};
    use serde_json::json;

    use std::time::Duration;

    use super::{
        CURRENT_POSITION_BUTTON, LocationModeRefusal, MINI_APP_URL, PendingUnlinkConfirmations,
        SET_POSITION_BUTTON, bot_commands, command_of, control_keyboard,
        current_position_request_keyboard, help_text, registration_keyboard, resolve_location_mode,
        shared_point,
    };

    #[test]
    fn open_is_the_first_command_for_every_role() {
        assert_eq!(bot_commands(BondAccessRole::User)[0].command, "open");
        assert_eq!(bot_commands(BondAccessRole::Admin)[0].command, "open");
        assert!(help_text(BondAccessRole::User).contains("/open"));
        assert!(help_text(BondAccessRole::Admin).contains("/open"));
    }

    #[test]
    fn unlink_is_registered_and_documented_for_every_role() {
        assert!(
            bot_commands(BondAccessRole::User)
                .iter()
                .any(|c| c.command == "unlink")
        );
        assert!(
            bot_commands(BondAccessRole::Admin)
                .iter()
                .any(|c| c.command == "unlink")
        );
        assert!(help_text(BondAccessRole::User).contains("/unlink"));
        assert!(help_text(BondAccessRole::Admin).contains("/unlink"));
    }

    #[tokio::test]
    async fn unlink_confirmation_is_explicit_single_use_and_expires() {
        let pending = PendingUnlinkConfirmations::default();
        assert!(!pending.consume(7).await, "nothing armed yet");

        pending.begin(7).await;
        assert!(pending.consume(7).await);
        assert!(!pending.consume(7).await, "a confirmation is single-use");

        let expired = PendingUnlinkConfirmations::default();
        expired
            .0
            .lock()
            .await
            .insert(7, std::time::Instant::now() - Duration::from_secs(10 * 60));
        assert!(!expired.consume(7).await, "a stale confirmation must lapse");
    }

    #[tokio::test]
    async fn unlink_confirmation_sweeps_expired_entries_instead_of_leaking_them() {
        let pending = PendingUnlinkConfirmations::default();
        pending
            .0
            .lock()
            .await
            .insert(7, std::time::Instant::now() - Duration::from_secs(10 * 60));

        // A fresh /unlink from anyone must not leave that stale entry behind
        // forever just because its own owner never sent /unlink_confirm.
        pending.begin(8).await;

        assert_eq!(
            pending.0.lock().await.len(),
            1,
            "the expired entry for a different user must be swept, leaving only the new one"
        );
        assert!(pending.consume(8).await);
    }

    #[test]
    fn only_admins_get_set_position_in_the_registered_command_menu() {
        let user_commands = bot_commands(BondAccessRole::User);
        let admin_commands = bot_commands(BondAccessRole::Admin);

        assert!(!user_commands.iter().any(|c| c.command == "set_position"));
        assert!(admin_commands.iter().any(|c| c.command == "set_position"));
        assert_eq!(admin_commands.len(), user_commands.len() + 1);
    }

    #[test]
    fn only_admins_see_set_position_in_help_text() {
        assert!(!help_text(BondAccessRole::User).contains("/set_position"));
        assert!(help_text(BondAccessRole::Admin).contains("/set_position"));
    }

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

    #[test]
    fn an_explicit_intent_always_wins_over_what_was_sent() {
        // The original button-driven contract: once /current_position or
        // /set_position committed to a mode, the location's own live_period
        // is irrelevant — a person can share a static pin after tapping
        // "Поточна позиція" and it still writes live, matching what Telegram
        // actually let them declare that way before this change.
        assert_eq!(
            resolve_location_mode(
                Some(PendingLocationIntent::Current),
                BondAccessRole::User,
                false,
            ),
            Ok(BondLocationMode::Live)
        );
        assert_eq!(
            resolve_location_mode(
                Some(PendingLocationIntent::Current),
                BondAccessRole::User,
                true,
            ),
            Ok(BondLocationMode::Live)
        );
    }

    #[test]
    fn a_pending_manual_intent_still_requires_admin() {
        assert_eq!(
            resolve_location_mode(
                Some(PendingLocationIntent::Manual),
                BondAccessRole::Admin,
                false,
            ),
            Ok(BondLocationMode::Manual)
        );
        assert_eq!(
            resolve_location_mode(
                Some(PendingLocationIntent::Manual),
                BondAccessRole::User,
                false,
            ),
            Err(LocationModeRefusal::ManualRequiresAdmin)
        );
    }

    #[test]
    fn an_admin_sending_a_location_with_no_pending_intent_toggles_by_live_period() {
        // The new behavior this change adds: no button tap needed. A live
        // location switches Bond.location back to live; a plain send —
        // one-off "my current position" or a chosen map point alike —
        // declares manual, exactly what /set_position already produced.
        assert_eq!(
            resolve_location_mode(None, BondAccessRole::Admin, true),
            Ok(BondLocationMode::Live)
        );
        assert_eq!(
            resolve_location_mode(None, BondAccessRole::Admin, false),
            Ok(BondLocationMode::Manual)
        );
    }

    #[test]
    fn a_non_admin_sending_a_location_with_no_pending_intent_is_still_refused() {
        // Regular users keep needing the explicit button/command either way;
        // the automatic toggle is admin-only, same as manual mode always was.
        assert_eq!(
            resolve_location_mode(None, BondAccessRole::User, true),
            Err(LocationModeRefusal::NoIntent)
        );
        assert_eq!(
            resolve_location_mode(None, BondAccessRole::User, false),
            Err(LocationModeRefusal::NoIntent)
        );
    }

    #[test]
    fn keyboard_buttons_resolve_by_their_whole_label() {
        // Both labels are two words; reading only the first word is what
        // sent «Встановити позицію» to /help instead of /set_position.
        assert_eq!(command_of(SET_POSITION_BUTTON), SET_POSITION_BUTTON);
        assert_eq!(command_of(CURRENT_POSITION_BUTTON), CURRENT_POSITION_BUTTON);
        assert_eq!(
            command_of(&format!("  {SET_POSITION_BUTTON}\n")),
            SET_POSITION_BUTTON
        );
        assert_eq!(command_of("/set_position"), "/set_position");
        assert_eq!(command_of("/set_position@nilx_one_bot"), "/set_position");
        assert_eq!(command_of("/start ref"), "/start");
        assert_eq!(command_of("Встановити"), "Встановити");
    }

    fn private_message(media: serde_json::Value) -> teloxide::types::Message {
        let mut message = json!({
            "message_id": 1,
            "date": 1_758_800_000,
            "chat": { "id": 7, "type": "private", "first_name": "sky" },
            "from": { "id": 7, "is_bot": false, "first_name": "sky" },
        });
        message
            .as_object_mut()
            .expect("message object")
            .extend(media.as_object().expect("media object").clone());
        serde_json::from_value(message).expect("valid Telegram message")
    }

    #[test]
    fn a_chosen_place_shares_its_point_like_a_location_does() {
        // Picking «Mother Motherland» from the list under Telegram's map
        // sends a venue, not a location; it is still the point to set.
        let venue = private_message(json!({
            "venue": {
                "location": { "longitude": 30.5630, "latitude": 50.4265 },
                "title": "Mother Motherland",
                "address": "парк Слави",
            },
        }));
        let point = shared_point(&venue).expect("venue point");
        assert!((point.longitude - 30.5630).abs() < 1e-9);
        assert!((point.latitude - 50.4265).abs() < 1e-9);
        assert!(point.live_period.is_none());

        let location = private_message(json!({
            "location": { "longitude": 30.5234, "latitude": 50.4501 },
        }));
        assert!(shared_point(&location).is_some());

        let text = private_message(json!({ "text": "hello" }));
        assert!(shared_point(&text).is_none());
    }
}

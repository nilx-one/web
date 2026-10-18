// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! One Open, one mutable status, and one optional admin inbox per private chat.
//! These are Telegram presentation slots, not BondChain interactions.

use std::{
    collections::HashMap,
    future::{Future, IntoFuture},
    ops::Deref,
    pin::Pin,
    sync::Arc,
};

use identity_bot::{BondAccessRole, IdentityRepository, TelegramMessageSlot};
use teloxide::{
    prelude::*,
    types::{ChatId, InlineKeyboardButton, InlineKeyboardMarkup, MessageId, ReplyMarkup},
};
use tokio::sync::Mutex;
use tracing::error;

use crate::{admin_role_decision_callback_data, registration_keyboard};

#[derive(Clone)]
pub(crate) struct TelegramSurfaces {
    repository: IdentityRepository,
    locks: Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>,
}

impl TelegramSurfaces {
    pub fn new(repository: IdentityRepository) -> Self {
        Self {
            repository,
            locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn lock_for(&self, chat_id: ChatId) -> Arc<Mutex<()>> {
        let mut locks = self.locks.lock().await;
        Arc::clone(
            locks
                .entry(chat_id.0)
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }
}

#[derive(Clone)]
pub(crate) struct CompactBot {
    bot: Bot,
    chat: ChatId,
    surfaces: Arc<TelegramSurfaces>,
}

impl Deref for CompactBot {
    type Target = Bot;

    fn deref(&self) -> &Bot {
        &self.bot
    }
}

impl CompactBot {
    pub fn new(bot: Bot, chat: ChatId, surfaces: Arc<TelegramSurfaces>) -> Self {
        Self {
            bot,
            chat,
            surfaces,
        }
    }

    /// A bot reply always targets its one editable status slot. Return unit
    /// because callers only acknowledge delivery; they never consume the
    /// newly sent Telegram Message object.
    pub fn send_message(&self, _chat: ChatId, text: impl Into<String>) -> CompactMessage {
        CompactMessage {
            bot: self.clone(),
            text: text.into(),
            markup: None,
        }
    }

    async fn ensure_open(&self) -> ResponseResult<()> {
        let saved = self
            .surfaces
            .repository
            .telegram_message_id(self.chat.0, TelegramMessageSlot::Open)
            .await;
        match saved {
            Ok(Some(_)) => return Ok(()),
            Err(error) => {
                error!(%error, "Telegram Open slot lookup failed");
                return Ok(());
            }
            Ok(None) => {}
        }
        let sent = self
            .bot
            .send_message(self.chat, "Open")
            .reply_markup(registration_keyboard())
            .await?;
        if let Err(error) = self
            .surfaces
            .repository
            .save_telegram_message_id(self.chat.0, TelegramMessageSlot::Open, Some(sent.id.0))
            .await
        {
            error!(%error, "Telegram Open slot receipt not persisted");
        }
        Ok(())
    }

    async fn ensure_status(&self) -> ResponseResult<()> {
        match self
            .surfaces
            .repository
            .telegram_message_id(self.chat.0, TelegramMessageSlot::Status)
            .await
        {
            Ok(Some(_)) => Ok(()),
            Ok(None) => {
                self.edit_or_send(
                    TelegramMessageSlot::Status,
                    "0x1 · Готово.".to_owned(),
                    None,
                )
                .await
            }
            Err(error) => {
                error!(%error, "Telegram Status slot lookup failed");
                Ok(())
            }
        }
    }

    async fn edit_or_send(
        &self,
        slot: TelegramMessageSlot,
        text: String,
        inline: Option<InlineKeyboardMarkup>,
    ) -> ResponseResult<()> {
        let saved = match self
            .surfaces
            .repository
            .telegram_message_id(self.chat.0, slot)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                error!(%error, "Telegram message slot lookup failed; refusing duplicate send");
                return Ok(());
            }
        };
        if let Some(message_id) = saved {
            let request =
                self.bot
                    .edit_message_text(self.chat, MessageId(message_id), text.clone());
            let edit = match inline.clone() {
                Some(markup) => request.reply_markup(markup).await,
                None => request.await,
            };
            match edit {
                Ok(_) => return Ok(()),
                Err(error)
                    if error
                        .to_string()
                        .to_ascii_lowercase()
                        .contains("message is not modified") =>
                {
                    return Ok(());
                }
                Err(error)
                    if error
                        .to_string()
                        .to_ascii_lowercase()
                        .contains("message to edit not found") =>
                {
                    // Only replace a slot when Telegram confirms the old
                    // message is gone. Network/permission/rate-limit failures
                    // must NOT create a duplicate message.
                }
                Err(error) => return Err(error),
            }
        }
        let request = self.bot.send_message(self.chat, text);
        let sent = match inline {
            Some(markup) => request.reply_markup(markup).await?,
            None => request.await?,
        };
        if let Err(error) = self
            .surfaces
            .repository
            .save_telegram_message_id(self.chat.0, slot, Some(sent.id.0))
            .await
        {
            error!(%error, "Telegram message slot receipt not persisted");
        }
        Ok(())
    }

    pub async fn status(&self, text: String, markup: Option<ReplyMarkup>) -> ResponseResult<()> {
        let lock = self.surfaces.lock_for(self.chat).await;
        let _guard = lock.lock().await;
        self.ensure_open().await?;
        // Telegram only permits edits without reply markup or with an inline
        // keyboard. ReplyKeyboard requests cannot be attached to a mutable
        // slot; location is shared with Telegram's native attachment picker.
        let inline = match markup {
            Some(ReplyMarkup::InlineKeyboard(keyboard)) => Some(keyboard),
            _ => None,
        };
        self.edit_or_send(TelegramMessageSlot::Status, text, inline)
            .await
    }

    /// Refresh only when the stored Telegram binding resolves to an actual
    /// admin. Never derive authorization from a pub_dress prefix or callback.
    pub async fn refresh_admin(&self, recent: Option<&str>) -> ResponseResult<()> {
        let identity = match self.surfaces.repository.find_by_telegram(self.chat.0).await {
            Ok(Some(identity)) => identity,
            Ok(None) => {
                self.revoke_admin_slot().await;
                return Ok(());
            }
            Err(error) => {
                error!(%error, "Admin Telegram identity read failed");
                return Ok(());
            }
        };
        match self.surfaces.repository.role_for(&identity.pub_dress).await {
            Ok(BondAccessRole::Admin) => {}
            Ok(_) => {
                self.revoke_admin_slot().await;
                return Ok(());
            }
            Err(error) => {
                error!(%error, "Admin Telegram role read failed");
                return Ok(());
            }
        }
        let inbox = match self.surfaces.repository.telegram_admin_inbox().await {
            Ok(inbox) => inbox,
            Err(error) => {
                error!(%error, "Admin inbox read failed");
                return Ok(());
            }
        };
        let mut text = String::from("🔐 0x1 · Admin");
        if let Some(recent) = recent {
            text.push('\n');
            text.push_str(recent);
        }
        let mut rows = Vec::new();
        if inbox.is_empty() {
            text.push_str("\nНемає запитів, що очікують рішення.");
        } else {
            text.push_str("\nОчікують рішення:");
            for (token, address) in &inbox {
                text.push_str(&format!("\n• {address}"));
                rows.push(vec![
                    InlineKeyboardButton::callback(
                        format!("✅ {address}"),
                        admin_role_decision_callback_data(true, token),
                    ),
                    InlineKeyboardButton::callback(
                        "❌",
                        admin_role_decision_callback_data(false, token),
                    ),
                ]);
            }
        }
        let lock = self.surfaces.lock_for(self.chat).await;
        let _guard = lock.lock().await;
        self.ensure_open().await?;
        self.ensure_status().await?;
        let inline = (!rows.is_empty()).then(|| InlineKeyboardMarkup::new(rows));
        self.edit_or_send(TelegramMessageSlot::Admin, text, inline)
            .await
    }

    async fn revoke_admin_slot(&self) {
        let lock = self.surfaces.lock_for(self.chat).await;
        let _guard = lock.lock().await;
        let Ok(Some(message_id)) = self
            .surfaces
            .repository
            .telegram_message_id(self.chat.0, TelegramMessageSlot::Admin)
            .await
        else {
            return;
        };
        // Removing an old message is limited by Telegram to 48 hours.
        // Redact old admin actions even if the deletion is impossible.
        if self
            .bot
            .delete_message(self.chat, MessageId(message_id))
            .await
            .is_err()
        {
            let _ = self
                .bot
                .edit_message_text(
                    self.chat,
                    MessageId(message_id),
                    "🔒 Доступ admin завершено.",
                )
                .await;
        }
        if let Err(error) = self
            .surfaces
            .repository
            .save_telegram_message_id(self.chat.0, TelegramMessageSlot::Admin, None)
            .await
        {
            error!(%error, "Admin Telegram slot revocation receipt not saved");
        }
    }
}

pub(crate) struct CompactMessage {
    bot: CompactBot,
    text: String,
    markup: Option<ReplyMarkup>,
}

impl CompactMessage {
    pub fn reply_markup(mut self, markup: impl Into<ReplyMarkup>) -> Self {
        self.markup = Some(markup.into());
        self
    }
}

impl IntoFuture for CompactMessage {
    type Output = ResponseResult<()>;
    type IntoFuture = Pin<Box<dyn Future<Output = Self::Output> + Send>>;

    fn into_future(self) -> Self::IntoFuture {
        Box::pin(async move { self.bot.status(self.text, self.markup).await })
    }
}

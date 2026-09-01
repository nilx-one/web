// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const DISCORD_API_ORIGIN: &str = "https://discord.com/api";

#[derive(Clone, Debug)]
pub struct DiscordOAuthClient {
    http: Client,
    client_id: String,
    client_secret: String,
    api_origin: String,
}

impl DiscordOAuthClient {
    pub fn new(client_id: impl Into<String>, client_secret: impl Into<String>) -> Self {
        Self::with_api_origin(client_id, client_secret, DISCORD_API_ORIGIN)
    }

    fn with_api_origin(
        client_id: impl Into<String>,
        client_secret: impl Into<String>,
        api_origin: impl Into<String>,
    ) -> Self {
        Self {
            http: Client::new(),
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            api_origin: api_origin.into(),
        }
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    pub async fn exchange_code(&self, code: &str) -> Result<DiscordAccessToken, DiscordOAuthError> {
        if code.is_empty() {
            return Err(DiscordOAuthError::InvalidResponse);
        }

        let response = self
            .http
            .post(format!("{}/oauth2/token", self.api_origin))
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("grant_type", "authorization_code"),
                ("code", code),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(DiscordOAuthError::Rejected(response.status().as_u16()));
        }

        let token = response.json::<DiscordTokenResponse>().await?;
        if token.access_token.is_empty() {
            return Err(DiscordOAuthError::InvalidResponse);
        }

        Ok(DiscordAccessToken {
            access_token: token.access_token,
        })
    }

    pub async fn authenticate(&self, access_token: &str) -> Result<String, DiscordOAuthError> {
        if access_token.is_empty() {
            return Err(DiscordOAuthError::InvalidResponse);
        }

        let response = self
            .http
            .get(format!("{}/v10/users/@me", self.api_origin))
            .bearer_auth(access_token)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(DiscordOAuthError::Rejected(response.status().as_u16()));
        }

        let user = response.json::<DiscordUserResponse>().await?;
        if user.id.is_empty() {
            return Err(DiscordOAuthError::InvalidResponse);
        }

        Ok(user.id)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DiscordAccessToken {
    pub access_token: String,
}

#[derive(Debug, Deserialize)]
struct DiscordTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct DiscordUserResponse {
    id: String,
}

#[derive(Debug, Error)]
pub enum DiscordOAuthError {
    #[error("Discord OAuth request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("Discord OAuth rejected the request with HTTP {0}")]
    Rejected(u16),
    #[error("Discord OAuth returned an invalid response")]
    InvalidResponse,
}

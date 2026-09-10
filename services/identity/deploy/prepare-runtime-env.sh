#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

runtime_env="${1:?runtime environment path is required}"
provider_env="${2:?provider environment path is required}"

umask 077

test -r "$provider_env"

runtime_dir="$(dirname "$runtime_env")"
mkdir -p "$runtime_dir"
chmod 0700 "$runtime_dir"

read_existing_value() {
  key="$1"
  [ -f "$runtime_env" ] || return 0
  awk -v wanted="$key" '
    index($0, wanted "=") == 1 {
      sub(/^[^=]*=/, "")
      print
      exit
    }
  ' "$runtime_env"
}

read_provider_value() {
  key="$1"
  awk -v wanted="$key" '
    index($0, wanted "=") == 1 {
      sub(/^[^=]*=/, "")
      print
      exit
    }
  ' "$provider_env"
}

generate_secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

validate_pair() {
  name="$1"
  first="$2"
  second="$3"
  if [ -n "$first" ] || [ -n "$second" ]; then
    if [ -z "$first" ] || [ -z "$second" ]; then
      echo "$name credentials must be configured together" >&2
      exit 1
    fi
  fi
}

native_auth_secret="$(read_existing_value NATIVE_AUTH_SECRET)"
password_pepper="$(read_existing_value PASSWORD_PEPPER)"

if [ "${#native_auth_secret}" -lt 32 ]; then
  native_auth_secret="$(generate_secret)"
fi
if [ "${#password_pepper}" -lt 32 ] || [ "$password_pepper" = "$native_auth_secret" ]; then
  password_pepper="$(generate_secret)"
fi

[ "${#native_auth_secret}" -ge 32 ]
[ "${#password_pepper}" -ge 32 ]
[ "$native_auth_secret" != "$password_pepper" ]

if grep -Eq '^(NATIVE_AUTH_SECRET|PASSWORD_PEPPER)=' "$provider_env"; then
  echo "provider environment must not override server-owned native authentication secrets" >&2
  exit 1
fi

telegram_token="$(read_provider_value TELOXIDE_TOKEN)"
test -n "$telegram_token"

public_origin="$(read_provider_value PUBLIC_ORIGIN)"
if [ -n "$public_origin" ]; then
  case "$public_origin" in
    https://*) ;;
    *)
      echo "PUBLIC_ORIGIN must use https" >&2
      exit 1
      ;;
  esac
fi

telegram_oidc_client_id="$(read_provider_value TELEGRAM_OIDC_CLIENT_ID)"
telegram_oidc_client_secret="$(read_provider_value TELEGRAM_OIDC_CLIENT_SECRET)"
telegram_oidc_from_provider=false
if [ -n "$telegram_oidc_client_id" ] || [ -n "$telegram_oidc_client_secret" ]; then
  telegram_oidc_from_provider=true
else
  telegram_oidc_client_id="$(read_existing_value TELEGRAM_OIDC_CLIENT_ID)"
  telegram_oidc_client_secret="$(read_existing_value TELEGRAM_OIDC_CLIENT_SECRET)"
fi
validate_pair "Telegram browser OAuth" "$telegram_oidc_client_id" "$telegram_oidc_client_secret"

discord_client_id="$(read_provider_value DISCORD_CLIENT_ID)"
discord_client_secret="$(read_provider_value DISCORD_CLIENT_SECRET)"
validate_pair "Discord OAuth" "$discord_client_id" "$discord_client_secret"

next_env="$(mktemp "$runtime_dir/.runtime.env.XXXXXX")"
trap 'rm -f "$next_env"' EXIT HUP INT TERM

{
  printf 'NATIVE_AUTH_SECRET=%s\n' "$native_auth_secret"
  printf 'PASSWORD_PEPPER=%s\n' "$password_pepper"
  if [ "$telegram_oidc_from_provider" = false ] && [ -n "$telegram_oidc_client_id" ]; then
    printf 'TELEGRAM_OIDC_CLIENT_ID=%s\n' "$telegram_oidc_client_id"
    printf 'TELEGRAM_OIDC_CLIENT_SECRET=%s\n' "$telegram_oidc_client_secret"
  fi
  cat "$provider_env"
} >"$next_env"
chmod 0600 "$next_env"
mv "$next_env" "$runtime_env"
trap - EXIT HUP INT TERM
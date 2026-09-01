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

generate_secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
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

telegram_token="$(awk '
  index($0, "TELOXIDE_TOKEN=") == 1 {
    sub(/^[^=]*=/, "")
    print
    exit
  }
' "$provider_env")"
test -n "$telegram_token"

discord_client_id="$(awk '
  index($0, "DISCORD_CLIENT_ID=") == 1 {
    sub(/^[^=]*=/, "")
    print
    exit
  }
' "$provider_env")"
discord_client_secret="$(awk '
  index($0, "DISCORD_CLIENT_SECRET=") == 1 {
    sub(/^[^=]*=/, "")
    print
    exit
  }
' "$provider_env")"
if [ -n "$discord_client_id" ] || [ -n "$discord_client_secret" ]; then
  test -n "$discord_client_id"
  test -n "$discord_client_secret"
fi

next_env="$(mktemp "$runtime_dir/.runtime.env.XXXXXX")"
trap 'rm -f "$next_env"' EXIT HUP INT TERM

{
  printf 'NATIVE_AUTH_SECRET=%s\n' "$native_auth_secret"
  printf 'PASSWORD_PEPPER=%s\n' "$password_pepper"
  cat "$provider_env"
} >"$next_env"
chmod 0600 "$next_env"
mv "$next_env" "$runtime_env"
trap - EXIT HUP INT TERM

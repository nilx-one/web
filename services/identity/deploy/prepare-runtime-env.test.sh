#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
prepare="$script_dir/prepare-runtime-env.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

runtime="$tmp/secrets/runtime.env"
provider="$tmp/provider.env"

value_of() {
  key="$1"
  file="$2"
  awk -v wanted="$key" '
    index($0, wanted "=") == 1 {
      sub(/^[^=]*=/, "")
      print
      exit
    }
  ' "$file"
}

printf '%s\n' 'TELOXIDE_TOKEN=first-token' >"$provider"
sh "$prepare" "$runtime" "$provider"

native_first="$(value_of NATIVE_AUTH_SECRET "$runtime")"
pepper_first="$(value_of PASSWORD_PEPPER "$runtime")"
[ "${#native_first}" -ge 32 ]
[ "${#pepper_first}" -ge 32 ]
[ "$native_first" != "$pepper_first" ]
[ "$(value_of TELOXIDE_TOKEN "$runtime")" = first-token ]
[ "$(stat -c '%a' "$runtime")" = 600 ]

{
  printf '%s\n' 'TELOXIDE_TOKEN=second-token'
  printf '%s\n' 'DISCORD_CLIENT_ID=1234'
  printf '%s\n' 'DISCORD_CLIENT_SECRET=discord-secret'
} >"$provider"
sh "$prepare" "$runtime" "$provider"

[ "$(value_of NATIVE_AUTH_SECRET "$runtime")" = "$native_first" ]
[ "$(value_of PASSWORD_PEPPER "$runtime")" = "$pepper_first" ]
[ "$(value_of TELOXIDE_TOKEN "$runtime")" = second-token ]
[ "$(value_of DISCORD_CLIENT_ID "$runtime")" = 1234 ]
[ "$(value_of DISCORD_CLIENT_SECRET "$runtime")" = discord-secret ]

{
  printf '%s\n' 'TELOXIDE_TOKEN=attempted-override'
  printf '%s\n' 'NATIVE_AUTH_SECRET=not-allowed'
} >"$provider"
if sh "$prepare" "$runtime" "$provider" >/dev/null 2>&1; then
  echo "native secret override unexpectedly succeeded" >&2
  exit 1
fi

[ "$(value_of NATIVE_AUTH_SECRET "$runtime")" = "$native_first" ]
[ "$(value_of PASSWORD_PEPPER "$runtime")" = "$pepper_first" ]

#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
#
# Deletes every registered identity. All identity-owned tables (credentials,
# sessions, providers, Avaia, bonds, locations, pub info) reference
# identities(pub_dress) ON DELETE CASCADE, so one statement empties them all.
# Irreversible. Dry run unless WIPE_CONFIRM matches the target database name.

set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

db_name="$(psql "$DATABASE_URL" -Atc 'SELECT current_database()')"
count="$(psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM identities')"
echo "database: $db_name; identities: $count"

if [ "${WIPE_CONFIRM:-}" != "$db_name" ]; then
  echo "dry run. set WIPE_CONFIRM=$db_name to delete every identity." >&2
  exit 0
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DELETE FROM identities'
echo "identities after wipe: $(psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM identities')"

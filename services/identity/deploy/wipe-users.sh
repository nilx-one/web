#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
#
# Deletes every registered identity from the SQLite file the identity service
# owns (compose: DATABASE_URL=sqlite:///data/identity.db on the `identity-data`
# volume). All identity-owned tables reference identities(pub_dress) ON DELETE
# CASCADE, but SQLite enforces that only with foreign_keys ON, which the
# sqlite3 CLI does not set by default; this script sets it and verifies the
# result. Irreversible. Dry run unless WIPE_CONFIRM=wipe-all-identities.
#
# Run on the host that runs the container, as a user who can read the volume:
#   docker compose -p nilx-one-identity stop identity
#   services/identity/deploy/wipe-users.sh                       # dry run
#   WIPE_CONFIRM=wipe-all-identities services/identity/deploy/wipe-users.sh
#   docker compose -p nilx-one-identity start identity
#
# IDENTITY_DB overrides the file; by default it is found through the volume.

set -eu

command -v sqlite3 >/dev/null || { echo "sqlite3 is required" >&2; exit 1; }

volume="${IDENTITY_VOLUME:-nilx-one-identity_identity-data}"
if [ -z "${IDENTITY_DB:-}" ]; then
  IDENTITY_DB="$(docker volume inspect "$volume" --format '{{ .Mountpoint }}')/identity.db"
fi
test -f "$IDENTITY_DB" || { echo "no database at $IDENTITY_DB" >&2; exit 1; }

if docker ps --format '{{ .Names }}' 2>/dev/null | grep -q 'identity'; then
  echo "an identity container is running; stop it first (see header)" >&2
  exit 1
fi

count() { sqlite3 "$IDENTITY_DB" 'SELECT count(*) FROM identities'; }
echo "database: $IDENTITY_DB; identities: $(count)"

if [ "${WIPE_CONFIRM:-}" != "wipe-all-identities" ]; then
  echo "dry run. set WIPE_CONFIRM=wipe-all-identities to delete every identity." >&2
  exit 0
fi

cp "$IDENTITY_DB" "$IDENTITY_DB.before-wipe.$(date +%Y%m%d%H%M%S)"
sqlite3 "$IDENTITY_DB" 'PRAGMA foreign_keys = ON; DELETE FROM identities;'

echo "identities after wipe: $(count)"
for table in native_credentials native_sessions identity_providers avaia_configuration bond_roles; do
  echo "$table: $(sqlite3 "$IDENTITY_DB" "SELECT count(*) FROM $table")"
done

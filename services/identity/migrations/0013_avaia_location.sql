-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

-- One owner-published location per Avaia, keyed by the owning human Bond.
-- This is distinct from `bond_locations` (the Bond's own operational
-- location) and from the local, never-persisted walking position described
-- in `avaia-walk.md`. No row means the owner has not published a location
-- for their Avaia yet.
CREATE TABLE IF NOT EXISTS avaia_locations (
    owner_pub_dress TEXT PRIMARY KEY COLLATE BINARY NOT NULL
        REFERENCES identities(pub_dress) ON UPDATE CASCADE ON DELETE CASCADE,
    longitude_e7 INTEGER NOT NULL
        CHECK (longitude_e7 BETWEEN -1800000000 AND 1800000000),
    latitude_e7 INTEGER NOT NULL
        CHECK (latitude_e7 BETWEEN -900000000 AND 900000000),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

-- Avaia creation is an explicit owner action. Legacy registration, rename and
-- reconciliation paths still share the old insertion helper, so the database
-- enforces the lifecycle boundary underneath all of them. The explicit create
-- transaction records its owner here before invoking that helper. Any other
-- Avaia INSERT is immediately removed in the same transaction, leaving the
-- human Bond intact and making implicit creation observationally impossible.
CREATE TABLE IF NOT EXISTS avaia_creation_intents (
    owner_pub_dress TEXT PRIMARY KEY COLLATE BINARY NOT NULL
        REFERENCES identities(pub_dress) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TRIGGER IF NOT EXISTS identities_reject_implicit_avaia_creation
AFTER INSERT ON identities
WHEN NEW.identity_kind = 'avaia'
    AND NOT EXISTS (
        SELECT 1
        FROM avaia_creation_intents
        WHERE owner_pub_dress = NEW.owner_pub_dress
    )
BEGIN
    DELETE FROM identities WHERE pub_dress = NEW.pub_dress;
END;

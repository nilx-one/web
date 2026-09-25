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

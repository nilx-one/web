-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

CREATE TABLE IF NOT EXISTS bond_location_control (
    pub_dress TEXT PRIMARY KEY COLLATE BINARY NOT NULL
        REFERENCES identities(pub_dress) ON UPDATE CASCADE ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('live', 'manual')),
    observed_longitude REAL,
    observed_latitude REAL,
    observed_at INTEGER,
    manual_longitude REAL,
    manual_latitude REAL,
    manual_set_at INTEGER,
    CHECK (
        (observed_longitude IS NULL AND observed_latitude IS NULL AND observed_at IS NULL)
        OR (
            observed_longitude IS NOT NULL
            AND observed_latitude IS NOT NULL
            AND observed_at IS NOT NULL
            AND observed_longitude BETWEEN -180.0 AND 180.0
            AND observed_latitude BETWEEN -90.0 AND 90.0
        )
    ),
    CHECK (
        (mode = 'live' AND manual_longitude IS NULL AND manual_latitude IS NULL AND manual_set_at IS NULL)
        OR (
            mode = 'manual'
            AND manual_longitude IS NOT NULL
            AND manual_latitude IS NOT NULL
            AND manual_set_at IS NOT NULL
            AND manual_longitude BETWEEN -180.0 AND 180.0
            AND manual_latitude BETWEEN -90.0 AND 90.0
        )
    )
) STRICT;

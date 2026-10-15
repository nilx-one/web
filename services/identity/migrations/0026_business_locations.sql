-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

-- A business Bond stands at one of its own stations. Its `bond_locations` row
-- holds the point, declared (`manual`); this row says which station it is, so
-- the point follows the station when the business restates it. A business
-- with no row here has no location of its own beyond `bond_locations`.
CREATE TABLE IF NOT EXISTS business_locations (
    owner_pub_dress TEXT PRIMARY KEY COLLATE BINARY NOT NULL
        REFERENCES identities(pub_dress) ON UPDATE CASCADE ON DELETE CASCADE,
    avaia_pub_dress TEXT NOT NULL UNIQUE COLLATE BINARY
        REFERENCES business_stations(avaia_pub_dress) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

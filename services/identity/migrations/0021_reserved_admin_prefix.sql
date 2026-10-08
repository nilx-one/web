-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

-- Promote existing human Bonds only; public registration cannot allocate 0x0.
INSERT INTO bond_roles (pub_dress, role)
SELECT pub_dress, 'admin' FROM identities
WHERE identity_kind = 'human' AND substr(pub_dress, 1, 3) = '0x0'
ON CONFLICT(pub_dress) DO UPDATE SET role = excluded.role;

-- Storage-level defense also covers direct inserts by other service adapters.
CREATE TRIGGER IF NOT EXISTS identities_reserved_admin_prefix_insert
BEFORE INSERT ON identities
WHEN NEW.identity_kind = 'human' AND substr(NEW.pub_dress, 1, 3) = '0x0'
BEGIN
    SELECT RAISE(ABORT, 'reserved_pub_dress_prefix');
END;

-- Human discriminators are immutable; changing only the slug stays valid.
CREATE TRIGGER IF NOT EXISTS identities_human_discriminator_update
BEFORE UPDATE OF pub_dress, identity_kind ON identities
WHEN NEW.identity_kind = 'human'
    AND (OLD.identity_kind <> 'human'
         OR substr(NEW.pub_dress, 1, 3) <> substr(OLD.pub_dress, 1, 3))
BEGIN
    SELECT RAISE(ABORT, 'immutable_pub_dress_discriminator');
END;

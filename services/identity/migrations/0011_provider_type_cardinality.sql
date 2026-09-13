-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

-- Database boundary for the application rule: one account per provider type
-- per Bond. Existing duplicate rows are not silently discarded; if any exist,
-- this migration fails so the conflict stays observable and is resolved deliberately.
CREATE UNIQUE INDEX identity_providers_one_account_per_type
ON identity_providers (pub_dress, provider);

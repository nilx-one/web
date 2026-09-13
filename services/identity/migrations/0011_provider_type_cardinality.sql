-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

-- A Bond may bind at most one account of each provider. Existing duplicate
-- rows are not silently discarded: if any exist, this migration fails so the
-- conflict is observable and can be resolved deliberately.
CREATE UNIQUE INDEX identity_providers_one_account_per_type
ON identity_providers (pub_dress, provider);

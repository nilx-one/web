-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    "type" TEXT NOT NULL,
    full_text TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    CHECK (length(project) BETWEEN 1 AND 64),
    CHECK (length("type") BETWEEN 1 AND 128),
    CHECK (length(full_text) BETWEEN 1 AND 32768),
    CHECK (length(observed_at) = 20),
    CHECK (length(received_at) = 20)
) STRICT;

CREATE INDEX IF NOT EXISTS errors_by_observed_at
ON errors (observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS errors_by_project_observed_at
ON errors (project, observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS errors_by_type_observed_at
ON errors ("type", observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS errors_by_received_at
ON errors (received_at);

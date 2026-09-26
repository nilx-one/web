-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

-- Single Active Client (nilx-one/0x1 documents/15-devices-and-recovery.md).
-- Exactly one authenticated session of a Bond is active at a time; the rest
-- stay signed in as inactive. `client_label` is what the active client shows
-- when naming a requester (device and host), never a bare token.
ALTER TABLE native_sessions ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE native_sessions ADD COLUMN client_label TEXT NOT NULL DEFAULT '';

-- Existing rows predate this column and were all treated as fully
-- authoritative, so a pub_dress may already hold more than one. Keep only
-- the most recently created still-valid session active; older ones become
-- inactive rather than erased, matching "still signed in" for a client that
-- loses activation.
UPDATE native_sessions
SET active = 0
WHERE revoked_at IS NULL
  AND rowid NOT IN (
    SELECT rowid FROM native_sessions AS newest
    WHERE newest.pub_dress = native_sessions.pub_dress
      AND newest.revoked_at IS NULL
    ORDER BY newest.created_at DESC, newest.rowid DESC
    LIMIT 1
  );

CREATE INDEX IF NOT EXISTS native_sessions_active_by_identity
ON native_sessions (pub_dress, active)
WHERE revoked_at IS NULL;

-- One activation request at a time per requester session; lazily swept
-- (checked and transitioned at read/act time), never a background job.
CREATE TABLE IF NOT EXISTS session_activation_requests (
    id BLOB PRIMARY KEY NOT NULL,
    pub_dress TEXT NOT NULL,
    requester_token_hash BLOB NOT NULL,
    client_label TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'objectable', 'accepted', 'declined', 'objected')),
    created_at INTEGER NOT NULL,
    responds_by INTEGER NOT NULL,
    objection_deadline INTEGER,
    resolved_at INTEGER,
    FOREIGN KEY (pub_dress) REFERENCES identities(pub_dress)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS session_activation_requests_by_identity
ON session_activation_requests (pub_dress, status);

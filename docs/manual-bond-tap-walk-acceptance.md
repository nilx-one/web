# Manual Bond tap-to-walk acceptance

This checklist covers the existing Telegram `/set_position` declaration and the Web/Telegram map behavior. It is **not** a record of completed physical-device testing.

## Automated acceptance

- Only an authenticated legacy `0x0*` human Bond with the Admin capability can use `POST /api/v1/location-control/manual-move`. An Admin in `0x1*` is denied.
- A valid session cookie and a valid provider header for different Bonds cannot silently select the cookie's account for this write.
- The SQL compare-and-set rejects stale E7 coordinates and a switch from manual to live.
- A `409` triggers an authenticated GET of current location control. The manual walk snaps to the server's point; a live-mode response must recompose the host before GPS is permitted.
- A stalled POST times out, aborts the client request and does not report a saved move.
- An interrupted wheel handover attempts at most one commit, and new taps do not start a second walk while saving.

## Real-device acceptance — pending

On a signed-in website and a Telegram Mini App on real devices:

1. With a reserved `0x0*` Admin in manual mode, take the Bond wheel and tap open ground. Verify route, obstacles, animation, E7-persisted arrival and recenter; verify that Avaia does not move.
2. Put the device offline during arrival. Verify an error toast and no claim that the move was saved. Reconnect and confirm that the displayed position reconciles with the server.
3. Move the same Bond on a second signed-in client while the first walks. Verify that the first client's rejected CAS displays the authoritative second-client position.
4. Switch the server from manual to live during the walk. Verify that the write is refused, and that GPS is requested only from a newly composed live-mode host.
5. In Telegram, return from the bot after `/set_position`; confirm the manual position is used without physical GPS and a successful move updates the in-app world without a reload.
6. In Web, confirm the immediate location refresh after acceptance/conflict (without waiting for the normal polling interval). Confirm `0x1*` and non-Admin accounts cannot move by tapping.

Browser CI and deploy-package checks do not replace these tests. Do not mark the real-device section complete without a recorded device, host, revision and outcome.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->

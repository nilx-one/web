# Telegram compact private-chat surface

The 0x1 identity bot uses **presentation-only slots**, keyed by private Telegram
`chat_id` and stored in `telegram_message_slots`. These records are not
BondChain interactions or relationship evidence.

- **Open (first bot-owned message)** — immutable `Open` with the existing
  inline Web App button to `https://nilx.one/telegram/`. `/open` remains the
  first registered command and is available before registration.
- **Status (second)** — one editable bot response for identity, registration,
  location, unlink, help, recovery, and speech. Ordinary responses use
  `editMessageText` on the stored `message_id` instead of sending new messages.
- **Admin (third, admin-only)** — one editable inbox containing pending
  role-approval requests and callback buttons. Only a stored Telegram
  provider binding that resolves to `bond_roles.role = 'admin'` may see it.
  Every callback also revalidates the role transactionally before writing.

The slots survive restarts. An edit failure **does not** cause an additional
send unless Telegram explicitly reports that the old message does not exist.
Network, permission, and rate-limit errors remain visible failures.
A per-chat in-process lock serializes slot creation and updates, while
database IDs preserve slots across service restarts. Deployments should
run a single Telegram polling replica, as before.

The bot deletes consumed command and location inputs on a best-effort
basis in private chats to reduce clutter. Telegram limits deletion of
older messages to 48 hours. Consequently this contract is about
**bot-owned messages**, not an ability to reorder Telegram history or
guarantee that arbitrary user/legacy messages never appear.

Telegram only edits messages with no reply keyboard or with an inline
keyboard. The status slot therefore does **not** install reply keyboards.
For `/current_position`, the user sends a location using Telegram's
native attachment/location picker; `/set_position` and `/travel`
continue to consume explicitly shared map points and keep their existing
admin authorization checks.

Admin request receipts are recorded after a successful admin-slot
refresh. Approval confirmations also update the same admin slot rather
than generating a fourth message. The full pending request source is
the existing persistent admin-role repository and Web inbox; Telegram
shows the first ten actionable requests.

## Verification

1. Guest `/open`: exactly two bot-owned messages, with Open above Status.
2. Repeated `/help`, `/whoami`, or `/recover`: Status ID is unchanged.
3. Restart identity service: messages are edited, not recreated.
4. Linked admin: the third slot appears; two outstanding review requests
   share one message with independent callbacks.
5. User/candidate/unauthorized callback: no elevation or admin inbox.
6. Admin `/set_position`, `/travel`, and ordinary `/current_position`
   preserve their prior location semantics.
7. Telegram edit API errors other than message-not-found produce no
   duplicate messages. Revocation best-effort removes the admin slot
   and never bypasses the server-side authorization gate.
8. Full CI validates Rust format, clippy, and tests; Validate checks the
   runtime package. Merge does not deploy.

---

© 2026 aiaiaiai · aiaiaiai.org

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

**Edit bot messages; delete only user inputs.** The bot uses `editMessageText`
for its retained Open/Status/Admin slots (Open remains unchanged unless it
needs recovery). It never deletes an existing bot-owned slot for normal
updates or role changes. In a private chat, incoming user commands, location
shares and unsupported inputs are removed **after successful processing**,
best-effort, to keep the surface focused. Telegram permits a bot to delete
incoming private-chat messages within 48 hours; it cannot edit user messages
or retroactively remove legacy messages older than the API permits.
Failed input deletion is logged without undoing an already committed action.

Telegram only edits messages with no reply keyboard or with an inline
keyboard. The status slot therefore does **not** install reply keyboards.
For `/current_position`, the user sends a location using Telegram's
native attachment/location picker; `/set_position` and `/travel`
continue to consume explicitly shared map points and keep their existing
admin authorization checks.

The default and ordinary-user menus expose exactly `/open` and `/unlink`,
in that order; linked admins additionally see `/set_position` and `/travel`
before `/unlink`. The legacy `/start`, `/whoami`, `/recover`,
`/current_position`, `/help` and `/unlink_confirm` handlers remain
functional when explicitly typed, but are not promoted in the menu.
`/unlink` uses a five-minute, single-use inline confirmation/cancellation
flow in the editable Status slot; the provider repository still rejects
unlink if Telegram is the Bond's sole remaining access path.

Admin request receipts are recorded after a successful admin-slot
refresh. Approval confirmations also update the same admin slot rather
than generating a fourth message. An admin demotion redacts the retained
Admin slot without deleting the bot-owned message; a later promotion
can reuse the same message ID. The full pending request source is the
existing persistent admin-role repository and Web inbox; Telegram
shows the first ten actionable requests.

## Verification

1. Guest and ordinary-user command menus are exactly `/open`, `/unlink`.
   Admins get `/set_position`, `/travel` as additional menu entries.
2. Guest `/open`: exactly two bot-owned messages, with Open above Status.
3. Repeated `/help`, `/whoami`, or `/recover`: Status ID is unchanged.
4. Restart identity service: messages are edited, not recreated.
5. Linked admin: the third slot appears; two outstanding review requests
   share one message with independent callbacks.
6. User/candidate/unauthorized callback: no elevation or admin inbox.
7. Admin `/set_position`, `/travel`, and ordinary `/current_position`
   preserve their prior location semantics.
8. `/unlink` uses inline Confirm/Cancel on Status and never emits an extra
   bot message; expiry and sole-access guards remain enforced.
9. Input cleanup deletes _only incoming user messages_, never bot slots.
   Admin revocation redacts and retains its slot ID for later reuse.
10. Telegram edit API errors other than message-not-found produce no
    duplicate messages and never bypass the authorization boundary.
11. Full CI validates Rust format, clippy, and tests; Validate checks the
    runtime package. Merge does not deploy.

---

© 2026 aiaiaiai · aiaiaiai.org

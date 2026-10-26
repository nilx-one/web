# Special subscriptions paid with seeds — issuer authority (staged)

The 0xda-market catalog already supports **Special** subscription orders in
the non-fiat `seeds` denomination (₴€£), and **does not** permit seeds
payment for Exclusive. 0xda-market is the *order/quote owner*; 0x1
Identity is the authoritative *wallet/debit/entitlement owner*.
No browser inventory, market user record or market fiat settlement may
impersonate the issuer's authority.

## Transaction boundary implemented here

Versioned migration 0037 introduces these private Identity tables:

- `bond_seeds`: strictly server-owned nonnegative integer balance;
  **initial balance is zero**, with **no automatic credit**.
- `bond_subscription_clocks`: persisted Core `SubscriptionClock`, retaining
  Exclusive priority while Special remaining time is paused.
- `bond_seed_subscription_debits`: immutable receipt keyed by the market
  issuer order ID, with exact SKU, recipient, price snapshot ID, amount,
  duration and committed timestamp.

`IdentityRepository::settle_special_seeds` performs **one SQLite immediate
write transaction**: validate an internally supplied issuer snapshot, reject
different replay terms, check the authoritative balance, use Core to grant
Special, deduct seeds, write the new clock and record the receipt. Either all
three writes commit or none do. The same order ID and unchanged terms yield
`AlreadyGranted`, never a second debit. A changed replay is rejected.
Missing or insufficient balance returns `InsufficientSeeds`. Exclusive SKUs
are explicitly rejected. This method has **no HTTP route** and is never
callable by a client or through an untrusted balance assertion.

Tests fund a wallet **directly inside the test database** solely to exercise
the repository transaction. This fixture is not a crediting mechanism.

## Required before customers can actually buy

1. Implement an authoritative, server-verified source of **seeds credits**
   and an auditable idempotent credit ledger; local Core inventory values and
   the optional market handoff balance are *not* authority and cannot be
   imported by assertion.
2. Implement an authenticated **issuer worker** using the existing
   0xda-market `/issuer/v1/orders` queue: claim a pending order, verify that
   the issuer is `0x1`, status is `processing`, the denomination is
   `seeds`, SKU is a supported Special term, and that the recipient still
   matches the customer's verified issuer-bound identity. The worker must
   resolve a reviewed **month-to-duration** policy: never accept a duration
   or price from the browser. Pass the immutable market `price_id`,
   snapshotted `amount_minor`, and market order ID into the repository.
3. After a successful atomic debit/grant or exact replay, report
   `fulfil` to Market using the **same unique issuer order reference**,
   unchanged amount, denomination, and recipient; on insufficient balance
   report `reject: insufficient_balance`. On network uncertainty,
   rescan `processing`, consult the stored receipt by the same ID and
   repeat the idempotent fulfillment. Never reject an already committed
   debit merely because the confirmation transport failed.
4. Expose authenticated bounded-freshness entitlement snapshots from
   Identity to Web/iOS. Session and recipient binding must be verified.
   Only the Core effective status, not a payment or UI toggle, grants
   Special behavior.
5. End-to-end test the authenticated channel customer flow and the
   issuer worker, including cancel-versus-claim races, process crash,
   reconnection, replay, upgrade/paused Special, insufficient seeds,
   immutable receipts, failed fulfillment, and a price change after order
   creation. Only then enable Market's staged Special SKUs/routes.

**This PR is the atomic issuer storage prerequisite, not a claim that checkout
is live or a digital item has been delivered.** No production sale, credit
minting, deployed API, or unauthenticated grant is activated.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->

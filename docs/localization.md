# Frontend localization

## Decision

Interactive product localization belongs to the Web presentation boundary.
Core, application semantics, HTTP adapters, and backend services stay locale-neutral.

The canonical flow is:

```text
Core / service fact
  -> typed application projection
  -> product presentation
  -> locale catalog
  -> rendered human-facing copy
```

A backend error is therefore a stable code or typed result, never the localized sentence a person reads. The same semantic result may be rendered differently by Web clients without changing protocol truth.

## Product locale state

`packages/product-app/src/shell/localization.ts` owns locale resolution for every product host. Browser, Telegram, and Discord compositions consume the same localization store, so a host must not fork translation catalogs.

The initial supported locales are:

- `en`
- `uk-UA`

`auto` is the default local preference. It resolves in this order:

1. explicit local preference, when it is not `auto`;
2. ordered host-provided language evidence;
3. ordered browser/device language preferences;
4. deterministic `en` fallback.

Host language evidence is presentation-only and must be supplied by the host adapter or composition boundary. Telegram Mini Apps use `initDataUnsafe.user.language_code` only as an unverified UI hint; signed `initData` remains the authentication boundary. An unsupported host language falls through to browser/device evidence rather than forcing English.

Language-family matching precedes region matching. Any tag whose primary language subtag is `uk` — including `uk`, `uk-UA`, `uk_UA`, `uk-GB`, `uk-RU`, or another `uk-*` variant — resolves to the canonical supported locale `uk-UA`. Likewise, supported English variants resolve to `en`. Region subtags never change the language family.

An explicit choice, when a UI exposes it, is persisted only as local interface state under `nilx-one.interface.locale`. The resolved locale is written to the document `lang` attribute for accessibility and browser semantics.

## Ownership

Frontend owns interactive UI strings, accessibility labels, formatting, pluralization, locale detection, and local presentation preferences.

Host adapters may expose provider-specific language hints to the frontend localization boundary. They do not own translation catalogs and they do not promote those hints into identity or protocol state.

Backend and Core own canonical identifiers, structured error codes, typed state, and protocol facts. Locale does not enter Bond, Intent, Interaction, BondChain, Relationship, or identity truth.

Server-side localization is a separate future boundary only for artifacts a server itself creates for a person, such as email, push notifications, or bot messages. Ordinary API responses remain locale-neutral.

## Failure notices

`@nilx-one/application` keeps failure classification, tone, correlation references, and retry intent. It receives human copy from the product presentation boundary. This prevents an English sentence from becoming part of application semantics while preserving the upstream authority of `kind` and `retryable`.

## Not modeled

Voice/style is intentionally not part of this contract. Locale means language/region only; no pseudo-locale or writing-style dimension is introduced.

---

© 2026 aiaiaiai · aiaiaiai.org

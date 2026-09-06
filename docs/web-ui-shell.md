# 0x1 Web UI Shell

The Web client is a persistent world with minimal application chrome floating
over it. The world is the environment, not a screen the client navigates to.

This document is the layout contract. It is presentation architecture only: it
never defines Bond, Relationship, BondChain, or any other protocol truth.

## Layers

```text
┌─────────────────────────────────────┐
│ HEADER                              │
│                         ┌─────────┐ │
│                         │ toast 1 │ │
│                         ├─────────┤ │
│                         │ toast 2 │ │
│                         └─────────┘ │
│                                     │
│              WORLD                  │
│          map / spatial field        │
│                                     │
│       ┌─────────────────────┐       │
│       │        DOCK         │       │
│       │  grows ↑ if needed  │       │
│       └─────────────────────┘       │
└─────────────────────────────────────┘
                  ↑ bottom safe-area
```

`AppShell` composes five viewport-anchored layers, back to front:

| Layer         | Anchor                  | Owns                                       |
| ------------- | ----------------------- | ------------------------------------------ |
| world         | fills the viewport      | the map surface and its presentation shade |
| bottom (Dock) | bottom safe area        | contextual interaction, currently the Bond |
| header        | top safe area           | brand, navigation, host context, overflow  |
| toast stack   | top right, below header | transient feedback                         |
| overlay       | fills the viewport      | announcements, popovers                    |

Invariants the shell guarantees at every supported size:

- the Dock's lower edge stays attached to the bottom safe area, and content
  growth moves its upper edge only;
- the toast stack starts below the header, is anchored top right, and never
  repositions the Dock or lives inside it;
- the world persists behind every overlay and is never displaced by chrome.

`tests/architecture/shell-layout-contract.test.ts` asserts these against the
stylesheet, so a later change cannot quietly drop one.

## Short viewports

The bottom layer publishes its measured height as `--shell-bottom-height`, so
the toast stack's ceiling is exact rather than a guess. When room runs out, the
order of concession is: reduce toast density (a notice keeps its title and drops
its detail), then constrain and scroll the stack, then let the Dock scroll
internally. The Dock never leaves its anchor, and a toast is never moved into
it.

## Navigation

Routes stay canonical at every width; only their presentation changes.

| Route       | Surface                                             |
| ----------- | --------------------------------------------------- |
| `/`         | the world with the Bond context in the Dock         |
| `/identity` | the Bond profile, its edit state, and host bindings |
| `/settings` | application settings, such as interface appearance  |

`/map` remains a renderer diagnostic surface. The map is the world, so it is
never presented as a peer tab beside identity and settings.

| Presentation | Width      | Header                                              |
| ------------ | ---------- | --------------------------------------------------- |
| wide         | ≥ 1024px   | `0x1  /identity  /settings … ● BROWSER HOST  ⋯`     |
| regular      | 600–1023px | `0x1  0x0sky … ● BROWSER HOST  ⚙︎  ⋯`                |
| compact      | ≤ 599px    | `0x1  0x0sky … ● BROWSER HOST  ⋯` (settings in `⋯`) |

The pub_dress is a native identity affordance, so it carries the identity entry
below wide widths instead of a generic avatar. The host indicator is secondary
context: it gives way before identity does when the header runs out of room.

## Ownership

- the header owns navigation and host context; it never owns the toast stack,
  Bond state, or the world's lifecycle;
- the Dock owns contextual interaction; it never owns global navigation or
  application settings — a settings control inside the Bond card would make the
  Bond appear to own application state;
- system status ("Shared Core ready") is low priority: compact, quiet, beside or
  above the Dock, and never dressed as a toast;
- renderer status ("Loading map", "Map unavailable") is transient feedback and
  joins the toast stack.

Host adapters may add host-specific actions to the overflow menu. They must not
fork the canonical routes or redefine these layout semantics.

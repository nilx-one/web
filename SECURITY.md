# Security Policy

Security reports are welcome and should be handled privately when disclosure could expose users, infrastructure, credentials, or an exploitable implementation flaw.

## Reporting

Prefer GitHub private vulnerability reporting or a private security advisory when available for this repository. Do not publish exploit details in a public issue before maintainers have had a reasonable opportunity to assess and remediate the problem.

A useful report includes the affected version or commit, realistic impact and preconditions, safe reproduction steps, and whether the issue affects protocol/domain semantics or only this client.

Never include live credentials, private keys, access tokens, authentication payloads, or personal data in a report or test fixture.

## Scope

Frontend security fixes must preserve protocol truth and server-side authority boundaries. A client workaround must not silently become a new identity, authorization, or interaction rule.

Third-party dependency vulnerabilities should identify the dependency and affected range.

---

© 2026 aiaiaiai · aiaiaiai.org

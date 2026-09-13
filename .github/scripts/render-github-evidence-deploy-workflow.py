# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

from pathlib import Path

source = Path(".github/workflows/deploy-identity-service.yml")
out = Path(".github/deploy-identity-service.generated.txt")
text = source.read_text()

replacements = [
    (
        '''      GITHUB_AUTH_CLIENT_SECRET:\n        required: false\n''',
        '''      GITHUB_AUTH_CLIENT_SECRET:\n        required: false\n      GITHUB_EVIDENCE_CLIENT_SECRET:\n        required: false\n''',
    ),
    (
        '''      GITHUB_AUTH_CLIENT_ID: ${{ vars.GITHUB_AUTH_CLIENT_ID }}\n      GITHUB_AUTH_CLIENT_SECRET: ${{ secrets.GITHUB_AUTH_CLIENT_SECRET }}\n''',
        '''      GITHUB_AUTH_CLIENT_ID: ${{ vars.GITHUB_AUTH_CLIENT_ID }}\n      GITHUB_AUTH_CLIENT_SECRET: ${{ secrets.GITHUB_AUTH_CLIENT_SECRET }}\n      GITHUB_EVIDENCE_CLIENT_ID: ${{ vars.GITHUB_EVIDENCE_CLIENT_ID }}\n      GITHUB_EVIDENCE_CLIENT_SECRET: ${{ secrets.GITHUB_EVIDENCE_CLIENT_SECRET }}\n''',
    ),
    (
        '''          if [ -n "$GITHUB_AUTH_CLIENT_ID" ] || [ -n "$GITHUB_AUTH_CLIENT_SECRET" ]; then\n            test -n "$GITHUB_AUTH_CLIENT_ID"\n            test -n "$GITHUB_AUTH_CLIENT_SECRET"\n          fi\n''',
        '''          if [ -n "$GITHUB_AUTH_CLIENT_ID" ] || [ -n "$GITHUB_AUTH_CLIENT_SECRET" ]; then\n            test -n "$GITHUB_AUTH_CLIENT_ID"\n            test -n "$GITHUB_AUTH_CLIENT_SECRET"\n          fi\n          if [ -n "$GITHUB_EVIDENCE_CLIENT_ID" ] || [ -n "$GITHUB_EVIDENCE_CLIENT_SECRET" ]; then\n            test -n "$GITHUB_EVIDENCE_CLIENT_ID"\n            test -n "$GITHUB_EVIDENCE_CLIENT_SECRET"\n          fi\n          if [ -n "$GITHUB_AUTH_CLIENT_ID" ] && [ -n "$GITHUB_EVIDENCE_CLIENT_ID" ] && [ "$GITHUB_AUTH_CLIENT_ID" = "$GITHUB_EVIDENCE_CLIENT_ID" ]; then\n            echo "GitHub browser authentication and evidence access must use different OAuth clients" >&2\n            exit 1\n          fi\n''',
    ),
    (
        '''          if [ -n "$GITHUB_AUTH_CLIENT_ID" ] && [ -n "$GITHUB_AUTH_CLIENT_SECRET" ]; then\n            printf 'GITHUB_AUTH_CLIENT_ID=%s\\n' "$GITHUB_AUTH_CLIENT_ID" >>"$provider_file"\n            printf 'GITHUB_AUTH_CLIENT_SECRET=%s\\n' "$GITHUB_AUTH_CLIENT_SECRET" >>"$provider_file"\n          fi\n''',
        '''          if [ -n "$GITHUB_AUTH_CLIENT_ID" ] && [ -n "$GITHUB_AUTH_CLIENT_SECRET" ]; then\n            printf 'GITHUB_AUTH_CLIENT_ID=%s\\n' "$GITHUB_AUTH_CLIENT_ID" >>"$provider_file"\n            printf 'GITHUB_AUTH_CLIENT_SECRET=%s\\n' "$GITHUB_AUTH_CLIENT_SECRET" >>"$provider_file"\n          fi\n          if [ -n "$GITHUB_EVIDENCE_CLIENT_ID" ] && [ -n "$GITHUB_EVIDENCE_CLIENT_SECRET" ]; then\n            printf 'GITHUB_EVIDENCE_CLIENT_ID=%s\\n' "$GITHUB_EVIDENCE_CLIENT_ID" >>"$provider_file"\n            printf 'GITHUB_EVIDENCE_CLIENT_SECRET=%s\\n' "$GITHUB_EVIDENCE_CLIENT_SECRET" >>"$provider_file"\n          fi\n''',
    ),
]

for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f"deploy workflow boundary changed: expected one match, got {text.count(old)}")
    text = text.replace(old, new, 1)

required = [
    "GITHUB_EVIDENCE_CLIENT_SECRET:",
    "GITHUB_EVIDENCE_CLIENT_ID: ${{ vars.GITHUB_EVIDENCE_CLIENT_ID }}",
    "GitHub browser authentication and evidence access must use different OAuth clients",
    "printf 'GITHUB_EVIDENCE_CLIENT_SECRET=%s\\n'",
]
for item in required:
    if item not in text:
        raise SystemExit(f"generated workflow is missing: {item}")

out.write_text(text)

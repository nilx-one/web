# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
"""Product-owned Telegram credential delivery contract."""

from pathlib import Path
import unittest


class ProductSecretDeliveryTests(unittest.TestCase):
    def test_encrypted_product_envelope_is_manual_and_signed(self):
        workflow = Path(".github/workflows/package-fresh-identity-secrets.yml").read_text()
        self.assertIn("on:\n  workflow_dispatch:", workflow)
        self.assertIn("github.ref == 'refs/heads/master'", workflow)
        self.assertIn("name: production", workflow)
        self.assertIn("TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}", workflow)
        self.assertIn("RECIPIENT: ${{ vars.EDGE_DEV_1_IDENTITY_AGE_RECIPIENT }}", workflow)
        self.assertIn("age --recipient", workflow)
        self.assertIn("COPY secrets.age /secrets.age", workflow)
        self.assertIn("actions/attest-build-provenance@", workflow)
        self.assertIn("subject-digest: ${{ steps.publish.outputs.digest }}", workflow)
        self.assertIn("ghcr.io/nilx-one/0x1-identity-fresh-secrets", workflow)
        self.assertNotIn("aiaiaiai-org/infra/settings/secrets", workflow)
        self.assertNotIn("INFRA_DEPLOY_TOKEN", workflow)
        self.assertNotIn("repository_dispatch", workflow)
        self.assertNotIn("ssh ", workflow)
        self.assertNotIn("secrets.SSH_PRIVATE_KEY", workflow)
        self.assertNotIn("secrets.NATIVE_AUTH_SECRET", workflow)
        self.assertNotIn("secrets.PASSWORD_PEPPER", workflow)

    def test_production_envelope_targets_live_identity_host(self):
        workflow = Path(".github/workflows/package-identity-service.yml").read_text()
        self.assertIn("contracts/servers/edge-dev-1.yaml", workflow)
        self.assertNotIn("edge-prod-1", workflow)
        self.assertIn("state: retired", workflow)
        self.assertIn("    - nilxone-identity", workflow)
        self.assertIn("encryptionRecipient", workflow)
        self.assertIn("age --recipient", workflow)
        self.assertIn("Missing production value $name", workflow)
        self.assertNotIn("INFRA_DEPLOY_TOKEN", workflow)
        self.assertNotIn("secrets.SSH_PRIVATE_KEY", workflow)


if __name__ == "__main__":
    unittest.main()

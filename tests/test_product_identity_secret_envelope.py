# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
"""Product-owned Telegram credential delivery contract."""

from pathlib import Path
import subprocess
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


    def test_recipient_guard_uses_only_live_owning_contract(self):
        recipient = "ssh-ed25519 " + "A" * 68
        valid = (
            "apiVersion: infra.nilx.one/v1\n"
            "kind: ServerContract\n"
            "metadata:\n"
            "  name: edge-dev-1\n"
            "spec:\n"
            "  role: public-edge\n"
            f"  encryptionRecipient: {recipient}\n"
            "  workloads:\n"
            "    - nilxone-identity\n"
        )
        command = ["bash", "scripts/identity-envelope-recipient.sh"]
        result = subprocess.run(command, input=valid, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), recipient)
        invalid = {
            "wrong host": valid.replace("edge-dev-1", "edge-prod-1"),
            "retired": valid.replace("spec:\n", "spec:\n  state: retired\n"),
            "wrong list": valid.replace("workloads:", "retiredWorkloads:"),
            "missing workload": valid.replace("nilxone-identity", "nilxone-web"),
            "unowned but elsewhere": valid.replace(
                "    - nilxone-identity\n",
                "    - nilxone-web\n  previous:\n    - nilxone-identity\n",
            ),
            "duplicate recipient": valid.replace(
                "  workloads:", f"  encryptionRecipient: {recipient}\n  workloads:"
            ),
            "invalid key": valid.replace(recipient, "ssh-rsa invalid"),
        }
        for label, contract in invalid.items():
            with self.subTest(label=label):
                result = subprocess.run(
                    command, input=contract, text=True, capture_output=True
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("::error::", result.stderr)

    def test_envelope_checks_reviewed_revision_and_live_contract(self):
        workflow = Path(".github/workflows/package-identity-service.yml").read_text()
        self.assertIn("infra_revision=88c4ac6f9a0c8270ea14ca411dcefa730776c990", workflow)
        self.assertIn("verified_contract servers/edge-dev-1.yaml", workflow)
        self.assertIn("verified_contract services/nilxone-identity.yaml", workflow)
        self.assertIn('[[ "$pinned" != "$current" ]]', workflow)
        self.assertIn("scripts/identity-envelope-recipient.sh", workflow)
        self.assertNotIn("contracts/servers/edge-prod-1.yaml", workflow)


if __name__ == "__main__":
    unittest.main()

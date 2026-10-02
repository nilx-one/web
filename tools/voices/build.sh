#!/bin/sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

# Renders every fixed Avaia line into deploy/web/voices/<version>/. The result
# is committed: a neural voice is not bit-for-bit reproducible across machines,
# and every clip is one a person can listen to before it ships.
set -eu
cd "$(dirname "$0")/../.."
python -m pip install -r tools/voices/requirements.txt
python -m pip install --no-deps -r tools/voices/requirements-nodeps.txt
python tools/voices/test_text.py
python tools/voices/render.py "$@"

#!/bin/sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu
cd "$(dirname "$0")/../.."
for model in sky dasha kai; do
    python "tools/avatars/$model/build_model.py" --output deploy/web/avatars/0.1.0
done
python tools/avatars/preview.py --thumbnails deploy/web/avatars/0.1.0
if [ -f tools/avatars/SHA256SUMS ]; then
    sha256sum --check tools/avatars/SHA256SUMS
fi

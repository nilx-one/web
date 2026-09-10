#!/bin/sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu
cd "$(dirname "$0")/../.."
for model in sky dasha kai; do
    python "tools/avatars/$model/build_model.py" --output deploy/web/avatars/0.1.0
done
python tools/avatars/preview.py --thumbnails deploy/web/avatars/0.1.0
python tools/avatars/dasha2/build_model.py --output deploy/web/avatars/0.3.0
# Dasha 2.0 is a wardrobe, so a still is generated for the published outfit and
# for every item a person can put on — a picker never stands a swatch in for
# cloth nobody rendered.
python tools/avatars/preview.py --models dasha-v2 --asset-dir deploy/web/avatars/0.3.0 --thumbnails deploy/web/avatars/0.3.0 --wardrobe
if [ -f tools/avatars/SHA256SUMS ]; then
    sha256sum --check tools/avatars/SHA256SUMS
fi

#!/bin/sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu
cd "$(dirname "$0")/../.."
python tools/monuments/motherland/build_model.py --output deploy/web/monuments/0.1.0

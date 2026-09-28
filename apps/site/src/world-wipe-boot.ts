// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { wipeLocalWorldOnce } from "./world-wipe";

// Imported first by main.tsx so the wipe lands before any store reads.
wipeLocalWorldOnce();

// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

interface ImportMetaEnv {
  readonly VITE_ERRORS_COLLECTOR_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

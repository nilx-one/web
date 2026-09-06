// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export { AppShell, type AppShellProps, type ShellSafeArea } from "./app-shell";
export {
  AppHeader,
  type AppHeaderProps,
  type HeaderAction,
} from "./app-header";
export {
  IDENTITY_ROUTE,
  SETTINGS_ROUTE,
  WORLD_ROUTE,
  sectionRoute,
  type ShellRoute,
  type ShellSection,
} from "./routes";
export {
  shellPresentationForWidth,
  useShellPresentation,
  type ShellPresentation,
} from "./shell-presentation";
export {
  ToastViewport,
  ToastViewportProvider,
  useToastViewportNode,
} from "./toast-viewport";

// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import "./app-header.css";
import {
  IDENTITY_ROUTE,
  SETTINGS_ROUTE,
  WORLD_ROUTE,
  sectionRoute,
  type ShellRoute,
  type ShellSection,
} from "./routes";
import type { ShellPresentation } from "./shell-presentation";

export interface HeaderAction {
  readonly id: string;
  readonly label: string;
  perform(): void;
}

export interface AppHeaderProps {
  readonly presentation: ShellPresentation;
  /** Current runtime host. Secondary context, never navigation. */
  readonly hostLabel: string;
  readonly section: ShellSection;
  /** The signed-in pub_dress, which is itself a native identity affordance. */
  readonly pubDress?: string;
  /** Host-specific and low-frequency application actions. */
  readonly actions?: readonly HeaderAction[];
  onNavigate(route: ShellRoute): void;
}

interface ShellLinkProps {
  readonly className: string;
  readonly route: ShellRoute;
  readonly section: ShellSection;
  readonly children: ReactNode;
  readonly label?: string;
  readonly role?: "menuitem";
  onNavigate(route: ShellRoute): void;
  onFollow?(): void;
}

/**
 * A canonical route is always a real link: it keeps the address bar, the
 * middle click and the context menu honest. Plain activation is routed in the
 * client.
 */
function ShellLink({
  className,
  route,
  section,
  children,
  label,
  role,
  onNavigate,
  onFollow,
}: ShellLinkProps) {
  function follow(event: MouseEvent<HTMLAnchorElement>): void {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onFollow?.();
    onNavigate(route);
  }

  return (
    <a
      className={className}
      href={route}
      onClick={follow}
      {...(label === undefined ? {} : { "aria-label": label })}
      {...(role === undefined ? {} : { role })}
      {...(sectionRoute(section) === route
        ? { "aria-current": "page" as const }
        : {})}
    >
      {children}
    </a>
  );
}

/**
 * Application navigation and host context. The header never owns the toast
 * stack, Bond state or the world's lifecycle.
 */
export function AppHeader({
  presentation,
  hostLabel,
  section,
  pubDress,
  actions = [],
  onNavigate,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const settingsInOverflow = presentation === "compact";

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu(true);
      }
    }

    function onPointerDown(event: Event): void {
      const target = event.target as Node | null;
      if (
        target !== null &&
        (menuRef.current?.contains(target) === true ||
          triggerRef.current?.contains(target) === true)
      ) {
        return;
      }
      closeMenu(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeMenu, menuOpen]);

  return (
    <header className="app-header" data-presentation={presentation}>
      <div className="app-header__zone app-header__zone--lead">
        <ShellLink
          className="app-header__brand"
          route={WORLD_ROUTE}
          section={section}
          label="0x1 world"
          onNavigate={onNavigate}
        >
          0x1
        </ShellLink>
        {presentation === "wide" ? (
          <nav className="app-header__routes" aria-label="0x1 navigation">
            <ShellLink
              className="app-header__route"
              route={IDENTITY_ROUTE}
              section={section}
              onNavigate={onNavigate}
            >
              /identity
            </ShellLink>
            <ShellLink
              className="app-header__route"
              route={SETTINGS_ROUTE}
              section={section}
              onNavigate={onNavigate}
            >
              /settings
            </ShellLink>
          </nav>
        ) : pubDress === undefined ? null : (
          <ShellLink
            className="app-header__identity"
            route={IDENTITY_ROUTE}
            section={section}
            onNavigate={onNavigate}
          >
            {pubDress}
          </ShellLink>
        )}
      </div>

      <div className="app-header__zone app-header__zone--trail">
        <span className="app-header__host">
          <i aria-hidden="true" />
          {hostLabel}
        </span>
        {presentation === "regular" ? (
          <ShellLink
            className="app-header__settings"
            route={SETTINGS_ROUTE}
            section={section}
            label="Settings"
            onNavigate={onNavigate}
          >
            <span aria-hidden="true">⚙︎</span>
          </ShellLink>
        ) : null}
        <div className="app-header__overflow">
          <button
            className="app-header__overflow-trigger"
            type="button"
            ref={triggerRef}
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">•••</span>
          </button>
          {menuOpen ? (
            <div
              className="app-header__menu"
              id={menuId}
              ref={menuRef}
              role="menu"
              aria-label="More"
            >
              {/* The host is already announced by the indicator beside the
                  trigger, so the menu repeats it visually only. */}
              <p className="app-header__menu-context" aria-hidden="true">
                {hostLabel}
              </p>
              {settingsInOverflow ? (
                <ShellLink
                  className="app-header__menu-item"
                  route={SETTINGS_ROUTE}
                  section={section}
                  role="menuitem"
                  onNavigate={onNavigate}
                  onFollow={() => closeMenu(false)}
                >
                  Settings
                </ShellLink>
              ) : null}
              {actions.map((action) => (
                <button
                  className="app-header__menu-item"
                  key={action.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu(false);
                    action.perform();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

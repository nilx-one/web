// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { useLocalization, type Translate } from "./localization";
import "./dock-window.css";

export type DockNavigation = "push" | "pop";

export interface DockWindowProps {
  readonly screen: string;
  readonly depth: number;
  readonly children: ReactNode;
}

interface DockScreen {
  readonly screen: string;
  readonly depth: number;
  readonly content: ReactNode;
}

interface DockTransition {
  readonly navigation: DockNavigation;
  readonly from: ReactNode;
  readonly pair: string;
}

export const DOCK_WINDOW_TRANSITION_MS = 420;

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

function localizeText(value: string, t: Translate): string {
  switch (value) {
    case "edit":
      return t("dock.edit");
    case "AI":
      return t("dock.ai");
    case "unconfigured":
      return t("dock.unconfigured");
    case "Owned Avaia":
      return t("dock.ownedAvaia");
    case "Personal Bond":
      return t("dock.personalBond");
    case "Providers":
      return t("dock.providers");
    case "Connected":
      return t("dock.connected");
    case "Open":
      return t("dock.open");
    case "3D model":
      return t("dock.threeDModel");
    case "Cancel":
      return t("dock.cancel");
    case "Save":
      return t("dock.save");
    case "Saving…":
      return t("dock.saving");
    case "Case-sensitive · the owner discriminator and ai suffix are fixed by 0x1.":
      return t("dock.caseSensitiveAvaia");
    case "Case-sensitive · the address is part of the Bond identity.":
      return t("dock.caseSensitiveBond");
    case "The studies share one skeleton and one set of clips; choosing changes the body, not how it moves.":
      return t("dock.studies");
    case "A provider account is an identity this Bond points at, one account per provider.":
      return t("dock.providerDescription");
    default:
      return value;
  }
}

function localizeNode(node: ReactNode, t: Translate): ReactNode {
  if (typeof node === "string") return localizeText(node, t);
  if (Array.isArray(node)) return node.map((child) => localizeNode(child, t));
  if (!isValidElement(node)) return node;

  const element = node as ReactElement<Record<string, unknown>>;
  const props = element.props;
  const nextProps: Record<string, unknown> = { ...props };

  for (const key of ["aria-label", "title", "label"] as const) {
    const value = props[key];
    if (typeof value === "string") nextProps[key] = localizeText(value, t);
  }

  if ("children" in props) {
    nextProps.children = localizeNode(props.children as ReactNode, t);
  }

  return cloneElement(element, nextProps);
}

function LocalizedDockContent({ children }: { children: ReactNode }) {
  const { t } = useLocalization();
  return <>{localizeNode(children, t)}</>;
}

export function DockWindow({ screen, depth, children }: DockWindowProps) {
  const [settled, setSettled] = useState<DockScreen>({
    screen,
    depth,
    content: children,
  });
  const [transition, setTransition] = useState<DockTransition | undefined>(
    undefined,
  );
  const windowRef = useRef<HTMLDivElement | null>(null);
  const enteringRef = useRef<HTMLDivElement | null>(null);
  const settledHeight = useRef(0);

  if (settled.screen !== screen) {
    setTransition({
      navigation: depth < settled.depth ? "pop" : "push",
      from: settled.content,
      pair: `${settled.screen}:${screen}`,
    });
    setSettled({ screen, depth, content: children });
  }

  useLayoutEffect(() => {
    const element = windowRef.current;
    if (element === null) return;

    if (transition === undefined) {
      element.style.height = "";
      settledHeight.current = element.offsetHeight;
      return;
    }

    const from =
      element.style.height === ""
        ? settledHeight.current
        : element.getBoundingClientRect().height;
    const to = enteringRef.current?.offsetHeight ?? 0;

    if (from === 0 || to === 0 || prefersReducedMotion()) {
      setTransition(undefined);
      return;
    }

    element.style.height = `${from}px`;
    void element.offsetHeight;
    element.style.height = `${to}px`;
  }, [transition]);

  useEffect(() => {
    if (transition === undefined) return;
    const timer = window.setTimeout(
      () => setTransition(undefined),
      DOCK_WINDOW_TRANSITION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [transition]);

  return (
    <div
      className="bond-dock__window"
      ref={windowRef}
      {...(transition === undefined
        ? {}
        : { "data-navigation": transition.navigation })}
    >
      {transition === undefined ? null : (
        <div
          className="bond-dock__screen"
          data-phase="from"
          key={`from:${transition.pair}`}
          aria-hidden="true"
          inert
        >
          <LocalizedDockContent>{transition.from}</LocalizedDockContent>
        </div>
      )}
      <div
        className="bond-dock__screen"
        data-phase={transition === undefined ? "settled" : "to"}
        key={screen}
        ref={enteringRef}
      >
        <LocalizedDockContent>{children}</LocalizedDockContent>
      </div>
    </div>
  );
}

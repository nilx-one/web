// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { DockSeat } from "./bond-dock-view-model";

import "./follow-arrows.css";

/**
 * Ribbons of light that sweep around the two seats, gold beneath and cyan
 * above, flowing the same way the chevrons do. Pure ornament behind the
 * pair: hidden from assistive technology and from the pointer.
 */
export function LightTrails({ leader }: { readonly leader: DockSeat }) {
  return (
    <svg
      className="light-trails"
      data-leader={leader}
      viewBox="0 0 400 200"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="light-trails-gold" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#ffcf7a" stopOpacity="0" />
          <stop offset="0.25" stopColor="#ffb44d" />
          <stop offset="0.7" stopColor="#ffd88f" />
          <stop offset="1" stopColor="#ff9a3c" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="light-trails-cyan" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#7af4ff" stopOpacity="0" />
          <stop offset="0.4" stopColor="#5fe6ff" />
          <stop offset="1" stopColor="#b9f8ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        className="light-trails__ribbon light-trails__ribbon--gold"
        d="M4 120 C 40 214, 170 206, 214 172 S 340 132, 396 186"
        pathLength="100"
      />
      <path
        className="light-trails__spark light-trails__spark--gold"
        d="M4 120 C 40 214, 170 206, 214 172 S 340 132, 396 186"
        pathLength="100"
      />
      <path
        className="light-trails__ribbon light-trails__ribbon--cyan"
        d="M14 64 C 60 -14, 180 -6, 228 26 S 352 70, 394 14"
        pathLength="100"
      />
      <path
        className="light-trails__spark light-trails__spark--cyan"
        d="M14 64 C 60 -14, 180 -6, 228 26 S 352 70, 394 14"
        pathLength="100"
      />
    </svg>
  );
}

/**
 * The wheel between the two seats: chevrons flow from whoever drives the
 * camera towards whoever follows it. The Avaia sits on the left, so when the
 * Bond takes the wheel the chevrons turn half a circle and flow the other
 * way. It shows who drives this device's camera, not a relationship.
 */
export function FollowArrows({
  leader,
  label,
}: {
  readonly leader: DockSeat;
  readonly label: string;
}) {
  return (
    <span
      className="follow-arrows"
      data-leader={leader}
      role="img"
      aria-label={label}
    >
      <span className="follow-arrows__track" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <svg
            key={index}
            className="follow-arrows__chevron"
            viewBox="0 0 12 20"
            style={{ animationDelay: `${index * 180}ms` }}
          >
            <path d="M2 2 L10 10 L2 18" />
          </svg>
        ))}
      </span>
    </span>
  );
}

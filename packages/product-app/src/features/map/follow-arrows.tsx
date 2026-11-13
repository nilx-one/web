// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { DockSeat } from "./bond-dock-view-model";

import "./follow-arrows.css";

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

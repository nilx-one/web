// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Application-level ownership for camera motion.
 *
 * This state is presentation only. It never changes geography, presence, a
 * Bond, BondChain, or Relationship state.
 */
export type CameraOwner = "unclaimed" | "person" | "application";

/** The product meanings that may ask the camera to move. */
export type CameraFocusSource = "location" | "body" | "fragment";

export interface ActiveCameraFocus {
  readonly source: CameraFocusSource;
  readonly generation: number;
  /** True only when a person explicitly invoked this application focus. */
  readonly explicit: boolean;
}

export interface CameraCoordinationState {
  readonly owner: CameraOwner;
  readonly generation: number;
  readonly active?: ActiveCameraFocus;
}

export const INITIAL_CAMERA_COORDINATION: CameraCoordinationState = {
  owner: "unclaimed",
  generation: 0,
};

export interface CameraFocusRequest<TTarget> {
  readonly source: CameraFocusSource;
  readonly target: TTarget;
  /**
   * Explicit means a person asked for this focus through a product control.
   * Automatic first-fix or narration motion is never explicit.
   */
  readonly explicit: boolean;
}

export type CameraFocusDecision<TTarget> =
  | {
      readonly kind: "accepted";
      readonly state: CameraCoordinationState;
      readonly target: TTarget;
      /** The caller should cancel any in-flight application transition first. */
      readonly cancelActive: boolean;
    }
  | {
      readonly kind: "blocked";
      readonly state: CameraCoordinationState;
      readonly reason: "person-owns-camera" | "application-transition-active";
    };

/**
 * A direct pan/zoom/rotate gesture always wins immediately.
 *
 * Person ownership persists after the gesture ends so automatic application
 * motion cannot steal the camera later. Only another explicit product focus
 * may intentionally hand control back to the application.
 */
export function personCameraGesture(state: CameraCoordinationState): {
  readonly state: CameraCoordinationState;
  readonly cancelActive: boolean;
} {
  return {
    state: {
      owner: "person",
      generation: state.generation + 1,
    },
    cancelActive: state.active !== undefined,
  };
}

/**
 * Deterministic precedence:
 *
 * 1. a direct person gesture owns the camera over every automatic request;
 * 2. any explicit product focus (location, body, or fragment) represents the
 *    person's newest intent and may retarget an in-flight application move;
 * 3. an in-flight application move is not interrupted by automatic motion;
 * 4. automatic motion is accepted only while the camera is otherwise free.
 *
 * Sources are intentionally equal at the explicit tier. The latest explicit
 * action is the truth; adding a future source does not require a priority hack.
 */
export function coordinateCameraFocus<TTarget>(
  state: CameraCoordinationState,
  request: CameraFocusRequest<TTarget>,
): CameraFocusDecision<TTarget> {
  if (!request.explicit && state.owner === "person") {
    return { kind: "blocked", state, reason: "person-owns-camera" };
  }

  if (!request.explicit && state.active !== undefined) {
    return {
      kind: "blocked",
      state,
      reason: "application-transition-active",
    };
  }

  const generation = state.generation + 1;
  return {
    kind: "accepted",
    target: request.target,
    cancelActive: state.active !== undefined,
    state: {
      owner: "application",
      generation,
      active: {
        source: request.source,
        generation,
        explicit: request.explicit,
      },
    },
  };
}

/**
 * Completing an old transition cannot release a newer camera owner. The
 * generation is the cancellation boundary between successive focus requests.
 */
export function completeCameraFocus(
  state: CameraCoordinationState,
  generation: number,
): CameraCoordinationState {
  if (state.active?.generation !== generation) return state;
  return {
    owner: "unclaimed",
    generation: state.generation,
  };
}

// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Host-mediated sound.
 *
 * Sound is presentation and nothing else. The application names a moment —
 * the Avaia set off, a landmark went in the notebook — and the host decides
 * what that moment sounds like, the same way it decides what an impact feels
 * like. Every line a sound accompanies is still written and announced: a
 * person who hears nothing loses nothing they need.
 *
 * The contract stays free of DOM types so a native host can implement it
 * without a browser.
 */

/**
 * A moment worth a sound. The vocabulary is the product's; what each one
 * sounds like is the host's.
 */
export type SoundCue =
  /** A press on the Dock or another control that acts at once. */
  | "tap"
  /** One footfall of a body walking. */
  | "step"
  /** The Avaia set off where it was sent. */
  | "walk"
  /** The Avaia would not go there, and is about to say why. */
  | "refuse"
  /** The Avaia noticed a landmark it wants to look at. */
  | "spot"
  /** A landmark went into the notebook. */
  | "study"
  /** Fog lifted from a cell. */
  | "reveal"
  /** An achievement paid. */
  | "achievement"
  /** A nearby Bond's spoken line arrived. */
  | "heard"
  /** A failure notice opened. */
  | "failure";

export const SOUND_CUES: readonly SoundCue[] = Object.freeze([
  "tap",
  "step",
  "walk",
  "refuse",
  "spot",
  "study",
  "reveal",
  "achievement",
  "heard",
  "failure",
]);

/**
 * What the world in view sounds like, each part from 0 to 1. It is derived
 * from what the basemap paints and what this device revealed, and it says
 * nothing about where anyone is.
 */
export interface SoundAmbience {
  /** How close the view is to the ground: zoomed out to a city is quiet. */
  readonly presence: number;
  /** How much of the ground in view is water. */
  readonly water: number;
  /** How built-up the ground in view is. */
  readonly city: number;
  /**
   * How much of the ground in view is revealed. Fog muffles the world: 0
   * sounds as if heard through a wall, 1 is heard plainly.
   */
  readonly clarity: number;
}

/**
 * A line a character says aloud, recorded ahead of time. The written line is
 * still the fact: a voice only says it, and a line that cannot be heard is
 * still read.
 */
export interface SoundVoiceLine {
  /** Where the recording is, on the product's own origin. */
  readonly url: string;
}

export interface SoundCapability {
  /** Whether this host can make any sound at all. */
  readonly supported: boolean;
  /**
   * Whether the person wants sound. A host keeps no preference of its own and
   * starts disabled: until this is called, nothing is played and no audio
   * device is opened.
   */
  setEnabled(enabled: boolean): void;
  /**
   * Plays a cue now. Never throws and never waits. A cue the host cannot play
   * yet — disabled, not unlocked by a gesture, page hidden — is dropped, not
   * queued: a sound late is a sound about something else.
   */
  play(cue: SoundCue): void;
  /** The bed under the cues. `null` fades it out. */
  setAmbience(ambience: SoundAmbience | null): void;
  /**
   * Says a recorded line. One voice says one thing at a time, so a new line
   * cuts off the one before it, and the bed dips while it speaks. A line that
   * cannot be fetched or decoded soon enough is dropped, like a late cue.
   */
  speak(line: SoundVoiceLine): void;
}

/** The canonical answer of a host that has no sound. */
export const SILENT_SOUND: SoundCapability = Object.freeze({
  supported: false,
  setEnabled: () => undefined,
  play: () => undefined,
  setAmbience: () => undefined,
  speak: () => undefined,
});

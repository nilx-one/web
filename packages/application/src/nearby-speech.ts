// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * A line a Bond said aloud, as this client is told it.
 *
 * It is presentation of an utterance: not an Interaction, not BondChain
 * evidence, and not a claim about where anyone is. The service decides who is
 * within earshot; a line never carries a coordinate, so this client cannot
 * learn where the speaker stands from it.
 */
export interface SpokenLineView {
  /** `line_` and 64 lowercase hex digits; one utterance, one id. */
  readonly id: string;
  /** The `pub_dress` of the Bond that spoke. */
  readonly speaker: string;
  readonly text: string;
  /** Unix epoch seconds. */
  readonly spokenAt: number;
}

/**
 * Reads what the signed-in Bond can hear right now. `undefined` means the
 * service did not answer usefully — not signed in, not offered, or
 * unreachable — and is a normal state, never an error to show.
 */
export interface NearbySpeechAccessPort {
  readNearbySpeech(): Promise<readonly SpokenLineView[] | undefined>;
}

export function hasNearbySpeechAccess(
  value: unknown,
): value is NearbySpeechAccessPort {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof (value as Partial<NearbySpeechAccessPort>).readNearbySpeech ===
    "function"
  );
}

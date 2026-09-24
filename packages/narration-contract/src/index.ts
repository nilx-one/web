// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The cell-bound narration boundary.
 *
 * Narration describes ground a person already lit by being there. It is a reading of the
 * local journal, never a source of new facts: an adapter may phrase a visit, and may not
 * invent one, extend one, or imply that anyone else was present. Phase 2 serves this
 * contract with deterministic templates; a later model adapter serves the same contract and
 * changes language quality only.
 *
 * Zero dependency by construction. It names a cell the way `@nilx-one/presence-contract`
 * does — an opaque index — and repeats the alias rather than importing it, so that nothing
 * about narration can reach into the journal's own boundary.
 */

/** Opaque H3 cell index. Concrete H3 operations stay in adapters. */
export type CellIndex = string;

/** What kind of local evidence a fragment is asked to describe. */
export type CellEvidenceKind = "visit";

/**
 * One structured, already-local piece of evidence offered for narration.
 *
 * `to` is `null` while the visit is still open. An adapter must phrase that as unfinished
 * rather than choosing an end for it.
 */
export interface CellEvidence {
  readonly cell: CellIndex;
  readonly from: number;
  readonly to: number | null;
  readonly kind: CellEvidenceKind;
}

/**
 * Who wrote a fragment's text.
 *
 * Carried on the fragment itself so that whatever keeps a fragment keeps this too. A licence
 * can reach past the device: Llama 3.2's reaches the name of any model trained on its
 * outputs, which is why `nilx-one/ai`'s presence-journal egress policy reads this field.
 */
export interface NarrationProvenance {
  /** The adapter whose model wrote the text. */
  readonly adapter: string;
  /** The model that wrote it, as its catalog names it. */
  readonly modelId: string;
  /** The licence that model's weights are distributed under, as its upstream card names it. */
  readonly licence: string;
}

/** One sentence about one cell, anchored to a moment inside that cell's evidence. */
export interface NarrationFragment {
  readonly cell: CellIndex;
  readonly at: number;
  readonly text: string;
  /**
   * Set on text a model wrote, and only there. A fragment without it carries text no model
   * wrote — the deterministic sentence, including one a model was asked to rephrase and whose
   * rephrasing was refused.
   */
  readonly producedBy?: NarrationProvenance;
}

/** Why an adapter cannot narrate on this surface right now. */
export type NarrationUnavailableReason =
  "surface_unsupported" | "not_loaded" | "load_failed" | "withheld";

/**
 * Whether an adapter can narrate here, as a fact rather than an attempt.
 *
 * A surface that cannot run one adapter is not a surface without narration: the
 * deterministic adapter is the product there, not a fallback it degrades into.
 */
export type NarrationCapability =
  | { readonly kind: "ready"; readonly adapter: string }
  | {
      readonly kind: "unavailable";
      readonly adapter: string;
      readonly reason: NarrationUnavailableReason;
    };

/** One way of turning local evidence into cell-bound sentences. */
export interface NarrationAdapter {
  /** Stable identifier, so a product can report which adapter spoke. */
  readonly id: string;
  /** Never downloads and never loads: asking is not starting. */
  capability(): Promise<NarrationCapability>;
  /** One bounded pass over the evidence it was given. */
  narrate(
    evidence: readonly CellEvidence[],
  ): Promise<readonly NarrationFragment[]>;
}

/** Why a produced fragment is not admissible against the evidence it claims to describe. */
export type FragmentRejection =
  | { readonly reason: "cell_not_offered"; readonly cell: CellIndex }
  | {
      readonly reason: "moment_outside_evidence";
      readonly cell: CellIndex;
      readonly at: number;
    }
  | { readonly reason: "empty_text"; readonly cell: CellIndex };

/** What survived the check, and what did not.  */
export interface AdmittedNarration {
  readonly fragments: readonly NarrationFragment[];
  readonly rejected: readonly FragmentRejection[];
}

/**
 * Keeps only fragments the offered evidence can carry.
 *
 * This is the boundary that makes a model adapter safe to add later, and it is applied to
 * every adapter including the deterministic one — a check that runs only over output you
 * already trust is a check that has never run. A fragment about a cell nobody offered is
 * narration of ground this person did not light; a moment outside the evidence window is a
 * visit stretched to fit a sentence. Both are dropped rather than repaired, and named, so a
 * product can see that an adapter tried.
 */
export function admitFragments(
  evidence: readonly CellEvidence[],
  fragments: readonly NarrationFragment[],
): AdmittedNarration {
  const windows = new Map<CellIndex, { from: number; to: number }>();
  for (const record of evidence) {
    const existing = windows.get(record.cell);
    const from = Math.min(existing?.from ?? record.from, record.from);
    const to = Math.max(
      existing?.to ?? record.from,
      record.to ?? Number.MAX_SAFE_INTEGER,
    );
    windows.set(record.cell, { from, to });
  }

  const admitted: NarrationFragment[] = [];
  const rejected: FragmentRejection[] = [];

  for (const fragment of fragments) {
    const window = windows.get(fragment.cell);
    if (window === undefined) {
      rejected.push({ reason: "cell_not_offered", cell: fragment.cell });
      continue;
    }
    if (fragment.text.trim() === "") {
      rejected.push({ reason: "empty_text", cell: fragment.cell });
      continue;
    }
    if (fragment.at < window.from || fragment.at > window.to) {
      rejected.push({
        reason: "moment_outside_evidence",
        cell: fragment.cell,
        at: fragment.at,
      });
      continue;
    }
    admitted.push(fragment);
  }

  return { fragments: admitted, rejected };
}

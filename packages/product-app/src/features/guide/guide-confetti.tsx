// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CSSProperties } from "react";

/**
 * Whose experience a burst celebrates. The Bond's is cyan and its Avaia's is
 * violet, here and wherever experience is shown, so the colour alone already
 * says who grew.
 */
export type GuideXpSubject = "bond" | "avaia";

export type ConfettiShape = "ribbon" | "dot" | "x" | "spark";

export interface ConfettiPiece {
  readonly shape: ConfettiShape;
  /** Where it is thrown to, in pixels from where it burst. */
  readonly dx: number;
  readonly dy: number;
  /** How far it drops afterwards. */
  readonly fall: number;
  readonly spin: number;
  readonly size: number;
  readonly delayMs: number;
  readonly durationMs: number;
  /** 0 is the deep shade of the subject's colour, 1 the light one. */
  readonly tone: 0 | 1;
}

export const CONFETTI_PIECES = 22;

const SHAPES: readonly ConfettiShape[] = [
  "ribbon",
  "ribbon",
  "dot",
  "x",
  "ribbon",
  "spark",
];

/** A small seeded generator, so a burst is the same burst every time. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function seedOf(value: string): number {
  let hash = 0x811c9dc5;
  for (const scalar of value) {
    hash ^= scalar.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A burst thrown up and out of a line of experience — mostly upwards, the
 * way a popper goes off — before it tumbles back down and fades.
 */
export function confettiBurst(
  subject: GuideXpSubject,
  salt: string,
  count: number = CONFETTI_PIECES,
): readonly ConfettiPiece[] {
  const random = mulberry32(seedOf(`${subject}:${salt}`));
  return Array.from({ length: count }, (_, index) => {
    // A fan opening upwards, a little wider on the Avaia's side.
    const spread = subject === "bond" ? 150 : 170;
    const angle =
      -90 + (random() - 0.5) * spread + (subject === "avaia" ? 8 : -8);
    const reach = 60 + random() * 110;
    const radians = (angle * Math.PI) / 180;
    return {
      shape: SHAPES[index % SHAPES.length] ?? "ribbon",
      dx: Math.round(Math.cos(radians) * reach),
      dy: Math.round(Math.sin(radians) * reach),
      fall: Math.round(70 + random() * 90),
      spin: Math.round((random() - 0.5) * 900),
      size: Math.round(6 + random() * 6),
      delayMs: Math.round(random() * 120),
      durationMs: Math.round(1_300 + random() * 700),
      tone: random() < 0.5 ? 0 : 1,
    };
  });
}

type PieceStyle = CSSProperties & Record<`--${string}`, string>;

export interface GuideConfettiProps {
  readonly subject: GuideXpSubject;
  readonly salt: string;
  /** When the burst goes off, after the line it sits on has landed. */
  readonly delayMs: number;
}

/** Decoration only: hidden from assistive technology and never focusable. */
export function GuideConfetti({ subject, salt, delayMs }: GuideConfettiProps) {
  const pieces = confettiBurst(subject, salt);
  return (
    <span className="guide-confetti" data-subject={subject} aria-hidden="true">
      {pieces.map((piece, index) => {
        const style: PieceStyle = {
          "--dx": `${piece.dx}px`,
          "--dy": `${piece.dy}px`,
          "--fall": `${piece.fall}px`,
          "--spin": `${piece.spin}deg`,
          "--size": `${piece.size}px`,
          "--delay": `${delayMs + piece.delayMs}ms`,
          "--duration": `${piece.durationMs}ms`,
        };
        return (
          <span
            key={index}
            className="guide-confetti__piece"
            data-shape={piece.shape}
            data-tone={piece.tone}
            style={style}
          >
            <span className="guide-confetti__paper" />
          </span>
        );
      })}
    </span>
  );
}

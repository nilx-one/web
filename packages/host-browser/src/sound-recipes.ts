// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundCue } from "@nilx-one/host-contract";

/**
 * What each cue sounds like in a browser, synthesised on the spot.
 *
 * Nothing here is a recording: every cue is a few oscillators and a little
 * filtered noise, so there is no asset to fetch, license or keep in step with
 * a locale. The palette is soft and glassy — sine and triangle voices with
 * quick attacks and long tails, tuned to one pentatonic family so cues that
 * overlap never clash — and quiet, because a cue accompanies the interface
 * rather than announcing itself over it.
 *
 * A recipe only schedules. It takes any `BaseAudioContext`, so the same
 * recipe plays live and renders offline.
 */
export interface CueVoice {
  readonly context: BaseAudioContext;
  /** Where the cue is mixed into. */
  readonly output: AudioNode;
  /** Context time the cue starts at. */
  readonly at: number;
  /** 0 ≤ n < 1; a little variation keeps repeated cues from sounding stamped. */
  readonly random: () => number;
}

/** Longest any recipe rings for, in seconds. */
export const CUE_MAX_SECONDS = 2;

const SILENT = 0.0001;

/** Equal temperament around A4 = 440 Hz. */
function note(semitonesFromA4: number): number {
  return 440 * 2 ** (semitonesFromA4 / 12);
}

const C4 = note(-9);
const E4 = note(-5);
const G4 = note(-2);
const A4 = note(0);
const C5 = note(3);
const D5 = note(5);
const E5 = note(7);
const G5 = note(10);
const A5 = note(12);
const C6 = note(15);
const E6 = note(19);
const A6 = note(24);

interface ToneShape {
  readonly type: OscillatorType;
  readonly frequency: number;
  /** Where the pitch glides to over the decay, when it moves at all. */
  readonly glideTo?: number;
  /** Seconds after the cue starts. */
  readonly offset?: number;
  readonly attack?: number;
  readonly decay: number;
  readonly gain: number;
  readonly destination?: AudioNode;
}

/** An envelope that rises from silence and decays back to it. */
function envelope(
  voice: CueVoice,
  start: number,
  attack: number,
  decay: number,
  peak: number,
): GainNode {
  const gain = voice.context.createGain();
  gain.gain.setValueAtTime(SILENT, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(SILENT, start + attack + decay);
  return gain;
}

function tone(voice: CueVoice, shape: ToneShape): void {
  const start = voice.at + (shape.offset ?? 0);
  const attack = shape.attack ?? 0.004;
  const end = start + attack + shape.decay;
  const oscillator = voice.context.createOscillator();
  oscillator.type = shape.type;
  oscillator.frequency.setValueAtTime(shape.frequency, start);
  if (shape.glideTo !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(shape.glideTo, end);
  }
  const gain = envelope(voice, start, attack, shape.decay, shape.gain);
  oscillator.connect(gain).connect(shape.destination ?? voice.output);
  oscillator.start(start);
  oscillator.stop(end + 0.05);
}

interface BellShape {
  readonly frequency: number;
  readonly offset?: number;
  readonly attack?: number;
  readonly decay: number;
  readonly gain: number;
  /** Modulator to carrier frequency ratio; non-integer ratios ring metallic. */
  readonly ratio?: number;
  /** How bright the strike is before it mellows. */
  readonly brightness?: number;
}

/**
 * Two-operator FM: a modulator whose depth decays faster than the carrier,
 * so the strike is bright and the tail is a pure tone — a small glass bell.
 */
function bell(voice: CueVoice, shape: BellShape): void {
  const start = voice.at + (shape.offset ?? 0);
  const attack = shape.attack ?? 0.003;
  const end = start + attack + shape.decay;
  const context = voice.context;
  const carrier = context.createOscillator();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(shape.frequency, start);
  const modulator = context.createOscillator();
  modulator.type = "sine";
  modulator.frequency.setValueAtTime(
    shape.frequency * (shape.ratio ?? 3.5),
    start,
  );
  const depth = context.createGain();
  const index = shape.frequency * (shape.brightness ?? 1.2);
  depth.gain.setValueAtTime(index, start);
  depth.gain.exponentialRampToValueAtTime(
    Math.max(SILENT, index * 0.01),
    start + attack + shape.decay * 0.45,
  );
  modulator.connect(depth).connect(carrier.frequency);
  const gain = envelope(voice, start, attack, shape.decay, shape.gain);
  carrier.connect(gain).connect(voice.output);
  carrier.start(start);
  modulator.start(start);
  carrier.stop(end + 0.05);
  modulator.stop(end + 0.05);
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise per context, shared by every cue that needs it. */
export function noiseBuffer(
  context: BaseAudioContext,
  random: () => number,
): AudioBuffer {
  const cached = noiseBuffers.get(context);
  if (cached !== undefined) return cached;
  const buffer = context.createBuffer(
    1,
    context.sampleRate,
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = random() * 2 - 1;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
}

interface NoiseShape {
  readonly filter: BiquadFilterType;
  readonly frequency: number;
  /** Where the filter sweeps to over the burst, when it moves at all. */
  readonly sweepTo?: number;
  readonly q?: number;
  readonly offset?: number;
  readonly attack?: number;
  readonly decay: number;
  readonly gain: number;
  readonly pan?: number;
}

function noise(voice: CueVoice, shape: NoiseShape): void {
  const context = voice.context;
  const start = voice.at + (shape.offset ?? 0);
  const attack = shape.attack ?? 0.002;
  const end = start + attack + shape.decay;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context, voice.random);
  const filter = context.createBiquadFilter();
  filter.type = shape.filter;
  filter.frequency.setValueAtTime(shape.frequency, start);
  if (shape.sweepTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(shape.sweepTo, end);
  }
  filter.Q.setValueAtTime(shape.q ?? 0.8, start);
  const gain = envelope(voice, start, attack, shape.decay, shape.gain);
  const panner = context.createStereoPanner();
  panner.pan.setValueAtTime(shape.pan ?? 0, start);
  source.connect(filter).connect(gain).connect(panner).connect(voice.output);
  // A random read head, so two bursts in a row are not the same grain.
  source.start(start, voice.random() * 0.5);
  source.stop(end + 0.05);
}

function lowpass(voice: CueVoice, frequency: number, q = 0.7): AudioNode {
  const filter = voice.context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(frequency, voice.at);
  filter.Q.setValueAtTime(q, voice.at);
  filter.connect(voice.output);
  return filter;
}

/** A soft glass click: the press was taken. */
function tap(voice: CueVoice): void {
  tone(voice, {
    type: "sine",
    frequency: E6,
    glideTo: A5,
    attack: 0.002,
    decay: 0.06,
    gain: 0.1,
  });
  tone(voice, {
    type: "triangle",
    frequency: E6 * 2,
    attack: 0.001,
    decay: 0.025,
    gain: 0.015,
  });
}

/** A footfall: a soft scuff and a low thump, never twice the same. */
function step(voice: CueVoice): void {
  const r = voice.random();
  noise(voice, {
    filter: "bandpass",
    frequency: 450 + r * 450,
    q: 1.1,
    decay: 0.045 + voice.random() * 0.02,
    gain: 0.06,
    pan: (voice.random() - 0.5) * 0.4,
  });
  tone(voice, {
    type: "sine",
    frequency: 120 + r * 20,
    glideTo: 70,
    attack: 0.002,
    decay: 0.05,
    gain: 0.035,
  });
}

/** Off it goes: a rising fourth. */
function walk(voice: CueVoice): void {
  tone(voice, { type: "triangle", frequency: D5, decay: 0.18, gain: 0.08 });
  tone(voice, {
    type: "triangle",
    frequency: A5,
    offset: 0.07,
    decay: 0.22,
    gain: 0.08,
  });
  tone(voice, {
    type: "sine",
    frequency: D5 / 2,
    decay: 0.2,
    gain: 0.03,
  });
}

/** "Uh-uh": two muffled notes that fall. */
function refuse(voice: CueVoice): void {
  const muffled = lowpass(voice, 1400);
  tone(voice, {
    type: "sine",
    frequency: E4,
    glideTo: note(-7),
    decay: 0.13,
    gain: 0.12,
    destination: muffled,
  });
  tone(voice, {
    type: "triangle",
    frequency: C4,
    glideTo: note(-12),
    offset: 0.12,
    decay: 0.2,
    gain: 0.1,
    destination: muffled,
  });
}

/** Something caught its eye: three notes up, the last one a bell. */
function spot(voice: CueVoice): void {
  tone(voice, { type: "sine", frequency: E5, decay: 0.16, gain: 0.06 });
  tone(voice, {
    type: "sine",
    frequency: G5,
    offset: 0.06,
    decay: 0.16,
    gain: 0.06,
  });
  bell(voice, { frequency: C6, offset: 0.12, decay: 0.5, gain: 0.05 });
}

/** It went in the notebook: a warm chord that blooms and lingers. */
function study(voice: CueVoice): void {
  const chord = [A4, note(4), E5];
  chord.forEach((frequency, index) => {
    bell(voice, {
      frequency,
      offset: index * 0.045,
      attack: 0.02,
      decay: 1.2,
      gain: 0.055,
      ratio: 2,
      brightness: 0.6,
    });
  });
  tone(voice, {
    type: "sine",
    frequency: A6,
    offset: 0.15,
    attack: 0.08,
    decay: 0.9,
    gain: 0.012,
  });
}

/** Fog lifting: a filter opening over noise, and the ground ringing clear. */
function reveal(voice: CueVoice): void {
  noise(voice, {
    filter: "lowpass",
    frequency: 300,
    sweepTo: 5200,
    q: 1.4,
    attack: 0.3,
    decay: 0.85,
    gain: 0.07,
  });
  bell(voice, { frequency: E6, offset: 0.35, decay: 0.8, gain: 0.035 });
  bell(voice, {
    frequency: note(26),
    offset: 0.5,
    decay: 0.9,
    gain: 0.025,
  });
}

/** It paid: a bell arpeggio up an octave, then the chord held under it. */
function achievement(voice: CueVoice): void {
  [C5, E5, G5, C6].forEach((frequency, index) => {
    bell(voice, {
      frequency,
      offset: index * 0.09,
      decay: 0.9,
      gain: 0.075,
      brightness: 0.9,
    });
  });
  [C5, E5, G5].forEach((frequency) => {
    tone(voice, {
      type: "sine",
      frequency,
      offset: 0.36,
      attack: 0.08,
      decay: 1.4,
      gain: 0.035,
    });
  });
}

/** Someone near spoke: two soft notes, a little distant. */
function heard(voice: CueVoice): void {
  const distant = lowpass(voice, 2200);
  tone(voice, {
    type: "triangle",
    frequency: G5,
    decay: 0.22,
    gain: 0.07,
    destination: distant,
  });
  tone(voice, {
    type: "triangle",
    frequency: D5,
    offset: 0.12,
    decay: 0.3,
    gain: 0.07,
    destination: distant,
  });
}

/** Something went wrong: low, short, and not alarming. */
function failure(voice: CueVoice): void {
  const dull = lowpass(voice, 800);
  tone(voice, {
    type: "square",
    frequency: E4,
    decay: 0.16,
    gain: 0.05,
    destination: dull,
  });
  tone(voice, {
    type: "square",
    frequency: C4,
    offset: 0.13,
    decay: 0.24,
    gain: 0.05,
    destination: dull,
  });
  tone(voice, {
    type: "sine",
    frequency: G4 / 2,
    offset: 0.13,
    decay: 0.24,
    gain: 0.03,
  });
}

export const CUE_RECIPES: Readonly<
  Record<SoundCue, (voice: CueVoice) => void>
> = {
  tap,
  step,
  walk,
  refuse,
  spot,
  study,
  reveal,
  achievement,
  heard,
  failure,
};

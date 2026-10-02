// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundAmbience } from "@nilx-one/host-contract";

import { noiseBuffer } from "./sound-recipes";

/**
 * The bed under the cues: wind over open ground, water lapping, the low
 * murmur of a built-up street — all one noise source shaped three ways, so
 * nothing is downloaded. The whole bed runs through one lowpass filter, and
 * that filter is the fog: ground nobody revealed is heard as if through a
 * wall, and revealing it opens the filter.
 */
export interface AmbienceBed {
  /** Moves every layer toward `ambience`, smoothly. */
  set(ambience: SoundAmbience): void;
  /** Fades the bed out; it can be set again afterwards. */
  fadeOut(): void;
  /** Stops every source. The bed cannot be used afterwards. */
  stop(): void;
}

/** How quickly the bed follows a change, as a time constant in seconds. */
const FOLLOW_SECONDS = 0.8;

/** The fog filter's range: a wall at 0, open air at 1. */
const MUFFLED_HZ = 280;
const CLEAR_HZ = 7200;

export interface AmbienceLevels {
  readonly wind: number;
  readonly water: number;
  readonly city: number;
  readonly bed: number;
  readonly clarityHz: number;
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * How loud each layer is for an ambience. Wind is what open ground sounds
 * like, so streets and water take its place rather than stacking on it.
 */
export function ambienceLevels(ambience: SoundAmbience): AmbienceLevels {
  const water = unit(ambience.water);
  const city = unit(ambience.city);
  return {
    wind: 0.04 * (1 - 0.6 * city) * (1 - 0.5 * water),
    water: 0.08 * water,
    city: 0.06 * city,
    bed: unit(ambience.presence),
    clarityHz: MUFFLED_HZ * (CLEAR_HZ / MUFFLED_HZ) ** unit(ambience.clarity),
  };
}

function lfo(
  context: BaseAudioContext,
  frequency: number,
  depth: number,
  target: AudioParam,
): OscillatorNode {
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  const gain = context.createGain();
  gain.gain.value = depth;
  oscillator.connect(gain).connect(target);
  return oscillator;
}

function filter(
  context: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = 0.7,
): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

function gainNode(context: BaseAudioContext, value: number): GainNode {
  const node = context.createGain();
  node.gain.value = value;
  return node;
}

export function createAmbienceBed(
  context: BaseAudioContext,
  output: AudioNode,
  random: () => number,
): AmbienceBed {
  const now = context.currentTime;
  const sources: AudioScheduledSourceNode[] = [];

  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer(context, random);
  noise.loop = true;
  sources.push(noise);

  const clarity = filter(context, "lowpass", CLEAR_HZ, 0.5);
  const bed = gainNode(context, 0);
  clarity.connect(bed).connect(output);

  // Wind: a wide band that drifts, swelling now and then into a gust.
  const windBand = filter(context, "bandpass", 520, 0.6);
  const gust = gainNode(context, 0.7);
  const wind = gainNode(context, 0);
  noise.connect(windBand).connect(gust).connect(wind).connect(clarity);
  sources.push(lfo(context, 0.06, 220, windBand.frequency));
  sources.push(lfo(context, 0.11, 0.3, gust.gain));

  // Water: low, rounded noise that comes and goes like a lapping edge.
  const waterLow = filter(context, "lowpass", 700);
  const waterHigh = filter(context, "highpass", 140);
  const lap = gainNode(context, 0.6);
  const water = gainNode(context, 0);
  noise
    .connect(waterLow)
    .connect(waterHigh)
    .connect(lap)
    .connect(water)
    .connect(clarity);
  sources.push(lfo(context, 0.17, 0.4, lap.gain));
  sources.push(lfo(context, 0.29, 250, waterLow.frequency));

  // A street: distant traffic as dark noise, and a faint mains hum under it.
  const traffic = filter(context, "lowpass", 360);
  const swell = gainNode(context, 0.8);
  const city = gainNode(context, 0);
  noise.connect(traffic).connect(swell).connect(city).connect(clarity);
  sources.push(lfo(context, 0.045, 0.2, swell.gain));
  for (const [frequency, level] of [
    [110, 0.12],
    [165.4, 0.05],
  ] as const) {
    const hum = context.createOscillator();
    hum.type = "sine";
    hum.frequency.value = frequency;
    hum.connect(gainNode(context, level)).connect(city);
    sources.push(hum);
  }

  for (const source of sources) source.start(now);

  const follow = (param: AudioParam, value: number): void => {
    const at = context.currentTime;
    param.cancelScheduledValues(at);
    param.setTargetAtTime(value, at, FOLLOW_SECONDS);
  };

  let stopped = false;
  return {
    set(ambience) {
      if (stopped) return;
      const levels = ambienceLevels(ambience);
      follow(wind.gain, levels.wind);
      follow(water.gain, levels.water);
      follow(city.gain, levels.city);
      follow(bed.gain, levels.bed);
      follow(clarity.frequency, levels.clarityHz);
    },
    fadeOut() {
      if (stopped) return;
      follow(bed.gain, 0);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped; nothing left to silence.
        }
      }
      bed.disconnect();
    },
  };
}

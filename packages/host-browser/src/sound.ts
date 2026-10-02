// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  SILENT_SOUND,
  type SoundAmbience,
  type SoundCapability,
  type SoundCue,
  type SoundVoiceLine,
} from "@nilx-one/host-contract";

import { createAmbienceBed, type AmbienceBed } from "./sound-ambience";
import { CUE_RECIPES } from "./sound-recipes";

/**
 * Sound in a browser, through Web Audio.
 *
 * A browser opens audio only from inside a gesture, so the device is opened
 * lazily: never while sound is off, and otherwise on the first press, key or
 * touch after it is wanted. Until then every cue is dropped rather than
 * queued. Where Safari exposes an audio session it is declared `ambient`:
 * cues mix with whatever the person is already listening to and respect the
 * ringer switch, the way a game's sound effects should. A hidden page is
 * suspended. Everything else is a quiet no-op: sound is presentation and
 * never a requirement.
 *
 * Recorded lines are fetched from the product's own origin, decoded once and
 * kept, and said one at a time on their own bus, with the bed dipped under
 * them.
 */
export interface BrowserSoundEnvironment {
  /** Opens the audio device. Absent where this browser has no Web Audio. */
  readonly createContext?: () => AudioContext;
  /** Where gestures and visibility are read. */
  readonly document?: Document;
  /** Safari's audio session, where this browser has one. */
  readonly audioSession?: { type: string };
  readonly random?: () => number;
  /** Fetches a recorded line. Read at call time, so a host's routing applies. */
  readonly fetch?: (url: string) => Promise<Response>;
  /** A clock in milliseconds, for telling a late line from a timely one. */
  readonly now?: () => number;
}

/** The overall level every cue and the bed are mixed down to. */
const MASTER_LEVEL = 0.8;

/** A cue repeated faster than this is one cue, not two. */
const REPEAT_MS: Partial<Record<SoundCue, number>> = { step: 150 };
const DEFAULT_REPEAT_MS = 60;

/** How long a faded bed keeps its sources before they are stopped. */
const BED_RELEASE_MS = 4_000;

/** How long turning sound off takes to fade before the device is suspended. */
const FADE_OUT_MS = 200;

/** A line not ready this long after it was asked for is about something else. */
const VOICE_LATE_MS = 2_500;
/** A breath between the cue a line comes with and the voice saying it. */
const VOICE_LEAD_SECONDS = 0.12;
/** Recorded lines are levelled ahead of time; this sits them over the cues. */
const VOICE_LEVEL = 0.9;
/** How far the bed dips while a voice speaks. */
const VOICE_DUCK = 0.35;
/** Decoded lines kept, most recently said last. */
const VOICE_CACHE_SIZE = 48;

const GESTURES = ["pointerdown", "pointerup", "touchend", "keydown"] as const;

interface WebAudioWindow {
  readonly AudioContext?: new () => AudioContext;
  readonly webkitAudioContext?: new () => AudioContext;
}

function defaultEnvironment(): BrowserSoundEnvironment {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {};
  }
  const audioWindow = window as unknown as WebAudioWindow;
  const Context = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  const session = (navigator as { audioSession?: { type: string } })
    .audioSession;
  return {
    ...(Context === undefined ? {} : { createContext: () => new Context() }),
    document,
    ...(session === undefined ? {} : { audioSession: session }),
  };
}

interface Mix {
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly cues: AudioNode;
  readonly ambience: GainNode;
  readonly voice: AudioNode;
}

interface Speaking {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

class BrowserSound implements SoundCapability {
  public readonly supported = true;
  private enabled = false;
  private mix: Mix | undefined;
  private bed: AmbienceBed | undefined;
  private ambience: SoundAmbience | null = null;
  private bedRelease: ReturnType<typeof setTimeout> | undefined;
  private readonly lastPlayed = new Map<SoundCue, number>();
  private readonly random: () => number;
  private readonly clips = new Map<string, Promise<AudioBuffer>>();
  private speaking: Speaking | undefined;
  /** Which request to speak is the latest; only that one may be heard. */
  private speech = 0;

  public constructor(
    private readonly environment: BrowserSoundEnvironment & {
      readonly createContext: () => AudioContext;
    },
  ) {
    this.random = environment.random ?? Math.random;
    const doc = environment.document;
    if (doc !== undefined) {
      const wake = (): void => this.wake();
      for (const gesture of GESTURES) {
        doc.addEventListener(gesture, wake, { capture: true, passive: true });
      }
      doc.addEventListener("visibilitychange", () => {
        if (doc.visibilityState === "hidden") this.suspend();
        else this.wake();
      });
    }
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      // Turning sound on is itself a gesture, so this is the moment to open.
      this.wake();
      this.mix?.master.gain.setTargetAtTime(
        MASTER_LEVEL,
        this.mix.context.currentTime,
        0.05,
      );
      return;
    }
    this.speech += 1;
    this.hush();
    const mix = this.mix;
    if (mix === undefined) return;
    // Faded rather than cut, so turning sound off does not end on a click.
    mix.master.gain.setTargetAtTime(0, mix.context.currentTime, 0.03);
    setTimeout(() => {
      if (this.enabled) return;
      this.releaseBed(0);
      this.suspend();
    }, FADE_OUT_MS);
  }

  public play(cue: SoundCue): void {
    if (!this.enabled) return;
    const mix = this.mix;
    if (mix === undefined || mix.context.state !== "running") return;
    const nowMs = mix.context.currentTime * 1000;
    const last = this.lastPlayed.get(cue);
    if (
      last !== undefined &&
      nowMs - last < (REPEAT_MS[cue] ?? DEFAULT_REPEAT_MS)
    ) {
      return;
    }
    this.lastPlayed.set(cue, nowMs);
    try {
      CUE_RECIPES[cue]({
        context: mix.context,
        output: mix.cues,
        at: mix.context.currentTime + 0.005,
        random: this.random,
      });
    } catch {
      // A cue that could not be scheduled is a cue not heard; nothing else.
    }
  }

  public setAmbience(ambience: SoundAmbience | null): void {
    this.ambience = ambience;
    if (ambience === null) {
      this.releaseBed(BED_RELEASE_MS);
      return;
    }
    this.applyAmbience();
  }

  public speak(line: SoundVoiceLine): void {
    if (!this.enabled) return;
    const mix = this.mix;
    if (mix === undefined || mix.context.state !== "running") return;
    this.speech += 1;
    const request = this.speech;
    const now = this.environment.now ?? (() => performance.now());
    const askedAt = now();
    this.clip(mix.context, line.url).then(
      (buffer) => {
        if (
          request !== this.speech ||
          !this.enabled ||
          this.mix !== mix ||
          mix.context.state !== "running" ||
          now() - askedAt > VOICE_LATE_MS
        ) {
          return;
        }
        this.say(mix, buffer);
      },
      () => undefined,
    );
  }

  /** A recorded line, decoded once for this device and kept for a while. */
  private clip(context: AudioContext, url: string): Promise<AudioBuffer> {
    const kept = this.clips.get(url);
    if (kept !== undefined) {
      this.clips.delete(url);
      this.clips.set(url, kept);
      return kept;
    }
    const fetchClip =
      this.environment.fetch ?? ((target: string) => globalThis.fetch(target));
    const pending = fetchClip(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes));
    // A line that could not be fetched is asked for again next time.
    pending.catch(() => {
      if (this.clips.get(url) === pending) this.clips.delete(url);
    });
    this.clips.set(url, pending);
    while (this.clips.size > VOICE_CACHE_SIZE) {
      const oldest = this.clips.keys().next();
      if (oldest.done === true) break;
      this.clips.delete(oldest.value);
    }
    return pending;
  }

  private say(mix: Mix, buffer: AudioBuffer): void {
    try {
      this.hush();
      const context = mix.context;
      const at = context.currentTime + VOICE_LEAD_SECONDS;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = VOICE_LEVEL;
      source.connect(gain).connect(mix.voice);
      source.start(at);
      this.speaking = { source, gain };
      // The bed steps back for the voice and returns once it has spoken.
      const bed = mix.ambience.gain;
      bed.cancelScheduledValues(context.currentTime);
      bed.setTargetAtTime(VOICE_DUCK, context.currentTime, 0.08);
      bed.setTargetAtTime(1, at + buffer.duration, 0.3);
    } catch {
      // A line that cannot be said is still written on the card.
    }
  }

  /** Stops whatever is being said, quickly but without a click. */
  private hush(): void {
    const speaking = this.speaking;
    const context = this.mix?.context;
    this.speaking = undefined;
    if (speaking === undefined || context === undefined) return;
    try {
      speaking.gain.gain.setTargetAtTime(0, context.currentTime, 0.02);
      speaking.source.stop(context.currentTime + 0.1);
    } catch {
      // Already finished; nothing left to stop.
    }
  }

  /** Opens or resumes the device if sound is wanted. Safe to call anytime. */
  private wake(): void {
    if (!this.enabled) return;
    if (
      this.environment.document?.visibilityState === "hidden" ||
      this.environment.document?.hidden === true
    ) {
      return;
    }
    try {
      // A closed device never resumes; the next gesture opens a new one.
      if (this.mix?.context.state === "closed") {
        this.bed = undefined;
        this.speaking = undefined;
        // Decoded audio belongs to the device that decoded it.
        this.clips.clear();
        this.mix = undefined;
      }
      const mix = this.mix ?? this.open();
      if (mix.context.state !== "running") {
        void mix.context.resume().then(
          () => this.applyAmbience(),
          () => undefined,
        );
        this.prime(mix.context);
        return;
      }
      this.applyAmbience();
    } catch {
      // No device, or a refusal: the interface goes on without sound.
    }
  }

  private open(): Mix {
    if (this.environment.audioSession !== undefined) {
      try {
        this.environment.audioSession.type = "ambient";
      } catch {
        // An older session object; the default category still plays.
      }
    }
    const context = this.environment.createContext();
    const master = context.createGain();
    master.gain.value = MASTER_LEVEL;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter).connect(context.destination);
    const cues = context.createGain();
    cues.connect(master);
    const ambience = context.createGain();
    ambience.connect(master);
    const voice = context.createGain();
    voice.connect(master);
    const mix = { context, master, cues, ambience, voice };
    this.mix = mix;
    return mix;
  }

  /**
   * Older iOS releases only unlock a context that played something inside
   * the gesture, so one silent sample is played while the gesture lasts.
   */
  private prime(context: AudioContext): void {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.start();
  }

  private suspend(): void {
    const context = this.mix?.context;
    if (context === undefined || context.state !== "running") return;
    void context.suspend().catch(() => undefined);
  }

  private applyAmbience(): void {
    const mix = this.mix;
    if (
      !this.enabled ||
      this.ambience === null ||
      mix === undefined ||
      mix.context.state !== "running"
    ) {
      return;
    }
    if (this.bedRelease !== undefined) {
      clearTimeout(this.bedRelease);
      this.bedRelease = undefined;
    }
    try {
      this.bed ??= createAmbienceBed(mix.context, mix.ambience, this.random);
      this.bed.set(this.ambience);
    } catch {
      // A bed that could not start leaves the cues as they were.
    }
  }

  private releaseBed(afterMs: number): void {
    const bed = this.bed;
    if (bed === undefined) return;
    bed.fadeOut();
    if (this.bedRelease !== undefined) clearTimeout(this.bedRelease);
    const stop = (): void => {
      this.bedRelease = undefined;
      if (this.bed === bed) this.bed = undefined;
      bed.stop();
    };
    if (afterMs === 0) stop();
    else this.bedRelease = setTimeout(stop, afterMs);
  }
}

export function createBrowserSound(
  environment: BrowserSoundEnvironment = defaultEnvironment(),
): SoundCapability {
  const { createContext } = environment;
  if (createContext === undefined) return SILENT_SOUND;
  return new BrowserSound({ ...environment, createContext });
}

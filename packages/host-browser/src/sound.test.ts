// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { SOUND_CUES, type SoundAmbience } from "@nilx-one/host-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserSound } from "./sound";
import { ambienceLevels, createAmbienceBed } from "./sound-ambience";
import { CUE_MAX_SECONDS, CUE_RECIPES } from "./sound-recipes";

/**
 * Just enough of Web Audio to see what a recipe schedules: which nodes it
 * made, what they are wired to, and what every parameter was told to do.
 */
class FakeParam {
  public value: number;
  public readonly calls: (readonly [string, ...number[]])[] = [];
  public readonly inputs: FakeNode[] = [];

  public constructor(value = 0) {
    this.value = value;
  }

  private record(name: string, ...args: number[]): this {
    for (const arg of args) {
      if (!Number.isFinite(arg)) throw new RangeError(`${name}(${arg})`);
    }
    this.calls.push([name, ...args]);
    return this;
  }

  public setValueAtTime(value: number, at: number): this {
    return this.record("setValueAtTime", value, at);
  }

  public linearRampToValueAtTime(value: number, at: number): this {
    return this.record("linearRampToValueAtTime", value, at);
  }

  public exponentialRampToValueAtTime(value: number, at: number): this {
    // Web Audio refuses an exponential ramp to zero or through a sign change.
    if (value <= 0) throw new RangeError(`exponential ramp to ${value}`);
    return this.record("exponentialRampToValueAtTime", value, at);
  }

  public setTargetAtTime(value: number, at: number, constant: number): this {
    return this.record("setTargetAtTime", value, at, constant);
  }

  public cancelScheduledValues(at: number): this {
    return this.record("cancelScheduledValues", at);
  }

  public last(name: string): readonly number[] | undefined {
    return this.calls
      .filter((call) => call[0] === name)
      .at(-1)
      ?.slice(1) as number[] | undefined;
  }
}

class FakeNode {
  public readonly outputs: (FakeNode | FakeParam)[] = [];
  public disconnected = false;

  public constructor(
    public readonly context: FakeAudioContext,
    public readonly kind: string,
  ) {
    context.nodes.push(this);
  }

  public connect<T extends FakeNode | FakeParam>(target: T): T {
    this.outputs.push(target);
    if (target instanceof FakeParam) target.inputs.push(this);
    return target;
  }

  public disconnect(): void {
    this.disconnected = true;
  }
}

class FakeSource extends FakeNode {
  public started: number | undefined;
  public stopped: number | undefined;
  public loop = false;
  public buffer: unknown = null;
  public type = "sine";
  public readonly frequency = new FakeParam(440);
  public readonly detune = new FakeParam(0);

  public start(at = 0): void {
    if (this.started !== undefined) throw new Error("started twice");
    this.started = at;
  }

  public stop(at = 0): void {
    if (this.started === undefined) throw new Error("stopped before start");
    this.stopped = at;
  }
}

class FakeAudioContext {
  public readonly nodes: FakeNode[] = [];
  public readonly destination: FakeNode;
  public readonly sampleRate = 8_000;
  public currentTime = 1;
  public state: AudioContextState;

  public constructor(state: AudioContextState = "running") {
    this.state = state;
    this.destination = new FakeNode(this, "destination");
  }

  public resume = vi.fn(async () => {
    this.state = "running";
  });

  public suspend = vi.fn(async () => {
    this.state = "suspended";
  });

  public createGain() {
    return Object.assign(new FakeNode(this, "gain"), {
      gain: new FakeParam(1),
    });
  }

  public createOscillator() {
    return new FakeSource(this, "oscillator");
  }

  public createBufferSource() {
    return new FakeSource(this, "buffer-source");
  }

  public createBiquadFilter() {
    return Object.assign(new FakeNode(this, "filter"), {
      type: "lowpass",
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
    });
  }

  public createStereoPanner() {
    return Object.assign(new FakeNode(this, "panner"), {
      pan: new FakeParam(0),
    });
  }

  public createDynamicsCompressor() {
    return Object.assign(new FakeNode(this, "compressor"), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }

  public decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => ({
    duration: bytes.byteLength / 100,
    length: bytes.byteLength,
    sampleRate: this.sampleRate,
    getChannelData: () => new Float32Array(bytes.byteLength),
  }));

  public createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { length, sampleRate, getChannelData: () => data };
  }

  public sources(): FakeSource[] {
    return this.nodes.filter((node) => node instanceof FakeSource);
  }

  /** Whether sound from `node` can reach the speakers. */
  public reaches(
    node: FakeNode | FakeParam,
    seen = new Set<unknown>(),
  ): boolean {
    if (node === this.destination) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    const next = node instanceof FakeParam ? [] : node.outputs;
    return next.some((target) => {
      if (target instanceof FakeParam) {
        // A parameter belongs to a node; find it and keep following.
        const owner = this.nodes.find((candidate) =>
          Object.values(candidate).includes(target),
        );
        return owner !== undefined && this.reaches(owner, seen);
      }
      return this.reaches(target, seen);
    });
  }
}

function asContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext;
}

function press(): void {
  document.dispatchEvent(new Event("pointerdown"));
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => state === "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const AMBIENCE: SoundAmbience = {
  presence: 1,
  water: 0.5,
  city: 0.2,
  clarity: 0.8,
};

describe("browser sound", () => {
  let contexts: FakeAudioContext[];
  let createContext: () => AudioContext;

  beforeEach(() => {
    contexts = [];
    createContext = vi.fn(() => {
      const context = new FakeAudioContext();
      contexts.push(context);
      return asContext(context);
    });
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the silent capability where a browser has no Web Audio", () => {
    const sound = createBrowserSound({ document });
    expect(sound.supported).toBe(false);
    expect(() => {
      sound.setEnabled(true);
      sound.play("tap");
      sound.setAmbience(AMBIENCE);
    }).not.toThrow();
  });

  it("opens no audio device while sound is off, gestures or not", () => {
    const sound = createBrowserSound({ createContext, document });
    press();
    sound.play("tap");
    sound.setAmbience(AMBIENCE);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("opens nothing when sound is merely wanted, as on mount or reload", () => {
    const sound = createBrowserSound({ createContext, document });
    // What a mount does with the default or a stored preference.
    sound.setEnabled(true);
    sound.play("tap");
    sound.setAmbience(AMBIENCE);
    expect(createContext).not.toHaveBeenCalled();
    // Coming back to the tab is not a gesture either.
    setVisibility("hidden");
    setVisibility("visible");
    expect(createContext).not.toHaveBeenCalled();

    press();
    expect(createContext).toHaveBeenCalledOnce();
  });

  it("opens the device on the very press that turns sound on", () => {
    const sound = createBrowserSound({ createContext, document });
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.addEventListener("change", () => sound.setEnabled(true));
    document.body.append(toggle);
    try {
      toggle.click();
    } finally {
      toggle.remove();
    }
    expect(createContext).toHaveBeenCalledOnce();
  });

  it("resumes a suspended device on a gesture, and never opens a second", async () => {
    const sound = createBrowserSound({ createContext, document });
    sound.setEnabled(true);
    press();
    const context = contexts[0]!;
    context.state = "suspended";
    press();
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalled();
    expect(context.state).toBe("running");
    press();
    expect(createContext).toHaveBeenCalledOnce();
  });

  it("drops a cue it cannot play yet rather than queueing it", () => {
    createContext = vi.fn(() => {
      const context = new FakeAudioContext("suspended");
      context.resume = vi.fn(() => new Promise<void>(() => undefined));
      contexts.push(context);
      return asContext(context);
    });
    const sound = createBrowserSound({ createContext, document });
    sound.setEnabled(true);
    press();
    const context = contexts[0]!;
    const before = context.sources().length;
    sound.play("achievement");
    // Only the silent sample that unlocks iOS was played.
    expect(context.sources().length).toBe(before);
  });

  it("schedules every cue as sources that reach the speakers and stop", () => {
    for (const cue of SOUND_CUES) {
      const context = new FakeAudioContext();
      const output = context.createGain();
      output.connect(context.destination);
      CUE_RECIPES[cue]({
        context: context as unknown as BaseAudioContext,
        output: output as unknown as AudioNode,
        at: context.currentTime,
        random: () => 0.5,
      });
      const sources = context.sources();
      expect(sources.length, cue).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.started, cue).toBeGreaterThanOrEqual(context.currentTime);
        expect(source.stopped, cue).toBeDefined();
        expect(source.stopped! - context.currentTime, cue).toBeLessThanOrEqual(
          CUE_MAX_SECONDS,
        );
        expect(context.reaches(source), cue).toBe(true);
      }
    }
  });

  it("plays a cue through the mix once the device runs", () => {
    const sound = createBrowserSound({ createContext, document });
    sound.setEnabled(true);
    press();
    const context = contexts[0]!;
    const before = context.sources().length;
    sound.play("walk");
    const played = context.sources().slice(before);
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((source) => context.reaches(source))).toBe(true);
  });

  it("hears a cue repeated faster than its own pace once", () => {
    const sound = createBrowserSound({ createContext, document });
    sound.setEnabled(true);
    press();
    const context = contexts[0]!;
    sound.play("step");
    const once = context.sources().length;
    context.currentTime += 0.05;
    sound.play("step");
    expect(context.sources().length).toBe(once);
    context.currentTime += 0.2;
    sound.play("step");
    expect(context.sources().length).toBeGreaterThan(once);
  });

  it("declares Safari's audio session ambient, so it mixes and obeys the ringer", () => {
    const audioSession = { type: "auto" };
    const sound = createBrowserSound({ createContext, document, audioSession });
    sound.setEnabled(true);
    press();
    expect(audioSession.type).toBe("ambient");
  });

  it("suspends a hidden page and resumes it when it is shown again", () => {
    const sound = createBrowserSound({ createContext, document });
    sound.setEnabled(true);
    press();
    const context = contexts[0]!;
    setVisibility("hidden");
    expect(context.suspend).toHaveBeenCalled();
    setVisibility("visible");
    expect(context.resume).toHaveBeenCalled();
  });

  it("fades out and suspends when sound is turned off", () => {
    vi.useFakeTimers();
    const sound = createBrowserSound({ createContext, document });
    sound.setEnabled(true);
    press();
    const context = contexts[0]!;
    sound.setEnabled(false);
    expect(context.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(context.suspend).toHaveBeenCalled();
    const before = context.sources().length;
    sound.play("tap");
    expect(context.sources().length).toBe(before);
  });

  it("runs the bed only while wanted, and stops it after it fades", () => {
    vi.useFakeTimers();
    const sound = createBrowserSound({ createContext, document });
    sound.setAmbience(AMBIENCE);
    expect(createContext).not.toHaveBeenCalled();

    sound.setEnabled(true);
    press();
    const context = contexts[0]!;
    const bed = context.sources().filter((source) => source.loop);
    expect(bed).toHaveLength(1);
    expect(context.reaches(bed[0]!)).toBe(true);

    sound.setAmbience(null);
    expect(bed[0]!.stopped).toBeUndefined();
    vi.advanceTimersByTime(5_000);
    expect(bed[0]!.stopped).toBeDefined();
  });

  it("keeps a bed that comes back before it was released", () => {
    vi.useFakeTimers();
    const sound = createBrowserSound({ createContext, document });
    sound.setEnabled(true);
    press();
    sound.setAmbience(AMBIENCE);
    const context = contexts[0]!;
    sound.setAmbience(null);
    vi.advanceTimersByTime(1_000);
    sound.setAmbience(AMBIENCE);
    vi.advanceTimersByTime(10_000);
    expect(context.sources().filter((source) => source.loop)).toHaveLength(1);
    expect(context.sources().find((source) => source.loop)!.stopped).toBe(
      undefined,
    );
  });

  it("opens a new device when the browser closed the old one", () => {
    const sound = createBrowserSound({ createContext, document });
    sound.setEnabled(true);
    press();
    contexts[0]!.state = "closed";
    press();
    expect(createContext).toHaveBeenCalledTimes(2);
    const before = contexts[1]!.sources().length;
    sound.play("tap");
    expect(contexts[1]!.sources().length).toBeGreaterThan(before);
  });

  it("is a quiet no-op when the device refuses to open", () => {
    const sound = createBrowserSound({
      createContext: () => {
        throw new Error("NotAllowedError");
      },
      document,
    });
    expect(() => {
      sound.setEnabled(true);
      press();
      press();
      sound.play("tap");
      sound.setAmbience(AMBIENCE);
    }).not.toThrow();
  });
});

describe("ambience bed", () => {
  it("muffles fog and opens up on revealed ground", () => {
    const fog = ambienceLevels({ ...AMBIENCE, clarity: 0 });
    const clear = ambienceLevels({ ...AMBIENCE, clarity: 1 });
    expect(fog.clarityHz).toBeCloseTo(280);
    expect(clear.clarityHz).toBeCloseTo(7200);
  });

  it("lets streets and water take the place of wind rather than stack on it", () => {
    const open = ambienceLevels({ ...AMBIENCE, water: 0, city: 0 });
    const street = ambienceLevels({ ...AMBIENCE, water: 0, city: 1 });
    const shore = ambienceLevels({ ...AMBIENCE, water: 1, city: 0 });
    expect(street.wind).toBeLessThan(open.wind);
    expect(shore.wind).toBeLessThan(open.wind);
    expect(street.city).toBeGreaterThan(0);
    expect(shore.water).toBeGreaterThan(0);
    expect(open.city).toBe(0);
    expect(open.water).toBe(0);
  });

  it("clamps what it is given", () => {
    const levels = ambienceLevels({
      presence: 3,
      water: Number.NaN,
      city: -1,
      clarity: 2,
    });
    expect(levels.bed).toBe(1);
    expect(levels.water).toBe(0);
    expect(levels.city).toBe(0);
    expect(levels.clarityHz).toBeCloseTo(7200);
  });

  it("follows a change smoothly instead of jumping", () => {
    const context = new FakeAudioContext();
    const bed = createAmbienceBed(
      context as unknown as BaseAudioContext,
      context.destination as unknown as AudioNode,
      () => 0.5,
    );
    bed.set(AMBIENCE);
    const filter = context.nodes.find(
      (node) => node.kind === "filter" && context.reaches(node),
    ) as unknown as { frequency: FakeParam } | undefined;
    expect(filter?.frequency.last("setTargetAtTime")).toBeDefined();
    bed.stop();
    expect(
      context.sources().every((source) => source.stopped !== undefined),
    ).toBe(true);
  });
});

describe("a recorded line", () => {
  let context: FakeAudioContext;
  let clock: number;
  let fetchClip: ReturnType<typeof vi.fn>;

  function respond(bytes = 150, ok = true): Promise<Response> {
    return Promise.resolve({
      ok,
      status: ok ? 200 : 404,
      arrayBuffer: async () => new ArrayBuffer(bytes),
    } as Response);
  }

  function voiced() {
    const sound = createBrowserSound({
      createContext: () => asContext(context),
      document,
      fetch: fetchClip as unknown as (url: string) => Promise<Response>,
      now: () => clock,
    });
    sound.setEnabled(true);
    press();
    return sound;
  }

  // Fetching, reading and decoding are each a promise; a macrotask outlasts them.
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const voices = () =>
    context
      .sources()
      .filter(
        (source) => source.kind === "buffer-source" && source.buffer !== null,
      )
      .filter(
        (source) => (source.buffer as { duration: number }).duration > 0.01,
      );

  beforeEach(() => {
    context = new FakeAudioContext();
    clock = 0;
    fetchClip = vi.fn(() => respond());
    setVisibility("visible");
  });

  it("is fetched, decoded and said through the mix", async () => {
    const sound = voiced();
    sound.speak({ url: "/voices/0.1.0/en/sky-study/walk.0.mp3" });
    await settle();
    expect(fetchClip).toHaveBeenCalledWith(
      "/voices/0.1.0/en/sky-study/walk.0.mp3",
    );
    const [line] = voices();
    expect(line).toBeDefined();
    expect(line!.started).toBeGreaterThan(context.currentTime);
    expect(context.reaches(line!)).toBe(true);
  });

  it("is decoded once and said again from what was kept", async () => {
    const sound = voiced();
    sound.speak({ url: "/a.mp3" });
    await settle();
    sound.speak({ url: "/a.mp3" });
    await settle();
    expect(fetchClip).toHaveBeenCalledOnce();
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(voices()).toHaveLength(2);
  });

  it("cuts off the line before it: one voice says one thing at a time", async () => {
    const sound = voiced();
    sound.speak({ url: "/a.mp3" });
    await settle();
    sound.speak({ url: "/b.mp3" });
    await settle();
    const [first, second] = voices();
    expect(first!.stopped).toBeDefined();
    expect(second!.stopped).toBeUndefined();
  });

  it("is said only if it is still the latest thing asked for", async () => {
    let release: (value: Response) => void = () => undefined;
    fetchClip = vi.fn((url: string) =>
      url === "/slow.mp3"
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : respond(),
    );
    const sound = voiced();
    sound.speak({ url: "/slow.mp3" });
    sound.speak({ url: "/fast.mp3" });
    await settle();
    release(await respond(300));
    await settle();
    expect(
      voices().map(
        (source) => (source.buffer as { duration: number }).duration,
      ),
    ).toEqual([1.5]);
  });

  it("is dropped when it arrives too late to be about this moment", async () => {
    let release: (value: Response) => void = () => undefined;
    fetchClip = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const sound = voiced();
    sound.speak({ url: "/late.mp3" });
    clock = 3_000;
    release(await respond());
    await settle();
    expect(voices()).toHaveLength(0);
  });

  it("is asked for again after a failed fetch, and the failure is silent", async () => {
    fetchClip = vi.fn(() => respond(150, false));
    const sound = voiced();
    sound.speak({ url: "/missing.mp3" });
    await settle();
    sound.speak({ url: "/missing.mp3" });
    await settle();
    expect(fetchClip).toHaveBeenCalledTimes(2);
    expect(voices()).toHaveLength(0);
  });

  it("dips the bed while it speaks and lets it back up afterwards", async () => {
    const sound = voiced();
    sound.speak({ url: "/a.mp3" });
    await settle();
    const ambienceBus = context.nodes.find(
      (node) =>
        node.kind === "gain" &&
        (node as unknown as { gain: FakeParam }).gain.calls.some(
          (call) => call[0] === "setTargetAtTime" && call[1] === 0.35,
        ),
    ) as unknown as { gain: FakeParam } | undefined;
    expect(ambienceBus).toBeDefined();
    expect(ambienceBus!.gain.last("setTargetAtTime")?.[0]).toBe(1);
  });

  it("says nothing while sound is off", async () => {
    const sound = createBrowserSound({
      createContext: () => asContext(context),
      document,
      fetch: fetchClip as unknown as (url: string) => Promise<Response>,
    });
    sound.speak({ url: "/a.mp3" });
    await settle();
    expect(fetchClip).not.toHaveBeenCalled();
  });
});

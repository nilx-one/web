// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { resolveAvatarScene } from "@nilx-one/application";
import {
  MAP_BODY_HANDOVER_ZOOM,
  type AvatarModelId,
  type MapCamera,
  type MapPointSelection,
  type MapRenderer,
} from "@nilx-one/map-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocalization } from "../../shell/localization";
import type { AchievementDialogState } from "../progression/achievement-dialog";
import {
  createGuideLineState,
  followChoice,
  GUIDE_OPENING,
  isSpokenReply,
  replyText,
  type GuideChoice,
  type GuideLineViewState,
  type GuideNames,
  type GuideNodeId,
  type GuideOutcome,
  type GuideReply,
  type GuideSceneId,
  GUIDE_NODES,
} from "./guide-script";
import {
  clearShot,
  driftCamera,
  GUIDE_LEAVE_MS,
  GUIDE_WALK_MS,
  guideCameraPadding,
  guideModel,
  guideShotCamera,
  guideSightlines,
  guideStage,
  OPEN_GROUND,
  sampleGuideBody,
  shotIsClear,
  type GuideBodyMotion,
  type GuideShot,
  type GuideSightlines,
  type GuideStage,
} from "./guide-stage";

/** Her body's handle, beside the one the Bond at the wheel is drawn from. */
export const GUIDE_HANDLE_ID = "guide";

/** Over the shoulder while she is still a little way off. */
const ESTABLISH_MS = 1_600;
const SHOT_MS = 1_800;
const REPLY_SHOT_MS = 1_400;
const DRIFT_MS = 9_000;
/** Long enough to read a short reply of one's own before she answers it. */
export const GUIDE_REPLY_BEAT_MS = 1_600;
const RETURN_MS = 1_800;

export type GuideBeat = "arriving" | "line" | "reply" | "leaving";

export interface GuideCutsceneState {
  readonly scene: GuideSceneId;
  readonly beat: GuideBeat;
  /** What she is saying, and what a person may answer. */
  readonly line: GuideLineViewState;
  /** The answer a person chose, said back in their own voice. */
  readonly reply?: string;
  /** Who is saying the reply: the Bond the scene is played for. */
  readonly replySpeaker: string;
  /** The achievement a reward scene is paying. */
  readonly reward?: AchievementDialogState;
}

export interface GuideCutscene {
  readonly state: GuideCutsceneState | undefined;
  play(scene: GuideSceneId, options?: GuidePlayOptions): void;
  choose(reply: GuideReply): void;
  /** Hurry the current beat along: an arrival, a reply, a departure. */
  advance(): void;
}

export interface GuidePlayOptions {
  readonly reward?: AchievementDialogState;
}

export interface GuideCutsceneInput {
  readonly renderer: MapRenderer;
  /** Where the Bond's body stands, when this device observed one. */
  readonly anchor: MapPointSelection | undefined;
  /** The body the Bond wears, so she never wears the same one beside it. */
  readonly bondModel: AvatarModelId | undefined;
  readonly bondName: string;
  readonly names: GuideNames;
  readonly reducedMotion: boolean;
  onEnd(scene: GuideSceneId, outcome: GuideOutcome): void;
}

interface Playing {
  readonly scene: GuideSceneId;
  readonly node: GuideNodeId;
  readonly beat: GuideBeat;
  readonly seed: number;
  readonly reply?: GuideReply;
  readonly next?: GuideChoice["next"];
  readonly outcome?: GuideOutcome;
  readonly reward?: AchievementDialogState;
}

let playedScenes = Math.floor(Math.random() * 1_000);

function viewportHeight(): number {
  return globalThis.innerHeight > 0 ? globalThis.innerHeight : 800;
}

/**
 * A scene with xSasha, played on the world itself.
 *
 * She walks up to the Bond's body in the same renderer that draws it, and the
 * camera is staged around the two of them — establishing, shot, reverse shot —
 * then handed back exactly where it was. A person who asked for reduced motion
 * gets cuts instead of moves, and she is simply standing there.
 */
export function useGuideCutscene({
  renderer,
  anchor,
  bondModel,
  bondName,
  names,
  reducedMotion,
  onEnd,
}: GuideCutsceneInput): GuideCutscene {
  const { t } = useLocalization();
  const [playing, setPlayingState] = useState<Playing | undefined>(undefined);
  const playingRef = useRef<Playing | undefined>(undefined);
  const stageRef = useRef<GuideStage | undefined>(undefined);
  const sightlinesRef = useRef<GuideSightlines>(OPEN_GROUND);
  const baseCameraRef = useRef<MapCamera | undefined>(undefined);
  const motionRef = useRef<GuideBodyMotion | undefined>(undefined);
  const anchorRef = useRef(anchor);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    anchorRef.current = anchor;
    onEndRef.current = onEnd;
  });

  const setPlaying = useCallback((next: Playing | undefined) => {
    playingRef.current = next;
    setPlayingState(next);
  }, []);

  const shoot = useCallback(
    (camera: MapCamera, durationMs: number) => {
      renderer.setCamera(camera, {
        motion: reducedMotion ? "immediate" : "eased",
        durationMs,
        padding: guideCameraPadding(viewportHeight()),
      });
    },
    [renderer, reducedMotion],
  );

  /** A written shot, turned off any wall that would stand in front of it. */
  const frame = useCallback(
    (shot: GuideShot, stage: GuideStage): MapCamera =>
      clearShot(
        guideShotCamera(shot, stage),
        stage,
        sightlinesRef.current,
        viewportHeight(),
      ),
    [],
  );

  /** Breathing, unless the creep sideways would walk into a wall: then in only. */
  const drift = useCallback((camera: MapCamera, stage: GuideStage) => {
    const drifted = driftCamera(camera);
    return shotIsClear(drifted, stage, sightlinesRef.current, viewportHeight())
      ? drifted
      : { ...camera, zoom: drifted.zoom };
  }, []);

  const play = useCallback(
    (scene: GuideSceneId, options: GuidePlayOptions = {}) => {
      if (playingRef.current !== undefined) return;
      const base = renderer.getCamera();
      baseCameraRef.current = base;
      const you = anchorRef.current ?? {
        longitude: base.center[0],
        latitude: base.center[1],
      };
      stageRef.current = guideStage(you);
      sightlinesRef.current = guideSightlines(
        you,
        renderer.obstaclesWithin === undefined
          ? undefined
          : (bounds) => renderer.obstaclesWithin?.(bounds) ?? [],
      );
      playedScenes += 1;
      setPlaying({
        scene,
        node: GUIDE_OPENING[scene],
        beat: "arriving",
        seed: playedScenes,
        ...(options.reward === undefined ? {} : { reward: options.reward }),
      });
    },
    [renderer, setPlaying],
  );

  /** Where a reply leads: her next line, or her way out. */
  const proceed = useCallback(
    (next: GuideChoice["next"]) => {
      const current = playingRef.current;
      if (current === undefined) return;
      const { reply: _reply, next: _next, ...rest } = current;
      setPlaying(
        typeof next === "string"
          ? { ...rest, node: next, beat: "line" }
          : { ...rest, beat: "leaving", outcome: next.end },
      );
    },
    [setPlaying],
  );

  const finish = useCallback(() => {
    const current = playingRef.current;
    if (current === undefined) return;
    setPlaying(undefined);
    onEndRef.current(current.scene, current.outcome ?? "done");
  }, [setPlaying]);

  const toLine = useCallback(() => {
    const current = playingRef.current;
    if (current?.beat === "arriving") setPlaying({ ...current, beat: "line" });
  }, [setPlaying]);

  const choose = useCallback(
    (reply: GuideReply) => {
      const current = playingRef.current;
      if (current === undefined || current.beat !== "line") return;
      const next = followChoice(current.node, reply);
      if (next === undefined) return;
      if (isSpokenReply(reply)) {
        setPlaying({ ...current, beat: "reply", reply, next });
        return;
      }
      proceed(next);
    },
    [proceed, setPlaying],
  );

  const advance = useCallback(() => {
    const current = playingRef.current;
    if (current === undefined) return;
    switch (current.beat) {
      case "arriving":
        toLine();
        return;
      case "reply":
        if (current.next !== undefined) proceed(current.next);
        return;
      case "leaving":
        finish();
        return;
      case "line":
        return;
    }
  }, [finish, proceed, toLine]);

  // Each beat stages its own shot and moves her body. A beat that ends on its
  // own schedules what comes after it; every timer is dropped with the beat.
  const beat = playing?.beat;
  const node = playing?.node;
  useEffect(() => {
    const stage = stageRef.current;
    if (beat === undefined || node === undefined || stage === undefined) {
      return;
    }
    const now = globalThis.performance.now();
    const timers: ReturnType<typeof globalThis.setTimeout>[] = [];
    const later = (ms: number, run: () => void) =>
      timers.push(globalThis.setTimeout(run, ms));

    switch (beat) {
      case "arriving": {
        motionRef.current = reducedMotion
          ? { kind: "stand", at: stage.dasha, facing: stage.you }
          : {
              kind: "walk",
              from: stage.entry,
              to: stage.dasha,
              startedMs: now,
              durationMs: GUIDE_WALK_MS,
            };
        if (reducedMotion) {
          shoot(frame("two-shot", stage), 0);
          later(0, toLine);
          break;
        }
        shoot(frame("establish", stage), ESTABLISH_MS);
        later(ESTABLISH_MS, () =>
          shoot(frame("two-shot", stage), GUIDE_WALK_MS - ESTABLISH_MS),
        );
        later(GUIDE_WALK_MS, toLine);
        break;
      }
      case "line": {
        const script = GUIDE_NODES[node];
        motionRef.current = {
          kind: "stand",
          at: stage.dasha,
          facing: stage.you,
          ...(script.reward === true
            ? { gesture: { clipId: "wake" as const, startedMs: now } }
            : {}),
        };
        const shot: GuideShot = script.shot;
        const camera = frame(shot, stage);
        shoot(camera, SHOT_MS);
        if (!reducedMotion) {
          later(SHOT_MS, () => shoot(drift(camera, stage), DRIFT_MS));
        }
        break;
      }
      case "reply": {
        shoot(frame("you", stage), REPLY_SHOT_MS);
        later(GUIDE_REPLY_BEAT_MS, advance);
        break;
      }
      case "leaving": {
        motionRef.current = reducedMotion
          ? undefined
          : {
              kind: "walk",
              from: stage.dasha,
              to: stage.entry,
              startedMs: now,
              durationMs: GUIDE_LEAVE_MS,
            };
        const base = baseCameraRef.current;
        if (base !== undefined) shoot(base, RETURN_MS);
        later(reducedMotion ? 0 : Math.max(GUIDE_LEAVE_MS, RETURN_MS), finish);
        break;
      }
    }

    return () => {
      for (const timer of timers) globalThis.clearTimeout(timer);
    };
  }, [beat, node, reducedMotion, shoot, frame, drift, finish, toLine, advance]);

  // Her body, frame by frame, for as long as the scene lasts.
  const active = playing !== undefined;
  const model = guideModel(bondModel);
  useEffect(() => {
    const avatars = renderer.avatars;
    if (!active || avatars === undefined) return;
    const visibleNodes = resolveAvatarScene(model, undefined).visibleNodes;
    let frame: number | undefined;

    function draw(nowMs: number): void {
      const motion = motionRef.current;
      if (motion === undefined) {
        avatars?.remove(GUIDE_HANDLE_ID);
      } else {
        const pose = sampleGuideBody(motion, nowMs, reducedMotion);
        avatars?.upsert({
          id: GUIDE_HANDLE_ID,
          modelId: model,
          lngLat: [pose.point.longitude, pose.point.latitude],
          bearingDeg: pose.bearingDeg,
          clipId: pose.clipId,
          clipPhase: pose.clipPhase,
          scale: 1,
          visible: renderer.getCamera().zoom >= MAP_BODY_HANDOVER_ZOOM,
          visibleNodes,
        });
      }
      frame = globalThis.requestAnimationFrame(draw);
    }

    draw(globalThis.performance.now());
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      avatars.remove(GUIDE_HANDLE_ID);
    };
  }, [active, model, reducedMotion, renderer]);

  const state: GuideCutsceneState | undefined =
    playing === undefined
      ? undefined
      : {
          scene: playing.scene,
          beat: playing.beat,
          line: createGuideLineState(playing.node, playing.seed, t, names),
          ...(playing.reply === undefined
            ? {}
            : { reply: replyText(t, playing.reply, playing.seed, names) }),
          replySpeaker: bondName,
          ...(playing.reward === undefined ? {} : { reward: playing.reward }),
        };

  return { state, play, choose, advance };
}

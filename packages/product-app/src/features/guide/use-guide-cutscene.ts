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
  studyVoice,
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
  GUIDE_AVAIA_WALK_MS,
  GUIDE_LEAVE_MS,
  GUIDE_TURN_MS,
  GUIDE_WALK_MS,
  guideAsideBearing,
  guideAsideStage,
  guideCameraPadding,
  guideModel,
  guideShotCamera,
  guideSightlines,
  guideStage,
  lerpPoint,
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
/** The Avaia's, while it joins the two of them in a scene. */
export const GUIDE_AVAIA_HANDLE_ID = "guide-avaia";

/** Over the shoulder while she is still a little way off. */
const ESTABLISH_MS = 1_600;
const SHOT_MS = 1_800;
const REPLY_SHOT_MS = 1_400;
const DRIFT_MS = 9_000;
/** Long enough to read a short reply of one's own before she answers it. */
export const GUIDE_REPLY_BEAT_MS = 1_600;
const RETURN_MS = 1_800;
/** Close enough, once a scene ends together, that both bodies are drawn. */
const GUIDE_TOGETHER_ZOOM = 19.4;

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
  /** What a gift scene gives, when it gives things rather than experience. */
  readonly gift?: GuideGift;
}

/**
 * Things she hands over, said beside her line like a reward: a backpack for
 * the Bond and one for its Avaia. The gift is already given when she says it,
 * as an achievement is already paid.
 */
export interface GuideGift {
  /** Stable for the gift, so its entries fly to the corner once. */
  readonly key: string;
  readonly title: string;
  readonly items: readonly {
    readonly subject: "bond" | "avaia";
    readonly text: string;
  }[];
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
  readonly gift?: GuideGift;
}

export interface GuideCutsceneInput {
  readonly renderer: MapRenderer;
  /** Where the Bond's body stands, when this device observed one. */
  readonly anchor: MapPointSelection | undefined;
  /** The body the Bond wears, which she mirrors — body and voice. */
  readonly bondModel: AvatarModelId | undefined;
  /** The body the Bond's Avaia wears, and what it has on, when it joins them. */
  readonly avaia?: {
    readonly model: AvatarModelId;
    readonly appearance: Parameters<typeof resolveAvatarScene>[1];
  };
  readonly bondName: string;
  readonly names: GuideNames;
  readonly reducedMotion: boolean;
  onEnd(
    scene: GuideSceneId,
    outcome: GuideOutcome,
    result: GuidePlayOptions,
  ): void;
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
  readonly gift?: GuideGift;
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
 * then handed back exactly where it was. The reward scene finds her a way off
 * instead, her back to the Bond and the place behind her, and she turns round
 * to say it. A person who asked for reduced motion gets cuts instead of moves,
 * and she is simply standing there, already facing them.
 */
export function useGuideCutscene({
  renderer,
  anchor,
  bondModel,
  avaia,
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
  const avaiaMotionRef = useRef<GuideBodyMotion | undefined>(undefined);
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
      avaiaMotionRef.current = undefined;
      const you = anchorRef.current ?? {
        longitude: base.center[0],
        latitude: base.center[1],
      };
      stageRef.current =
        scene === "reward" || scene === "backpack"
          ? guideAsideStage(
              you,
              guideAsideBearing(
                you,
                renderer.obstaclesWithin === undefined
                  ? undefined
                  : (bounds) => renderer.obstaclesWithin?.(bounds) ?? [],
              ),
            )
          : guideStage(you);
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
        ...(options.gift === undefined ? {} : { gift: options.gift }),
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
    onEndRef.current(current.scene, current.outcome ?? "done", current);
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
        if (stage.kind === "aside") {
          // Her back to the Bond, the place ahead of her; then she turns.
          const facingBond = (stage.bearing + 180) % 360;
          if (reducedMotion) {
            motionRef.current = {
              kind: "stand",
              at: stage.dasha,
              facing: stage.you,
            };
            shoot(frame("dasha", stage), 0);
            later(0, toLine);
            break;
          }
          motionRef.current = {
            kind: "stand",
            at: stage.dasha,
            facing: stage.entry,
          };
          shoot(frame("establish", stage), ESTABLISH_MS);
          later(ESTABLISH_MS, () => {
            motionRef.current = {
              kind: "turn",
              at: stage.dasha,
              fromBearing: stage.bearing,
              toBearing: facingBond,
              startedMs: globalThis.performance.now(),
              durationMs: GUIDE_TURN_MS,
            };
            shoot(frame("dasha", stage), GUIDE_TURN_MS);
          });
          later(ESTABLISH_MS + GUIDE_TURN_MS, toLine);
          break;
        }
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
        // The Bond's Avaia joins them for the line said to the two of them.
        if (
          script.shot === "together" &&
          avaiaMotionRef.current === undefined
        ) {
          avaiaMotionRef.current = reducedMotion
            ? { kind: "stand", at: stage.avaia, facing: stage.dasha }
            : {
                kind: "walk",
                from: stage.avaiaEntry,
                to: stage.avaia,
                startedMs: now,
                durationMs: GUIDE_AVAIA_WALK_MS,
              };
        }
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
        // Left together, the camera stays with the Bond and its Avaia rather
        // than going back to wherever it was.
        if (
          playingRef.current?.outcome === "together" &&
          avaiaMotionRef.current !== undefined
        ) {
          const pair = lerpPoint(stage.you, stage.avaia, 0.5);
          shoot(
            {
              center: [pair.longitude, pair.latitude],
              zoom: Math.max(base?.zoom ?? 0, GUIDE_TOGETHER_ZOOM),
              pitch: base?.pitch ?? 0,
              bearing: base?.bearing ?? 0,
            },
            RETURN_MS,
          );
        } else if (base !== undefined) shoot(base, RETURN_MS);
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
  const voice = studyVoice(guideModel(bondModel));
  const avaiaModel = avaia?.model;
  const avaiaAppearance = avaia?.appearance;
  useEffect(() => {
    const avatars = renderer.avatars;
    if (!active || avatars === undefined) return;
    const visibleNodes = resolveAvatarScene(model, undefined).visibleNodes;
    const avaiaNodes =
      avaiaModel === undefined
        ? undefined
        : resolveAvatarScene(avaiaModel, avaiaAppearance).visibleNodes;
    let frame: number | undefined;

    function draw(nowMs: number): void {
      const visible = renderer.getCamera().zoom >= MAP_BODY_HANDOVER_ZOOM;
      const joined = avaiaMotionRef.current;
      if (joined === undefined || avaiaModel === undefined) {
        avatars?.remove(GUIDE_AVAIA_HANDLE_ID);
      } else {
        const pose = sampleGuideBody(joined, nowMs, reducedMotion);
        avatars?.upsert({
          id: GUIDE_AVAIA_HANDLE_ID,
          modelId: avaiaModel,
          lngLat: [pose.point.longitude, pose.point.latitude],
          bearingDeg: pose.bearingDeg,
          clipId: pose.clipId,
          clipPhase: pose.clipPhase,
          scale: 1,
          visible,
          ...(avaiaNodes === undefined ? {} : { visibleNodes: avaiaNodes }),
        });
      }
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
          visible,
          visibleNodes,
        });
      }
      frame = globalThis.requestAnimationFrame(draw);
    }

    draw(globalThis.performance.now());
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      avatars.remove(GUIDE_HANDLE_ID);
      avatars.remove(GUIDE_AVAIA_HANDLE_ID);
    };
  }, [active, model, avaiaModel, avaiaAppearance, reducedMotion, renderer]);

  const bondVoice = studyVoice(bondModel);
  const state: GuideCutsceneState | undefined =
    playing === undefined
      ? undefined
      : {
          scene: playing.scene,
          beat: playing.beat,
          line: createGuideLineState(
            playing.node,
            playing.seed,
            t,
            names,
            voice,
            bondVoice,
          ),
          ...(playing.reply === undefined
            ? {}
            : {
                reply: replyText(
                  t,
                  playing.reply,
                  playing.seed,
                  names,
                  bondVoice,
                ),
              }),
          replySpeaker: bondName,
          ...(playing.reward === undefined ? {} : { reward: playing.reward }),
          ...(playing.gift === undefined ? {} : { gift: playing.gift }),
        };

  return { state, play, choose, advance };
}

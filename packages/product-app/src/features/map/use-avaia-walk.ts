// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundCue } from "@nilx-one/host-contract";
import {
  mapCompassBearing,
  mapDistanceMeters,
  type AvatarModelId,
  type MapGroundTap,
  type MapLandmark,
  type MapObstacle,
  type MapPointSelection,
  type MapRenderer,
} from "@nilx-one/map-contract";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ProductLocale } from "../../shell/localization";
import {
  blockedLineKind,
  lineCue,
  pickAvaiaLine,
  type AvaiaLineKind,
} from "./avaia-lines";
import {
  buildWalkGraph,
  reachFrom,
  snapToGraph,
  type LonLat,
} from "@nilx-one/walk-graph";

import { openGround, planWalk } from "./avaia-path";
import { routeBounds } from "./avaia-route";
import {
  approachPoint,
  startWalk,
  studyStance,
  STUDY_CLIP_MS,
  walkPosition,
  walkStance,
  STUDY_MS,
  type AvaiaStudy,
  type AvaiaWalk,
} from "./avaia-walk";
import type { BodyStance } from "./avatar-presence";
import {
  EMPTY_NOTEBOOK,
  nextLandmarkToStudy,
  noticeLandmarks,
  notebookSnapshot,
  studyLandmark,
  subscribeNotebooks,
  updateNotebook,
  NOTICE_ACCURACY_METERS,
  NOTICE_RADIUS_METERS,
  CURIOSITY_REACH_METERS,
  type LandmarkNotebook,
} from "./landmark-notebook";
import type { AwardRecord } from "../progression/commitment";
import {
  chooseOuting,
  initialDrive,
  nextOutingAt,
  outingBudgetMeters,
  POINT_B_STAND_MS,
  recentlyVisited,
  stepDrive,
  VISIT_MS,
  WANDER_MAX_METERS,
  wanderPoint,
  wanderSeed,
  type DriveEvent,
  type WalkPurpose,
} from "./outing-drive";
import { outingMenu, type OutingCandidate } from "./outing-targets";
import { readWorldMemory, rememberWorld } from "./world-memory";

/** How long a line stays on the card before it closes again. */
export const SPEECH_MS = 10_000;

/** How long an Avaia that just took the wheel looks around before it goes. */
export const FIRST_LOOK_MS = 1_500;

/** How long an Avaia stands idle before curiosity moves it again. */
export const IDLE_CURIOSITY_MS = 15_000;

/**
 * One footfall in this many milliseconds: the `walk` clip loops at 1.2 s and
 * lands both feet in that time.
 */
export const STEP_MS = 600;

/**
 * The ground right around the person is theirs to send a body onto even
 * before its cell has lit: they are standing on it.
 */
export const NEAR_DEVICE_OPEN_METERS = 50;

export interface AvaiaSpeech {
  readonly id: number;
  readonly text: string;
}

interface Rest {
  readonly point: MapPointSelection;
  readonly bearingDeg: number;
}

export interface AvaiaWalkInput {
  readonly renderer: MapRenderer;
  /** The Avaia is at the wheel and the handover has finished. */
  readonly active: boolean;
  /**
   * Where the Bond stands and how sure that is: this device's own
   * observation, or a point the Bond declared (`declared`), which is never
   * evidence of having passed anything.
   */
  readonly observed:
    | (MapPointSelection & {
        readonly accuracyMeters: number;
        readonly declared?: true;
      })
    | undefined;
  /** The study the Avaia is drawn in, whose voice it speaks with. */
  readonly model: AvatarModelId | undefined;
  readonly locale: ProductLocale;
  /** The Avaia's own address: whose notes a study goes under. */
  readonly avaiaAddress: string;
  /** The Bond that owns the Avaia: whose notebook this is. */
  readonly owner: string;
  readonly zoom: number;
  readonly reducedMotion: boolean;
  /**
   * A tap into the fog, offered to whoever can reveal it before the Avaia
   * refuses it. `true` means it was taken and the Avaia says nothing of its
   * own; `"busy"` means the Avaia is already revealing all it can and says so.
   */
  readonly onFogTap?: (tap: MapPointSelection) => boolean | "busy";
  /**
   * Marks what the Avaia does with a sound: a line it says, a footfall while
   * it walks. Whether anything is heard is the host's and the person's.
   */
  readonly onCue?: (cue: SoundCue) => void;
  /** Told every line the Avaia says, so it can be said aloud as well. */
  readonly onLine?: (line: {
    readonly kind: AvaiaLineKind;
    readonly text: string;
  }) => void;
  /**
   * A route is evidence for chance finds only once the body actually reaches
   * its end. Interrupted/replanned routes never report their unwalked tail.
   */
  readonly onWalkCompleted?: (walk: AvaiaWalk) => void;
  /**
   * A local fact that should enter R3 committed progression. The caller owns
   * persistence/sync; this walking hook only names what actually happened.
   */
  readonly onAward?: (record: AwardRecord) => void;
  /**
   * Normalized walk targets the drive may take the Avaia out to. Until the
   * landmark mapper supplies them an outing can only wander or go home.
   */
  readonly outingCandidates?: readonly OutingCandidate[];
}

/** Standing somewhere and looking around: at a tapped point B, or a target. */
interface Pause {
  readonly at: MapPointSelection;
  readonly bearingDeg: number;
  readonly startedMs: number;
  readonly durationMs: number;
}

/**
 * Whether any of nine points spread over a tile's box is open ground: a tile
 * that is all fog has nothing an outing could walk on.
 */
function touchesOpen(
  tile: { west: number; east: number; south: number; north: number },
  open: (point: MapPointSelection) => boolean,
): boolean {
  for (const fx of [0, 0.5, 1]) {
    for (const fy of [0, 0.5, 1]) {
      if (
        open({
          longitude: tile.west + (tile.east - tile.west) * fx,
          latitude: tile.south + (tile.north - tile.south) * fy,
        })
      ) {
        return true;
      }
    }
  }
  return false;
}

/** How far around the Avaia the roads are read for planning an outing. */
function boundsAround(point: MapPointSelection, meters: number) {
  const dLat = (meters / 6_371_008.8) * (180 / Math.PI);
  const dLng =
    dLat / Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180));
  return {
    west: point.longitude - dLng,
    east: point.longitude + dLng,
    south: point.latitude - dLat,
    north: point.latitude + dLat,
  };
}

export interface AvaiaWalkState {
  /**
   * Where the Avaia's body is and what it is doing at an instant. Undefined
   * means at this device in the ambient rhythm, which is where a body stands
   * until it is sent somewhere.
   */
  stance(nowMs: number): BodyStance | undefined;
  /** True while something is moving and the world needs frames. */
  readonly moving: boolean;
  readonly speech: AvaiaSpeech | undefined;
  readonly notebook: LandmarkNotebook;
  /** Back to the device, silent and still: what taking the wheel starts from. */
  reset(): void;
  /**
   * Sends the body somewhere the application chose rather than a tap —
   * a fog cell it was asked to reveal — fog or not. False when the body has
   * nowhere to start from, or buildings and water leave no way there.
   */
  walkTo(point: MapPointSelection): boolean;
  /** Says one line in this Avaia's voice. */
  announce(kind: AvaiaLineKind): void;
}

/**
 * An Avaia at the wheel, walking where its owner points and wandering up to
 * what its owner walked past.
 *
 * Commanded walks come from a tap on open ground. Curiosity comes from the
 * notebook: a landmark the person's own device passed close to, which the
 * Avaia has not studied yet. A command always outranks curiosity, and leaving
 * the wheel ends both — there is no walking in the background.
 */
export function useAvaiaWalk({
  renderer,
  active,
  observed,
  model,
  locale,
  avaiaAddress,
  owner,
  zoom,
  reducedMotion,
  onFogTap,
  onCue,
  onLine,
  onWalkCompleted,
  onAward,
  outingCandidates,
}: AvaiaWalkInput): AvaiaWalkState {
  const [walk, setWalk] = useState<AvaiaWalk | undefined>(undefined);
  const [study, setStudy] = useState<AvaiaStudy | undefined>(undefined);
  const [pause, setPause] = useState<Pause | undefined>(undefined);
  // The drive's own state, and a version that changes with it so effects that
  // read it run again. What a walk under way is for, for when it arrives.
  const [firstDrive] = useState(() =>
    initialDrive(Date.now(), readWorldMemory(owner).lastOutingAt ?? null),
  );
  const drive = useRef(firstDrive);
  const [driveVersion, setDriveVersion] = useState(0);
  const walkPurpose = useRef<WalkPurpose>("tap");
  const dispatch = useCallback(
    (event: DriveEvent) => {
      const before = drive.current;
      const after = stepDrive(before, event);
      if (after === before) return;
      drive.current = after;
      if (
        after.lastOutingAt !== null &&
        after.lastOutingAt !== before.lastOutingAt
      ) {
        rememberWorld(owner, { lastOutingAt: after.lastOutingAt });
      }
      setDriveVersion((version) => version + 1);
    },
    [owner],
  );
  // A world opened again finds its Avaia where it was left, not back at its
  // owner's feet: where it stood, or where it was headed when the page went.
  const [rest, setRest] = useState<Rest | undefined>(() => {
    const remembered = readWorldMemory(owner).avaia;
    return remembered === undefined
      ? undefined
      : {
          point: {
            longitude: remembered.longitude,
            latitude: remembered.latitude,
          },
          bearingDeg: remembered.bearingDeg,
        };
  });
  const [speech, setSpeech] = useState<AvaiaSpeech | undefined>(undefined);
  // Whether anything has happened since the wheel changed hands, which is what
  // decides between a first look around and an idle wander.
  const [acted, setActed] = useState(false);
  const notebook = useSyncExternalStore(
    subscribeNotebooks,
    () => notebookSnapshot(owner),
    () => EMPTY_NOTEBOOK,
  );
  const speechCount = useRef(0);
  const lastLine = useRef<string | undefined>(undefined);

  const observedLongitude = observed?.longitude;
  const observedLatitude = observed?.latitude;
  const observedAccuracy = observed?.accuracyMeters;
  const observedDeclared = observed?.declared === true;

  // Everything a callback needs to read "now", kept current without tearing
  // down the renderer subscription on every frame's worth of change.
  const latest = useRef({
    walk,
    study,
    rest,
    observed,
    model,
    locale,
    zoom,
    reducedMotion,
    avaiaAddress,
    owner,
    onFogTap,
    onCue,
    onLine,
    onWalkCompleted,
    onAward,
    outingCandidates,
  });
  useEffect(() => {
    latest.current = {
      walk,
      study,
      rest,
      observed,
      model,
      locale,
      zoom,
      reducedMotion,
      avaiaAddress,
      owner,
      onFogTap,
      onCue,
      onLine,
      onWalkCompleted,
      onAward,
      outingCandidates,
    };
  });

  const say = useCallback(
    (kind: AvaiaLineKind, landmark?: MapLandmark): void => {
      const { model: voice, locale: language } = latest.current;
      if (voice === undefined) return;
      const text = pickAvaiaLine({
        locale: language,
        model: voice,
        kind,
        landmark,
        previous: lastLine.current,
      });
      lastLine.current = text;
      speechCount.current += 1;
      setSpeech({ id: speechCount.current, text });
      const cue = lineCue(kind);
      if (cue !== undefined) latest.current.onCue?.(cue);
      latest.current.onLine?.({ kind, text });
    },
    [],
  );

  /** Where the body is at this instant, whatever it is doing. */
  const currentPoint = useCallback(
    (nowMs: number): MapPointSelection | undefined => {
      const now = latest.current;
      if (now.walk !== undefined) return walkPosition(now.walk, nowMs);
      if (now.study !== undefined) return now.study.at;
      if (now.rest !== undefined) return now.rest.point;
      return now.observed === undefined
        ? undefined
        : {
            longitude: now.observed.longitude,
            latitude: now.observed.latitude,
          };
    },
    [],
  );

  /**
   * Sends the body to `to` along the paths the map has loaded between here and
   * there, and around its buildings and water where it crosses open ground.
   * `purpose` says who picked `to`: a tap is the owner, who may send it across
   * the grass; everything else is the Avaia's drive, which keeps to the paths.
   * Answers whether it set off, or what stood in the way when no way round was
   * found. Setting off is reported to the drive.
   */
  const goTo = useCallback(
    (
      to: MapPointSelection,
      nowMs: number,
      how: {
        readonly purpose: WalkPurpose;
        readonly targetId?: string;
        readonly landmark?: MapLandmark;
      },
    ): "walking" | "nowhere" | MapObstacle["kind"] | "fog" => {
      const { purpose, targetId, landmark } = how;
      const from = currentPoint(nowMs);
      if (from === undefined) return "nowhere";
      const bounds = routeBounds(from, to);
      const route = planWalk({
        from,
        to,
        roads: renderer.roadsWithin?.(bounds) ?? [],
        obstacles: renderer.obstaclesWithin?.(bounds) ?? [],
        chooser: purpose === "tap" ? "tap" : "own",
        open: openGround({
          fog: renderer.fog,
          device: latest.current.observed,
          body: from,
          nearDeviceMeters: NEAR_DEVICE_OPEN_METERS,
        }),
      });
      if (route.kind === "blocked") return route.by;
      const next = startWalk({
        from,
        to: route.path[route.path.length - 1] ?? to,
        path: route.path,
        nowMs,
        zoom: latest.current.zoom,
        landmark,
      });
      setStudy(undefined);
      setPause(undefined);
      setActed(true);
      walkPurpose.current = purpose;
      dispatch(
        purpose === "tap"
          ? { type: "tap", at: Date.now() }
          : {
              type: "set_off",
              at: Date.now(),
              purpose,
              ...(targetId === undefined ? {} : { targetId }),
            },
      );
      // Reduced motion still goes where it was sent; it just arrives.
      setWalk(latest.current.reducedMotion ? { ...next, durationMs: 0 } : next);
      return "walking";
    },
    [currentPoint, dispatch, renderer],
  );

  // A tap on the world is the owner pointing. Open ground is a walk; anything
  // else is the Avaia saying why not, in its own words.
  useEffect(() => {
    if (!active) return;
    const subscribe = renderer.subscribeGroundTap;
    if (subscribe === undefined) return;

    return subscribe.call(renderer, (tap: MapGroundTap) => {
      const nowMs = globalThis.performance.now();
      const { observed: device } = latest.current;
      const nearDevice =
        device !== undefined &&
        mapDistanceMeters(device, tap) <= NEAR_DEVICE_OPEN_METERS;
      // Fog is first offered for revealing. A Bond is never in the fog —
      // the ground under it is its own — so only what nobody takes falls
      // back to walking or to a refusal.
      if (tap.ground === "fog") {
        const taken = latest.current.onFogTap?.({
          longitude: tap.longitude,
          latitude: tap.latitude,
        });
        if (taken === "busy") {
          setActed(true);
          say("fog.busy");
          return;
        }
        if (taken === true) {
          setActed(true);
          return;
        }
      }
      const ground = tap.ground === "fog" && nearDevice ? "open" : tap.ground;
      if (ground !== "open") {
        setActed(true);
        say(blockedLineKind(ground));
        return;
      }
      const went = goTo(
        { longitude: tap.longitude, latitude: tap.latitude },
        nowMs,
        { purpose: "tap" },
      );
      if (went === "walking") {
        say("walk");
      } else if (went !== "nowhere") {
        // Open ground with no way to it: it is behind what the body cannot
        // walk through, so that is what the Avaia names.
        setActed(true);
        say(blockedLineKind(went));
      }
    });
  }, [active, goTo, renderer, say]);

  // A walk ends on its own. Arriving at a landmark turns into looking at it;
  // arriving at a tapped point B or an outing's target is standing there a
  // while, looking around; arriving anywhere else is simply standing there.
  useEffect(() => {
    if (walk === undefined) return;
    const remaining = Math.max(
      0,
      walk.startedMs + walk.durationMs - globalThis.performance.now(),
    );
    const arrived = globalThis.setTimeout(() => {
      const nowMs = globalThis.performance.now();
      const purpose = walkPurpose.current;
      latest.current.onWalkCompleted?.(walk);
      setWalk(undefined);
      dispatch({
        type: "arrived",
        at: Date.now(),
        meters: walk.along[walk.along.length - 1] ?? 0,
      });
      if (walk.landmark !== undefined) {
        setStudy({
          landmark: walk.landmark,
          at: walk.to,
          bearingDeg: mapCompassBearing(walk.to, walk.landmark),
          startedMs: nowMs,
        });
        setRest(undefined);
        return;
      }
      setRest({ point: walk.to, bearingDeg: walk.arrivalBearingDeg });
      if (purpose === "tap" || purpose === "outing") {
        setPause({
          at: walk.to,
          bearingDeg: walk.arrivalBearingDeg,
          startedMs: nowMs,
          durationMs: purpose === "tap" ? POINT_B_STAND_MS : VISIT_MS,
        });
      }
    }, remaining);
    return () => globalThis.clearTimeout(arrived);
  }, [dispatch, walk]);

  // A stand ends on its own too, and the Avaia carries on from where it
  // stands: from point B, not from home.
  useEffect(() => {
    if (pause === undefined) return;
    const remaining = Math.max(
      0,
      pause.startedMs + pause.durationMs - globalThis.performance.now(),
    );
    const done = globalThis.setTimeout(() => {
      setPause(undefined);
      const { activity } = drive.current;
      dispatch({
        type: "tick",
        at:
          activity.kind === "standing"
            ? Math.max(Date.now(), activity.until)
            : Date.now(),
      });
    }, remaining);
    return () => globalThis.clearTimeout(done);
  }, [dispatch, pause]);

  // A walking body is heard walking. A walk with no duration — reduced
  // motion, which arrives without walking — makes no footfall at all.
  useEffect(() => {
    if (walk === undefined || walk.durationMs <= 0) return;
    const steps = globalThis.setInterval(() => {
      latest.current.onCue?.("step");
    }, STEP_MS);
    const remaining = Math.max(
      0,
      walk.startedMs + walk.durationMs - globalThis.performance.now(),
    );
    const stops = globalThis.setTimeout(
      () => globalThis.clearInterval(steps),
      remaining,
    );
    return () => {
      globalThis.clearInterval(steps);
      globalThis.clearTimeout(stops);
    };
  }, [walk]);

  // Looking a landmark over takes a moment; then it goes in the notebook and
  // the Avaia says what it learned.
  useEffect(() => {
    if (study === undefined) return;
    const remaining = Math.max(
      0,
      study.startedMs + STUDY_MS - globalThis.performance.now(),
    );
    const done = globalThis.setTimeout(() => {
      const { owner: book, avaiaAddress: by } = latest.current;
      updateNotebook(book, (current) =>
        studyLandmark(current, study.landmark, by, Date.now()),
      );
      latest.current.onAward?.({
        kind: "landmark_studied",
        earner: "avaia",
        subject: study.landmark.id,
        at: Date.now(),
      });
      setStudy(undefined);
      setRest({ point: study.at, bearingDeg: study.bearingDeg });
      say("landmark.studied", study.landmark);
    }, remaining);
    return () => globalThis.clearTimeout(done);
  }, [say, study]);

  // Where the body will be once what it is doing ends is what this device
  // keeps, so a page dropped mid-walk comes back with the Avaia arrived.
  const settledPoint =
    walk !== undefined
      ? { point: walk.to, bearingDeg: walk.arrivalBearingDeg }
      : study !== undefined
        ? { point: study.at, bearingDeg: study.bearingDeg }
        : rest;
  const settledLongitude = settledPoint?.point.longitude;
  const settledLatitude = settledPoint?.point.latitude;
  const settledBearing = settledPoint?.bearingDeg;
  useEffect(() => {
    rememberWorld(owner, {
      avaia:
        settledLongitude === undefined ||
        settledLatitude === undefined ||
        settledBearing === undefined
          ? undefined
          : {
              longitude: settledLongitude,
              latitude: settledLatitude,
              bearingDeg: settledBearing,
            },
    });
  }, [owner, settledBearing, settledLatitude, settledLongitude]);

  // A line is on the card for as long as a person needs to read it.
  useEffect(() => {
    if (speech === undefined) return;
    const closes = globalThis.setTimeout(() => {
      setSpeech((current) => (current?.id === speech.id ? undefined : current));
    }, SPEECH_MS);
    return () => globalThis.clearTimeout(closes);
  }, [speech]);

  // Noticing belongs to the person: whoever is at the wheel, this device
  // passing close to a landmark the basemap draws is what writes it down.
  // It is asked twice over: when the observation moves, and when the map has
  // loaded more of itself — a position that arrives before its tiles do is
  // noticed once they land, not missed until the person moves again.
  useEffect(() => {
    function notice(): void {
      if (
        observedDeclared ||
        observedLongitude === undefined ||
        observedLatitude === undefined ||
        observedAccuracy === undefined ||
        observedAccuracy > NOTICE_ACCURACY_METERS
      ) {
        return;
      }
      const found = renderer.landmarksNear?.(
        { longitude: observedLongitude, latitude: observedLatitude },
        NOTICE_RADIUS_METERS,
      );
      if (found === undefined || found.length === 0) return;
      // Only what is actually new to the notebook earns experience — a
      // landmark already noticed does not pay out again just because the
      // device observation moved again nearby.
      const known = new Set(
        notebookSnapshot(owner).noticed.map((entry) => entry.landmark.id),
      );
      const newlyNoticed = found.filter((landmark) => !known.has(landmark.id));
      updateNotebook(owner, (current) =>
        noticeLandmarks(current, found, Date.now()),
      );
      for (const landmark of newlyNoticed) {
        latest.current.onAward?.({
          kind: "landmark_noticed",
          earner: "bond",
          subject: landmark.id,
          at: Date.now(),
        });
      }
    }

    notice();
    return renderer.subscribeLandmarksChanged?.call(renderer, notice);
  }, [
    observedAccuracy,
    observedDeclared,
    observedLatitude,
    observedLongitude,
    owner,
    renderer,
  ]);

  // Curiosity: an idle Avaia at the wheel goes to see the nearest thing its
  // owner walked past and it has not studied. It looks around first when it
  // has just arrived, and waits longer once it has been doing things.
  const idle =
    active && walk === undefined && study === undefined && pause === undefined;
  useEffect(() => {
    if (!idle) return;
    const wander = globalThis.setTimeout(
      () => {
        const nowMs = globalThis.performance.now();
        const from = currentPoint(nowMs);
        if (from === undefined) return;
        const { owner: book, avaiaAddress: by } = latest.current;
        const open = openGround({
          fog: renderer.fog,
          device: latest.current.observed,
          body: from,
          nearDeviceMeters: NEAR_DEVICE_OPEN_METERS,
        });
        const landmark = nextLandmarkToStudy(
          notebookSnapshot(book),
          by,
          from,
          CURIOSITY_REACH_METERS,
          open,
        );
        if (landmark === undefined) return;
        if (
          goTo(approachPoint(from, landmark), nowMs, {
            purpose: "curiosity",
            landmark,
          }) === "walking"
        ) {
          say("landmark.spotted", landmark);
        }
      },
      acted ? IDLE_CURIOSITY_MS : FIRST_LOOK_MS,
    );
    return () => globalThis.clearTimeout(wander);
  }, [acted, currentPoint, goTo, idle, notebook, renderer, say]);

  // The drive: an idle Avaia, restless enough and rested since its last
  // outing, goes out on its own. The menu and the pick are code's; with no
  // targets yet it wanders a short way along the paths, or goes home tired.
  useEffect(() => {
    if (!idle) return;
    const when = nextOutingAt(drive.current);
    if (when === null) return;
    // Set when the Avaia gets busy while the outing is still reading ahead.
    let cancelled = false;
    const goOut = async () => {
      const from = currentPoint(globalThis.performance.now());
      if (from === undefined) return;
      const state = drive.current;
      const budget = outingBudgetMeters(state);
      const area = boundsAround(from, budget);
      const open = openGround({
        fog: renderer.fog,
        device: latest.current.observed,
        body: from,
        nearDeviceMeters: NEAR_DEVICE_OPEN_METERS,
      });
      // The view holds only what is on screen; an outing reads the road tiles
      // of its whole area ahead, but not a tile with no open ground in it.
      await renderer.preloadRoads?.call(
        renderer,
        area,
        open === undefined ? undefined : (tile) => touchesOpen(tile, open),
      );
      if (cancelled) return;
      {
        const nowMs = globalThis.performance.now();
        const wall = Date.now();
        const graph = buildWalkGraph(renderer.roadsWithin?.(area) ?? []);
        const canEnter =
          open === undefined
            ? undefined
            : ([longitude, latitude]: readonly [number, number]) =>
                open({ longitude, latitude });
        const at: LonLat = [from.longitude, from.latitude];
        const menu = outingMenu({
          candidates: latest.current.outingCandidates ?? [],
          graph,
          from: at,
          open: canEnter,
          budgetMeters: budget,
          exclude: recentlyVisited(state, wall),
          obstacles: renderer.obstaclesWithin?.(area) ?? [],
        });
        const device = latest.current.observed;
        const choice = chooseOuting(state, menu, {
          at,
          home:
            device === undefined
              ? undefined
              : [device.longitude, device.latitude],
          hour: new Date(wall).getHours(),
        });
        const point = ([longitude, latitude]: LonLat) => ({
          longitude,
          latitude,
        });
        let went = false;
        if (choice.kind === "target") {
          went =
            goTo(point(choice.target.anchor), nowMs, {
              purpose: "outing",
              targetId: choice.target.id,
            }) === "walking";
        } else if (choice.kind === "home" && device !== undefined) {
          went = goTo(device, nowMs, { purpose: "home" }) === "walking";
        } else if (choice.kind === "wander") {
          const start = snapToGraph(graph, at, canEnter ? { canEnter } : {});
          const there =
            start === null
              ? undefined
              : wanderPoint(
                  graph,
                  reachFrom(graph, start, {
                    maxCost: WANDER_MAX_METERS * 3,
                    ...(canEnter ? { canEnter } : {}),
                  }),
                  wanderSeed(wall),
                );
          went =
            there !== undefined &&
            goTo(point(there), nowMs, { purpose: "wander" }) === "walking";
        }
        if (went) say("walk");
        else dispatch({ type: "stayed", at: wall });
      }
    };
    const outing = globalThis.setTimeout(
      () => void goOut(),
      Math.max(0, when - Date.now()),
    );
    return () => {
      cancelled = true;
      globalThis.clearTimeout(outing);
    };
  }, [currentPoint, dispatch, driveVersion, goTo, idle, renderer, say]);

  const stance = useCallback(
    (nowMs: number): BodyStance | undefined => {
      if (walk !== undefined) return walkStance(walk, nowMs);
      if (study !== undefined) return studyStance(study, nowMs);
      if (pause !== undefined) {
        const since = Math.max(0, nowMs - pause.startedMs);
        return {
          point: pause.at,
          bearingDeg: pause.bearingDeg,
          clipId: "turn_in_place",
          clipPhase: (since % STUDY_CLIP_MS) / STUDY_CLIP_MS,
        };
      }
      return rest;
    },
    [pause, rest, study, walk],
  );

  const reset = useCallback(() => {
    dispatch({ type: "stopped", at: Date.now() });
    setWalk(undefined);
    setStudy(undefined);
    setPause(undefined);
    setRest(undefined);
    setSpeech(undefined);
    setActed(false);
    lastLine.current = undefined;
  }, [dispatch]);

  const walkTo = useCallback(
    (point: MapPointSelection): boolean =>
      goTo(point, globalThis.performance.now(), { purpose: "tap" }) ===
      "walking",
    [goTo],
  );

  const moving =
    walk !== undefined || study !== undefined || pause !== undefined;
  // One object per change that matters, so the world redraws a body when the
  // Avaia does something and not whenever the surface around it re-renders.
  return useMemo(
    () => ({
      stance,
      moving,
      speech,
      notebook,
      reset,
      walkTo,
      announce: say,
    }),
    [moving, notebook, reset, say, speech, stance, walkTo],
  );
}

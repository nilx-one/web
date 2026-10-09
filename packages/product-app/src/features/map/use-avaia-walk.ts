// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaDriveCommand,
  AvaiaDriveInput,
  AvaiaDriveLifeIntent,
  CoreRuntimePort,
} from "@nilx-one/application";
import type { SoundCue } from "@nilx-one/host-contract";
import {
  mapCompassBearing,
  mapDistanceMeters,
  type AvatarModelId,
  type MapBounds,
  type MapGroundTap,
  type MapLandmark,
  type MapObstacle,
  type MapPointSelection,
  type MapRenderer,
} from "@nilx-one/map-contract";
import { buildWalkGraph, type LonLat } from "@nilx-one/walk-graph";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ProductLocale } from "../../shell/localization";
import type { AwardRecord } from "../progression/commitment";
import {
  blockedLineKind,
  lineCue,
  pickAvaiaLine,
  type AvaiaLineKind,
} from "./avaia-lines";
import { openGround, planWalk } from "./avaia-path";
import { routeBounds } from "./avaia-route";
import {
  approachPoint,
  nextFootfallMs,
  startWalk,
  studyStance,
  STUDY_CLIP_MS,
  walkedSoFar,
  walkPosition,
  walkStance,
  STUDY_MS,
  type AvaiaStudy,
  type AvaiaWalk,
} from "./avaia-walk";
import type { BodyStance } from "./avatar-presence";
import type { DriveChoose } from "./drive-choice";
import {
  DriveRefs,
  findsAlong,
  outingTarget,
  passingThings,
  strollNodes,
  wanderNodes,
  wayAhead,
  wholeMeters,
  type DriveRefEntry,
} from "./drive-world";
import {
  EMPTY_NOTEBOOK,
  landmarksToStudy,
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
import { landmarksFromArchive } from "./landmark-mapper";
import {
  outingCandidates as walkTargets,
  outingMenu,
  type OutingCandidate,
  type OutingTarget,
} from "./outing-targets";
import {
  affinitySnapshot,
  emptyAffinity,
  favourites,
  nextFavouriteChange,
  feelingFor,
  placesToReturnTo,
  recordVisit,
  returnAfterMs,
  subscribeAffinities,
  updateAffinity,
  type FondPlace,
  type VisitedPlace,
} from "./place-affinity";
import { readWorldMemory, rememberWorld } from "./world-memory";

/** The longest delay a timer keeps; a later one is set again when it fires. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** How long a line stays on the card before it closes again. */
export const SPEECH_MS = 10_000;

/**
 * The ground right around the person is theirs to send a body onto even
 * before its cell has lit: they are standing on it.
 */
export const NEAR_DEVICE_OPEN_METERS = 50;

/** How often a walk looks around for what it passes. */
export const PASSING_EVERY_MS = 1_000;

/** How long a stand at a point B lasts when Core has no drive to say. */
export const POINT_B_STAND_MS = 20_000;

/** A target visited this recently is left off the menu, unless it is dear. */
const REVISIT_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a model is given to choose; Core's own pick stands after that. */
const CHOOSE_MS = 3_500;

/** Curiosity offers at most this many landmarks, the drive's own cap. */
const CURIOSITY_OPTIONS = 6;
/** Of which fresh ones, nearest first, leaving room for dear places. */
const CURIOSITY_FRESH = 4;
/** A kind the drive accepts; any other is left off rather than refused. */
const DRIVE_KIND = /^[a-z][a-z_]{0,31}$/;

export interface AvaiaSpeech {
  readonly id: number;
  readonly text: string;
}

interface Rest {
  readonly point: MapPointSelection;
  readonly bearingDeg: number;
}

/** What Avaia life (`docs/avaia-life.md` in core) last said its needs ask. */
export interface AvaiaLifeSignal {
  readonly intent: AvaiaDriveLifeIntent;
  /** 0 to 10000. */
  readonly energy: number;
  readonly home?: MapPointSelection | undefined;
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
  /** Authoritative admin trip, delivered only when the service revision changed. */
  readonly travelArrival?: {
    readonly coordinate: MapPointSelection;
    readonly revision: string;
  };
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
   * Core, whose drive decides what the Avaia does next
   * (`docs/avaia-drive.md` in core). Absent, or a runtime built before the
   * drive, and the Avaia only walks where its owner taps.
   */
  readonly core?: Pick<CoreRuntimePort, "avaiaDriveStep"> | undefined;
  /**
   * Puts a choice the drive offers to a local model and answers with the
   * option it picked, or `null`. Absent, the drive's own pick stands.
   */
  readonly chooser?:
    ((choose: DriveChoose) => Promise<number | null>) | undefined;
  /** What the Avaia's needs ask of it, from Core's Avaia life. */
  readonly life?: AvaiaLifeSignal | undefined;
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
   * A route is evidence for chance finds only as far as the body actually
   * walked it: a route that arrived, or the part of one walked before it was
   * cut short. The unwalked tail is never reported.
   */
  readonly onWalkCompleted?: (walk: AvaiaWalk) => void;
  /**
   * A local fact that should enter R3 committed progression. The caller owns
   * persistence/sync; this walking hook only names what actually happened.
   */
  readonly onAward?: (record: AwardRecord) => void;
  /**
   * Normalized walk targets an outing may go to. Absent, the landmarks the
   * renderer has loaded within the outing's budget are mapped
   * (docs/avaia-osm-landmarks.md).
   */
  readonly outingCandidates?: readonly OutingCandidate[];
}

/** Standing somewhere and looking around, for as long as the drive says. */
interface Pause {
  readonly at: MapPointSelection;
  readonly bearingDeg: number;
  readonly startedMs: number;
  readonly durationMs: number;
}

/** An outing target as a landmark a line can name. */
function targetLandmark(target: OutingTarget): MapLandmark {
  return {
    id: target.id,
    kind: target.kind,
    name: target.name,
    longitude: target.anchor[0],
    latitude: target.anchor[1],
    facts: {},
  };
}

/** What a ref names, as a landmark a line can name, when it names one. */
function refLandmark(
  entry: DriveRefEntry | undefined,
): MapLandmark | undefined {
  if (entry === undefined) return undefined;
  switch (entry.kind) {
    case "landmark":
    case "area":
      return entry.landmark;
    case "target":
      return targetLandmark(entry.target);
    default:
      return undefined;
  }
}

/**
 * What the notebook holds, noticed or studied, by id: the only places
 * curiosity goes back to. A park an outing found is the drive's to go back
 * to, not the notebook's to study, and it never pays for a study.
 */
function notebookLandmarks(
  notebook: LandmarkNotebook,
): ReadonlyMap<string, MapLandmark> {
  const landmarks = new Map<string, MapLandmark>();
  for (const { landmark } of [...notebook.noticed, ...notebook.studied]) {
    landmarks.set(landmark.id, landmark);
  }
  return landmarks;
}

function visitedPlace(landmark: MapLandmark): VisitedPlace {
  return {
    id: landmark.id,
    kind: landmark.kind,
    name: landmark.name,
    longitude: landmark.longitude,
    latitude: landmark.latitude,
  };
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

/** How far around a point the roads are read for planning. */
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

/**
 * What the Avaia does with no drive in Core to ask: it walks where its owner
 * taps and stands there a while. Nothing of its own.
 */
function tapOnly(input: AvaiaDriveInput): AvaiaDriveCommand[] {
  switch (input.type) {
    case "tap":
      return [
        { do: "walk", to: input.to, purpose: "tap", grass: true },
        { do: "say", line: "walk" },
      ];
    case "arrived":
      return [{ do: "look", ms: POINT_B_STAND_MS }];
    case "blocked":
      return input.by === undefined
        ? []
        : [{ do: "say", line: `blocked.${input.by}` }];
    default:
      return [];
  }
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
  /** The places this Avaia grew fond of, loved ones first. */
  readonly favourites: readonly FondPlace[];
  /**
   * Freeze at and return the same point. An ambient Avaia's first stop takes
   * its own anchor from the current observation; later Bond fixes do not move it.
   */
  stop(): MapPointSelection | undefined;
  /**
   * Sends the body somewhere the application chose rather than a tap — a fog
   * cell it was asked to reveal — as its owner's point B. False when the body
   * has nowhere to start from.
   */
  walkTo(point: MapPointSelection): boolean;
  /** Says one line in this Avaia's voice. */
  announce(kind: AvaiaLineKind): void;
}

/**
 * An Avaia at the wheel: a body this device draws, carrying out what the
 * drive in Core decides.
 *
 * Core decides what it does next — strolling about after a point B, going
 * out, stepping aside for something on the way — and where a choice is the
 * Avaia's own, a local model may pick from the menu Core offers. This hook
 * is the drive's hands and eyes: it tells the drive what happened, resolves
 * the ground into refs when the drive asks what is around, and walks,
 * stands, studies and speaks as the drive says. A tap is its owner's point B
 * and always comes first, and leaving the wheel ends all of it — there is no
 * walking in the background.
 */
export function useAvaiaWalk({
  renderer,
  active,
  observed,
  travelArrival,
  model,
  locale,
  avaiaAddress,
  owner,
  zoom,
  reducedMotion,
  core,
  chooser,
  life,
  onFogTap,
  onCue,
  onLine,
  onWalkCompleted,
  onAward,
  outingCandidates,
}: AvaiaWalkInput): AvaiaWalkState {
  const [walk, setWalkState] = useState<AvaiaWalk | undefined>(undefined);
  const [study, setStudyState] = useState<AvaiaStudy | undefined>(undefined);
  const [pause, setPauseState] = useState<Pause | undefined>(undefined);
  // A world opened again finds its Avaia where it was left, not back at its
  // owner's feet: where it stood, or where it was headed when the page went.
  const [rest, setRestState] = useState<Rest | undefined>(() => {
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
  const notebook = useSyncExternalStore(
    subscribeNotebooks,
    () => notebookSnapshot(owner),
    () => EMPTY_NOTEBOOK,
  );
  const noAffinity = useMemo(() => emptyAffinity(avaiaAddress), [avaiaAddress]);
  const affinity = useSyncExternalStore(
    subscribeAffinities,
    () => affinitySnapshot(owner, avaiaAddress),
    () => noAffinity,
  );
  // The time the favourites are read at. A render reads no clock, so it is
  // set when the world opens, when a visit is felt, and when the next place
  // fades out of the favourites.
  const [clock, setClock] = useState(() => Date.now());
  const speechCount = useRef(0);
  const lastLine = useRef<string | undefined>(undefined);

  // The drive's stored state, opaque here, and the refs it was handed.
  const driveState = useRef<string>(readWorldMemory(owner).drive ?? "");
  const refs = useRef(new DriveRefs());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const wake = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped whenever the wheel changes hands, so a step answered for the
  // Avaia that left is not carried out by the one that took over.
  const era = useRef(0);
  const lastPassing = useRef("");

  const observedLongitude = observed?.longitude;
  const observedLatitude = observed?.latitude;
  const observedAccuracy = observed?.accuracyMeters;
  const observedDeclared = observed?.declared === true;

  // Everything a callback needs to read "now", kept current without tearing
  // down the renderer subscription on every frame's worth of change. What the
  // body does is written here the moment it changes too, so a command that
  // follows another in the same answer starts from where the first left it.
  const latest = useRef({
    walk,
    study,
    pause,
    rest,
    observed,
    model,
    locale,
    zoom,
    reducedMotion,
    avaiaAddress,
    owner,
    core,
    chooser,
    onFogTap,
    onCue,
    onLine,
    onWalkCompleted,
    onAward,
    outingCandidates,
  });
  useEffect(() => {
    latest.current = {
      ...latest.current,
      walk,
      study,
      pause,
      rest,
      observed,
      model,
      locale,
      zoom,
      reducedMotion,
      avaiaAddress,
      owner,
      core,
      chooser,
      onFogTap,
      onCue,
      onLine,
      onWalkCompleted,
      onAward,
      outingCandidates,
    };
  });
  const setWalk = useCallback((next: AvaiaWalk | undefined) => {
    latest.current = { ...latest.current, walk: next };
    setWalkState(next);
  }, []);
  const setStudy = useCallback((next: AvaiaStudy | undefined) => {
    latest.current = { ...latest.current, study: next };
    setStudyState(next);
  }, []);
  const setPause = useCallback((next: Pause | undefined) => {
    latest.current = { ...latest.current, pause: next };
    setPauseState(next);
  }, []);
  const setRest = useCallback((next: Rest | undefined) => {
    latest.current = { ...latest.current, rest: next };
    setRestState(next);
  }, []);

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

  /**
   * A visit over: how it felt goes into the Avaia's record of places, and the
   * visit after which a place is loved is said out loud. True when it was.
   */
  const feel = useCallback(
    (landmark: MapLandmark): boolean => {
      const { owner: book, avaiaAddress: by } = latest.current;
      const at = Date.now();
      let fell = false;
      updateAffinity(book, by, (current) => {
        const visit = recordVisit(
          current,
          visitedPlace(landmark),
          at,
          new Date(at).getHours(),
        );
        fell = visit.fellInLove;
        return visit.affinity;
      });
      setClock(at);
      if (fell) say("landmark.loved", landmark);
      return fell;
    },
    [say],
  );

  /** Where the body is at this instant, whatever it is doing. */
  const currentPoint = useCallback(
    (nowMs: number): MapPointSelection | undefined => {
      const now = latest.current;
      if (now.walk !== undefined) return walkPosition(now.walk, nowMs);
      if (now.study !== undefined) return now.study.at;
      if (now.pause !== undefined) return now.pause.at;
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

  /** Which way the body faces at this instant. */
  const currentBearing = useCallback((nowMs: number): number => {
    const now = latest.current;
    if (now.walk !== undefined) return walkStance(now.walk, nowMs).bearingDeg;
    if (now.study !== undefined) return now.study.bearingDeg;
    if (now.pause !== undefined) return now.pause.bearingDeg;
    return now.rest?.bearingDeg ?? 0;
  }, []);

  /** Open ground around the body, under R1. */
  const openAround = useCallback(
    (body: MapPointSelection) =>
      openGround({
        fog: renderer.fog,
        device: latest.current.observed,
        body,
        nearDeviceMeters: NEAR_DEVICE_OPEN_METERS,
      }),
    [renderer],
  );

  /**
   * Sends the body to `to` along the paths the map has loaded between here and
   * there, and around its buildings and water where it crosses open ground.
   * `grass` is the owner's: a tap may cross the grass the whole way; the
   * Avaia's own walks keep to the paths. A walk under way that is cut short
   * reports what of it was walked. Answers whether it set off, or what stood
   * in the way.
   */
  const goTo = useCallback(
    (
      to: MapPointSelection,
      nowMs: number,
      grass: boolean,
    ): "walking" | "nowhere" | MapObstacle["kind"] | "fog" => {
      const from = currentPoint(nowMs);
      if (from === undefined) return "nowhere";
      const bounds = routeBounds(from, to);
      const route = planWalk({
        from,
        to,
        roads: renderer.roadsWithin?.(bounds) ?? [],
        obstacles: renderer.obstaclesWithin?.(bounds) ?? [],
        chooser: grass ? "tap" : "own",
        open: openAround(from),
      });
      if (route.kind === "blocked") return route.by;
      const next = startWalk({
        from,
        to: route.path[route.path.length - 1] ?? to,
        path: route.path,
        nowMs,
        zoom: latest.current.zoom,
        maxLocomotion: route.maxLocomotion,
      });
      const under = latest.current.walk;
      if (under !== undefined) {
        const walked = walkedSoFar(under, nowMs);
        if (walked !== undefined) latest.current.onWalkCompleted?.(walked);
      }
      setStudy(undefined);
      setPause(undefined);
      lastPassing.current = "";
      // Reduced motion still goes where it was sent; it just arrives.
      setWalk(latest.current.reducedMotion ? { ...next, durationMs: 0 } : next);
      return "walking";
    },
    [currentPoint, openAround, renderer, setPause, setStudy, setWalk],
  );

  const stand = useCallback(
    (ms: number) => {
      const nowMs = globalThis.performance.now();
      const at = currentPoint(nowMs);
      if (at === undefined) return;
      const bearingDeg = currentBearing(nowMs);
      if (latest.current.walk !== undefined) setWalk(undefined);
      setRest({ point: at, bearingDeg });
      setPause({ at, bearingDeg, startedMs: nowMs, durationMs: ms });
    },
    [currentBearing, currentPoint, setPause, setRest, setWalk],
  );

  // The executor: one drive step at a time, in order, and every command it
  // answers carried out before the next step is asked.
  const stepRef = useRef<(input: AvaiaDriveInput) => void>(() => undefined);

  /**
   * What curiosity may go to, for the drive to put to a model: fresh
   * landmarks nearest first, then the dear ones it misses most. The first is
   * the drive's own pick, as before: the nearest fresh landmark, else the
   * place it longs for most.
   */
  const resolveCuriosity = useCallback((): AvaiaDriveInput => {
    const from = currentPoint(globalThis.performance.now());
    if (from === undefined) return { type: "curiosity_options", to: [] };
    const { owner: book, avaiaAddress: by } = latest.current;
    const open = openAround(from);
    const known = notebookSnapshot(book);
    const now = Date.now();
    const mine = affinitySnapshot(book, by);
    const fresh = landmarksToStudy(
      known,
      by,
      from,
      CURIOSITY_REACH_METERS,
      open,
    ).slice(0, CURIOSITY_FRESH);
    const inBook = notebookLandmarks(known);
    const dear = placesToReturnTo(
      { ...mine, places: mine.places.filter((place) => inBook.has(place.id)) },
      from,
      CURIOSITY_REACH_METERS,
      now,
      open,
    )
      .flatMap((place) => {
        const landmark = inBook.get(place.id);
        return landmark === undefined ||
          fresh.some((near) => near.landmark.id === landmark.id)
          ? []
          : [{ landmark, meters: mapDistanceMeters(from, landmark) }];
      })
      .slice(0, CURIOSITY_OPTIONS - fresh.length);
    const option = (
      { landmark, meters }: { landmark: MapLandmark; meters: number },
      longing: boolean,
    ) => ({
      ref: refs.current.landmark(landmark),
      ...(longing ? { longing } : {}),
      ...(DRIVE_KIND.test(landmark.kind) ? { kind: landmark.kind } : {}),
      meters: Math.round(meters),
      feeling: feelingFor(mine, landmark.id, now),
    });
    return {
      type: "curiosity_options",
      to: [
        ...fresh.map((near) => option(near, false)),
        ...dear.map((near) => option(near, true)),
      ],
    };
  }, [currentPoint, openAround]);

  /** Where a stroll may go, kept near where the Avaia settled. */
  const resolveStroll = useCallback(
    (command: Extract<AvaiaDriveCommand, { do: "resolve" }>) => {
      const from = currentPoint(globalThis.performance.now());
      if (from === undefined)
        return { type: "stroll_options", to: [] } as const;
      const anchor =
        (command.anchor === undefined
          ? undefined
          : refs.current.get(command.anchor)?.point) ?? from;
      const leash = command.leash_m ?? command.max_m;
      const area = boundsAround(from, leash + command.max_m);
      const open = openAround(from);
      const nodes = strollNodes({
        graph: buildWalkGraph(renderer.roadsWithin?.(area) ?? []),
        from,
        anchor,
        minM: command.min_m,
        maxM: command.max_m,
        leashM: leash,
        canEnter:
          open === undefined
            ? undefined
            : ([longitude, latitude]: LonLat) => open({ longitude, latitude }),
      });
      return {
        type: "stroll_options",
        to: nodes.map((node) => refs.current.point(node)),
      } as const;
    },
    [currentPoint, openAround, renderer],
  );

  /**
   * What an outing may go to: the walk targets within the budget, read ahead
   * from the tiles of the whole area but not one that is all fog, a few
   * nodes to wander to, and home.
   */
  const resolveOuting = useCallback(
    async (
      command: Extract<AvaiaDriveCommand, { do: "resolve" }>,
    ): Promise<AvaiaDriveInput> => {
      const empty = {
        type: "outing_options",
        targets: [],
        wander: [],
      } as const;
      const from = currentPoint(globalThis.performance.now());
      if (from === undefined) return empty;
      const budget = command.max_m;
      const area = boundsAround(from, Math.max(budget, 1));
      const open = openAround(from);
      const accept =
        open === undefined
          ? undefined
          : (tile: MapBounds) => touchesOpen(tile, open);
      await Promise.all([
        renderer.preloadRoads?.call(renderer, area, accept),
        renderer.preloadLandmarks?.call(renderer, area, accept),
      ]);
      const wall = Date.now();
      const graph = buildWalkGraph(renderer.roadsWithin?.(area) ?? []);
      const canEnter =
        open === undefined
          ? undefined
          : ([longitude, latitude]: readonly [number, number]) =>
              open({ longitude, latitude });
      const at: LonLat = [from.longitude, from.latitude];
      const mine = affinitySnapshot(
        latest.current.owner,
        latest.current.avaiaAddress,
      );
      const recent = new Set(
        mine.places
          .filter(
            (place) =>
              wall - place.lastAt < returnAfterMs(mine, place.id, REVISIT_MS),
          )
          .map((place) => place.id),
      );
      const menu = outingMenu({
        candidates:
          latest.current.outingCandidates ??
          walkTargets(
            landmarksFromArchive(
              renderer.landmarksNear?.call(renderer, from, budget) ?? [],
              renderer.areasNear?.call(renderer, from, budget) ?? [],
            ),
          ),
        graph,
        from: at,
        open: canEnter,
        budgetMeters: budget,
        exclude: recent,
        obstacles: renderer.obstaclesWithin?.(area) ?? [],
      });
      const targets = menu.options.flatMap((option) =>
        option.kind === "target"
          ? [
              outingTarget(
                refs.current.target(option.target),
                option.target,
                mine,
                wall,
                budget,
                REVISIT_MS,
              ),
            ]
          : [],
      );
      const wander = wanderNodes({
        graph,
        from,
        range: command.wander_m ?? [150, 400],
        canEnter,
      }).map((node) => refs.current.point(node));
      // Home is where this device dwelt longest, by its own journal; until
      // the journal can say, where the device was last observed.
      const home = renderer.fog?.home?.() ?? latest.current.observed;
      return {
        type: "outing_options",
        targets,
        wander,
        ...(home === undefined
          ? {}
          : {
              home: {
                ref: refs.current.point(
                  { longitude: home.longitude, latitude: home.latitude },
                  "home",
                ),
                meters: wholeMeters(from, home),
              },
            }),
      };
    },
    [currentPoint, openAround, renderer],
  );

  /**
   * Carries one command out. A walk with no way there answers what stood in
   * it instead of stepping the drive at once: the rest of the answer is
   * carried out first, without the line that would have set it off.
   */
  const carryOut = useCallback(
    (command: AvaiaDriveCommand, from: number): AvaiaDriveInput | undefined => {
      const step = (input: AvaiaDriveInput) => {
        if (era.current === from) stepRef.current(input);
      };
      switch (command.do) {
        case "walk": {
          const entry = refs.current.get(command.to);
          if (entry === undefined) return { type: "blocked" };
          const nowMs = globalThis.performance.now();
          const body = currentPoint(nowMs);
          // A landmark is looked at from in front of it, not from inside it.
          const there =
            entry.kind === "landmark" && body !== undefined
              ? approachPoint(body, entry.point)
              : entry.point;
          const went = goTo(there, nowMs, command.grass);
          if (went === "walking") return undefined;
          return went === "nowhere"
            ? { type: "blocked" }
            : { type: "blocked", by: went };
        }
        case "look":
          stand(command.ms);
          return;
        case "study": {
          const landmark = refLandmark(refs.current.get(command.at));
          const nowMs = globalThis.performance.now();
          const at = currentPoint(nowMs);
          if (landmark === undefined || at === undefined) return;
          if (latest.current.walk !== undefined) setWalk(undefined);
          setPause(undefined);
          setRest(undefined);
          setStudy({
            landmark,
            at,
            bearingDeg: mapCompassBearing(at, landmark),
            startedMs: nowMs,
          });
          return;
        }
        case "glance": {
          const entry = refs.current.get(command.at);
          stand(6_000);
          const landmark = refLandmark(entry);
          if (landmark !== undefined) say("landmark.glanced", landmark);
          return;
        }
        case "pick_up":
          // The find is the walk's: the detour that came to it reports it,
          // through the same rolls as any walk. Bending for it is this.
          stand(2_400);
          return;
        case "visited": {
          const landmark = refLandmark(refs.current.get(command.at));
          if (landmark !== undefined) feel(landmark);
          return;
        }
        case "say": {
          const kind = command.line as AvaiaLineKind;
          const landmark =
            command.about === undefined
              ? undefined
              : refLandmark(refs.current.get(command.about));
          // A line about a place says nothing when the place is gone.
          if (command.about !== undefined && landmark === undefined) return;
          say(kind, landmark);
          return;
        }
        case "resolve":
          if (command.what === "curiosity") step(resolveCuriosity());
          else if (command.what === "stroll") step(resolveStroll(command));
          else {
            void resolveOuting(command).then(step, () =>
              step({ type: "outing_options", targets: [], wander: [] }),
            );
          }
          return;
        case "choose": {
          const ask = latest.current.chooser;
          if (ask === undefined) {
            step({ type: "chosen", index: null });
            return;
          }
          let answered = false;
          const answer = (index: number | null) => {
            if (answered) return;
            answered = true;
            step({ type: "chosen", index });
          };
          const late = globalThis.setTimeout(() => answer(null), CHOOSE_MS);
          void ask(command).then(
            (index) => {
              globalThis.clearTimeout(late);
              answer(index);
            },
            () => {
              globalThis.clearTimeout(late);
              answer(null);
            },
          );
          return;
        }
        case "wake_at": {
          if (wake.current !== undefined) globalThis.clearTimeout(wake.current);
          wake.current = globalThis.setTimeout(
            () => {
              wake.current = undefined;
              step({ type: "tick" });
            },
            Math.min(MAX_TIMER_MS, Math.max(0, command.ms - Date.now())),
          );
          return;
        }
      }
    },
    [
      currentPoint,
      feel,
      goTo,
      resolveCuriosity,
      resolveOuting,
      resolveStroll,
      say,
      setPause,
      setRest,
      setStudy,
      setWalk,
      stand,
    ],
  );

  /** Carries out one answer, then tells the drive what a walk ran into. */
  const carryOutAll = useCallback(
    (commands: readonly AvaiaDriveCommand[], from: number) => {
      let blocked: AvaiaDriveInput | undefined;
      for (const command of commands) {
        if (blocked !== undefined && command.do === "say") continue;
        blocked = carryOut(command, from) ?? blocked;
      }
      if (blocked !== undefined && era.current === from) {
        stepRef.current(blocked);
      }
    },
    [carryOut],
  );

  const step = useCallback(
    (input: AvaiaDriveInput) => {
      const from = era.current;
      // With no drive to ask there is nothing to wait for: a tap is carried
      // out as it lands, as it always was.
      if (latest.current.core?.avaiaDriveStep === undefined) {
        carryOutAll(tapOnly(input), from);
        return;
      }
      queue.current = queue.current
        .then(async () => {
          if (era.current !== from) return;
          const port = latest.current.core;
          let commands: readonly AvaiaDriveCommand[];
          if (port?.avaiaDriveStep === undefined) {
            commands = tapOnly(input);
          } else {
            const wall = Date.now();
            const answer = await port
              .avaiaDriveStep(
                driveState.current,
                input,
                wall,
                new Date(wall).getHours(),
              )
              .catch(() => undefined);
            // A refused or unreadable step leaves the drive as it was.
            if (answer === undefined || !answer.ok || era.current !== from) {
              return;
            }
            driveState.current = answer.state;
            rememberWorld(latest.current.owner, { drive: answer.state });
            commands = answer.commands;
          }
          carryOutAll(commands, from);
        })
        .catch(() => undefined);
    },
    [carryOutAll],
  );
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  // A tap on the world is the owner setting a point B. Open ground goes to
  // the drive; anything else is the Avaia saying why not, in its own words.
  useEffect(() => {
    if (!active) return;
    const subscribe = renderer.subscribeGroundTap;
    if (subscribe === undefined) return;

    return subscribe.call(renderer, (tap: MapGroundTap) => {
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
          say("fog.busy");
          return;
        }
        if (taken === true) return;
      }
      const ground = tap.ground === "fog" && nearDevice ? "open" : tap.ground;
      if (ground !== "open") {
        say(blockedLineKind(ground));
        return;
      }
      step({
        type: "tap",
        to: refs.current.tap({
          longitude: tap.longitude,
          latitude: tap.latitude,
        }),
      });
    });
  }, [active, renderer, say, step]);

  // Taking the wheel settles the drive where the Avaia is, which starts its
  // clocks; leaving it ends whatever it was doing.
  useEffect(() => {
    if (!active) return;
    step({ type: "stopped" });
    return () => {
      era.current += 1;
      if (wake.current !== undefined) globalThis.clearTimeout(wake.current);
      wake.current = undefined;
    };
  }, [active, step]);

  // What its needs ask, passed on whenever it changes.
  const lifeIntent = life?.intent;
  const lifeEnergy = life === undefined ? undefined : Math.round(life.energy);
  const lifeHomeLongitude = life?.home?.longitude;
  const lifeHomeLatitude = life?.home?.latitude;
  useEffect(() => {
    if (!active || lifeIntent === undefined || lifeEnergy === undefined) {
      return;
    }
    const home =
      lifeHomeLongitude === undefined || lifeHomeLatitude === undefined
        ? undefined
        : refs.current.point(
            { longitude: lifeHomeLongitude, latitude: lifeHomeLatitude },
            "home",
          );
    step({
      type: "life",
      intent: lifeIntent,
      energy: String(Math.min(10_000, Math.max(0, lifeEnergy))),
      ...(home === undefined ? {} : { home }),
    });
  }, [
    active,
    lifeEnergy,
    lifeHomeLatitude,
    lifeHomeLongitude,
    lifeIntent,
    step,
  ]);

  // A walk ends on its own: what was walked is reported, and the drive is
  // told it arrived.
  useEffect(() => {
    if (walk === undefined) return;
    const remaining = Math.max(
      0,
      walk.startedMs + walk.durationMs - globalThis.performance.now(),
    );
    const arrived = globalThis.setTimeout(() => {
      latest.current.onWalkCompleted?.(walk);
      setWalk(undefined);
      setRest({ point: walk.to, bearingDeg: walk.arrivalBearingDeg });
      step({ type: "arrived" });
    }, remaining);
    return () => globalThis.clearTimeout(arrived);
  }, [setRest, setWalk, step, walk]);

  // What a walk passes: finds laid on it, and the sights and areas the map
  // draws ahead, told to the drive as the body comes within reach of them.
  const drives = core?.avaiaDriveStep !== undefined;
  useEffect(() => {
    if (!active || !drives || walk === undefined || walk.durationMs <= 0) {
      return;
    }
    // The finds this walk passes are the same all the way along it.
    const placedFinds = findsAlong(walk.path, Date.now());
    const look = () => {
      const nowMs = globalThis.performance.now();
      const body = walkPosition(walk, nowMs);
      const total = walk.along[walk.along.length - 1] ?? 0;
      const walked =
        total *
        Math.min(1, Math.max(0, (nowMs - walk.startedMs) / walk.durationMs));
      const ahead = wayAhead(walk.path, walk.along, walked, body);
      const { owner: book, avaiaAddress: by } = latest.current;
      const known = notebookSnapshot(book);
      const studied = new Set(
        known.studied
          .filter((entry) => entry.by === by)
          .map((entry) => entry.landmark.id),
      );
      const studyable = new Set(
        known.noticed
          .map((entry) => entry.landmark.id)
          .filter((id) => !studied.has(id)),
      );
      const things = passingThings({
        refs: refs.current,
        ahead,
        landmarks: renderer.landmarksNear?.call(renderer, body, 60) ?? [],
        areas: renderer.areasNear?.call(renderer, body, 400) ?? [],
        finds: placedFinds,
        studyable,
      });
      const key = things.map((thing) => thing.ref).join("|");
      if (things.length === 0 || key === lastPassing.current) return;
      lastPassing.current = key;
      step({ type: "passing", things });
    };
    look();
    const every = globalThis.setInterval(look, PASSING_EVERY_MS);
    return () => globalThis.clearInterval(every);
  }, [active, drives, renderer, step, walk]);

  // A stand ends on its own; the drive knows when, and ticks itself on.
  useEffect(() => {
    if (pause === undefined) return;
    const remaining = Math.max(
      0,
      pause.startedMs + pause.durationMs - globalThis.performance.now(),
    );
    const done = globalThis.setTimeout(() => setPause(undefined), remaining);
    return () => globalThis.clearTimeout(done);
  }, [pause, setPause]);

  // A walking body is heard walking, each footfall when a foot is seen to
  // land. A walk with no duration — reduced motion, which arrives without
  // walking — makes no footfall at all.
  useEffect(() => {
    if (walk === undefined || walk.durationMs <= 0) return;
    const arrives = walk.startedMs + walk.durationMs;
    let landing: ReturnType<typeof globalThis.setTimeout> | undefined;
    const nextStep = () => {
      const nowMs = globalThis.performance.now();
      const wait = nextFootfallMs(walk, nowMs, latest.current.model);
      if (nowMs + wait > arrives) return;
      landing = globalThis.setTimeout(() => {
        latest.current.onCue?.("step");
        nextStep();
      }, wait);
    };
    nextStep();
    return () => globalThis.clearTimeout(landing);
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
      // Going back to a place already studied is a visit, not a lesson: it
      // pays nothing and says nothing, unless that is when it is loved.
      const before = notebookSnapshot(book).studied.some(
        (entry) => entry.landmark.id === study.landmark.id && entry.by === by,
      );
      updateNotebook(book, (current) =>
        studyLandmark(current, study.landmark, by, Date.now()),
      );
      // A return pays no experience again.
      if (!before) {
        latest.current.onAward?.({
          kind: "landmark_studied",
          earner: "avaia",
          subject: study.landmark.id,
          at: Date.now(),
        });
      }
      setStudy(undefined);
      setRest({ point: study.at, bearingDeg: study.bearingDeg });
      if (!feel(study.landmark) && !before) {
        say("landmark.studied", study.landmark);
      }
    }, remaining);
    return () => globalThis.clearTimeout(done);
  }, [feel, say, setRest, setStudy, study]);

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

  // A travel revision is an explicit one-off admin teleport. It overrides
  // this device's older local walk once; future movement remains Avaia's own.
  const arrivalRevision = travelArrival?.revision;
  const arrivalLongitude = travelArrival?.coordinate.longitude;
  const arrivalLatitude = travelArrival?.coordinate.latitude;
  useEffect(() => {
    if (
      arrivalRevision === undefined ||
      arrivalLongitude === undefined ||
      arrivalLatitude === undefined ||
      readWorldMemory(owner).travelRevision === arrivalRevision
    ) {
      return;
    }
    const point = { longitude: arrivalLongitude, latitude: arrivalLatitude };
    era.current += 1;
    if (wake.current !== undefined) globalThis.clearTimeout(wake.current);
    wake.current = undefined;
    setWalk(undefined);
    setStudy(undefined);
    setPause(undefined);
    setRest({ point, bearingDeg: 0 });
    rememberWorld(owner, {
      avaia: { ...point, bearingDeg: 0 },
      travelRevision: arrivalRevision,
    });
  }, [
    owner,
    arrivalRevision,
    arrivalLongitude,
    arrivalLatitude,
    setWalk,
    setStudy,
    setPause,
    setRest,
  ]);

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

  const stance = useCallback(
    (nowMs: number): BodyStance | undefined => {
      if (walk !== undefined)
        return walkStance(walk, nowMs, latest.current.model);
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

  const stop = useCallback(() => {
    const nowMs = globalThis.performance.now();
    const point = currentPoint(nowMs);
    const bearingDeg = currentBearing(nowMs);
    const under = latest.current.walk;
    if (under !== undefined) {
      const walked = walkedSoFar(under, nowMs);
      if (walked !== undefined) latest.current.onWalkCompleted?.(walked);
    }
    era.current += 1;
    if (wake.current !== undefined) globalThis.clearTimeout(wake.current);
    wake.current = undefined;
    setWalk(undefined);
    setStudy(undefined);
    setPause(undefined);
    setRest(point === undefined ? undefined : { point, bearingDeg });
    setSpeech(undefined);
    lastLine.current = undefined;
    return point;
  }, [currentBearing, currentPoint, setPause, setRest, setStudy, setWalk]);

  const walkTo = useCallback(
    (point: MapPointSelection): boolean => {
      if (currentPoint(globalThis.performance.now()) === undefined) {
        return false;
      }
      step({ type: "tap", to: refs.current.tap(point) });
      return true;
    },
    [currentPoint, step],
  );

  const moving =
    walk !== undefined || study !== undefined || pause !== undefined;
  const fond = useMemo(() => favourites(affinity, clock), [affinity, clock]);
  // A favourite left alone long enough fades out of the list while the page
  // is open, not only on the next reload.
  useEffect(() => {
    const due = nextFavouriteChange(affinity, clock);
    if (due === undefined) return;
    const fades = globalThis.setTimeout(
      () => setClock(Date.now()),
      Math.min(MAX_TIMER_MS, Math.max(0, due + 1 - Date.now())),
    );
    return () => globalThis.clearTimeout(fades);
  }, [affinity, clock]);
  // One object per change that matters, so the world redraws a body when the
  // Avaia does something and not whenever the surface around it re-renders.
  return useMemo(
    () => ({
      stance,
      moving,
      speech,
      notebook,
      favourites: fond,
      stop,
      walkTo,
      announce: say,
    }),
    [fond, moving, notebook, stop, say, speech, stance, walkTo],
  );
}

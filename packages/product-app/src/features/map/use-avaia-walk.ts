// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapCompassBearing,
  mapDistanceMeters,
  type AvatarModelId,
  type MapGroundTap,
  type MapLandmark,
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
  pickAvaiaLine,
  type AvaiaLineKind,
} from "./avaia-lines";
import {
  approachPoint,
  startWalk,
  studyStance,
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
  type LandmarkNotebook,
} from "./landmark-notebook";

/** How long a line stays on the card before it closes again. */
export const SPEECH_MS = 10_000;

/** How long an Avaia that just took the wheel looks around before it goes. */
export const FIRST_LOOK_MS = 1_500;

/** How long an Avaia stands idle before curiosity moves it again. */
export const IDLE_CURIOSITY_MS = 15_000;

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
  /** This device's own observation, and how sure it is. */
  readonly observed:
    (MapPointSelection & { readonly accuracyMeters: number }) | undefined;
  /** The study the Avaia is drawn in, whose voice it speaks with. */
  readonly model: AvatarModelId | undefined;
  readonly locale: ProductLocale;
  /** The Avaia's own address: whose notes a study goes under. */
  readonly avaiaAddress: string;
  /** The Bond that owns the Avaia: whose notebook this is. */
  readonly owner: string;
  readonly zoom: number;
  readonly reducedMotion: boolean;
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
}: AvaiaWalkInput): AvaiaWalkState {
  const [walk, setWalk] = useState<AvaiaWalk | undefined>(undefined);
  const [study, setStudy] = useState<AvaiaStudy | undefined>(undefined);
  const [rest, setRest] = useState<Rest | undefined>(undefined);
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

  const goTo = useCallback(
    (to: MapPointSelection, nowMs: number, landmark?: MapLandmark): boolean => {
      const from = currentPoint(nowMs);
      if (from === undefined) return false;
      const next = startWalk({
        from,
        to,
        nowMs,
        zoom: latest.current.zoom,
        landmark,
      });
      setStudy(undefined);
      setActed(true);
      // Reduced motion still goes where it was sent; it just arrives.
      setWalk(latest.current.reducedMotion ? { ...next, durationMs: 0 } : next);
      return true;
    },
    [currentPoint],
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
      const ground = tap.ground === "fog" && nearDevice ? "open" : tap.ground;
      if (ground !== "open") {
        setActed(true);
        say(blockedLineKind(ground));
        return;
      }
      if (goTo({ longitude: tap.longitude, latitude: tap.latitude }, nowMs)) {
        say("walk");
      }
    });
  }, [active, goTo, renderer, say]);

  // A walk ends on its own. Arriving at a landmark turns into looking at it;
  // arriving anywhere else is simply standing there.
  useEffect(() => {
    if (walk === undefined) return;
    const remaining = Math.max(
      0,
      walk.startedMs + walk.durationMs - globalThis.performance.now(),
    );
    const arrived = globalThis.setTimeout(() => {
      const nowMs = globalThis.performance.now();
      setWalk(undefined);
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
      setRest({ point: walk.to, bearingDeg: walk.bearingDeg });
    }, remaining);
    return () => globalThis.clearTimeout(arrived);
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
      setStudy(undefined);
      setRest({ point: study.at, bearingDeg: study.bearingDeg });
      say("landmark.studied", study.landmark);
    }, remaining);
    return () => globalThis.clearTimeout(done);
  }, [say, study]);

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
      updateNotebook(owner, (current) =>
        noticeLandmarks(current, found, Date.now()),
      );
    }

    notice();
    return renderer.subscribeLandmarksChanged?.call(renderer, notice);
  }, [observedAccuracy, observedLatitude, observedLongitude, owner, renderer]);

  // Curiosity: an idle Avaia at the wheel goes to see the nearest thing its
  // owner walked past and it has not studied. It looks around first when it
  // has just arrived, and waits longer once it has been doing things.
  const idle = active && walk === undefined && study === undefined;
  useEffect(() => {
    if (!idle) return;
    const wander = globalThis.setTimeout(
      () => {
        const nowMs = globalThis.performance.now();
        const from = currentPoint(nowMs);
        if (from === undefined) return;
        const { owner: book, avaiaAddress: by } = latest.current;
        const landmark = nextLandmarkToStudy(notebookSnapshot(book), by, from);
        if (landmark === undefined) return;
        if (goTo(approachPoint(from, landmark), nowMs, landmark)) {
          say("landmark.spotted", landmark);
        }
      },
      acted ? IDLE_CURIOSITY_MS : FIRST_LOOK_MS,
    );
    return () => globalThis.clearTimeout(wander);
  }, [acted, currentPoint, goTo, idle, notebook, say]);

  const stance = useCallback(
    (nowMs: number): BodyStance | undefined => {
      if (walk !== undefined) return walkStance(walk, nowMs);
      if (study !== undefined) return studyStance(study, nowMs);
      return rest;
    },
    [rest, study, walk],
  );

  const reset = useCallback(() => {
    setWalk(undefined);
    setStudy(undefined);
    setRest(undefined);
    setSpeech(undefined);
    setActed(false);
    lastLine.current = undefined;
  }, []);

  const moving = walk !== undefined || study !== undefined;
  // One object per change that matters, so the world redraws a body when the
  // Avaia does something and not whenever the surface around it re-renders.
  return useMemo(
    () => ({ stance, moving, speech, notebook, reset }),
    [moving, notebook, reset, speech, stance],
  );
}

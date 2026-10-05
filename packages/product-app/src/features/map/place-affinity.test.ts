// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  AFFINITY_LIMIT,
  emptyAffinity,
  enjoyment,
  favourites,
  feelingFor,
  FOND_AT,
  FOND_RETURN_MS,
  FONDNESS_HALF_LIFE_MS,
  fondnessAt,
  LINGER_MS,
  lingerMs,
  LONGING_RAMP_MS,
  longing,
  LOVE_VISITS,
  LOVED_FLOOR,
  LOVED_RETURN_MS,
  nextFavouriteChange,
  outingAppeal,
  placeActivity,
  placeFamily,
  placeToReturnTo,
  readAffinity,
  recordVisit,
  returnAfterMs,
  tasteFor,
  temperament,
  writeAffinity,
  type AffinityStorage,
  type PlaceAffinity,
  type VisitedPlace,
} from "./place-affinity";

const AVAIA = "xdashaai";
const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const NOON = 13;

const place = (id: string, kind = "park"): VisitedPlace => ({
  id,
  kind,
  name: id,
  longitude: 30.52,
  latitude: 50.45,
});

/** The first of a hundred parks this Avaia enjoys at least `atLeast`, or at most `atMost`. */
function parkWhere(test: (felt: number) => boolean, kind = "park"): string {
  const affinity = emptyAffinity(AVAIA);
  for (let index = 0; index < 100; index++) {
    const id = `park:${index}`;
    if (test(enjoyment(affinity, { id, kind }, NOON))) return id;
  }
  throw new Error("no such park in a hundred");
}

/** Visits `id` once a day, `times` times, from `start`. */
function visitDaily(
  affinity: PlaceAffinity,
  visited: VisitedPlace,
  times: number,
  start = T0,
) {
  let current = affinity;
  const loves: number[] = [];
  for (let day = 0; day < times; day++) {
    const visit = recordVisit(current, visited, start + day * DAY, NOON);
    current = visit.affinity;
    if (visit.fellInLove) loves.push(day);
  }
  return { affinity: current, loves };
}

describe("temperament", () => {
  it("is the address's own: the same every time, different for another", () => {
    expect(temperament(AVAIA)).toEqual(temperament(AVAIA));
    expect(temperament(AVAIA)).not.toEqual(temperament("xskyai"));
    for (const value of Object.values(temperament(AVAIA))) {
      expect(value).toBeGreaterThanOrEqual(0.3);
      expect(value).toBeLessThanOrEqual(0.9);
    }
  });

  it("places kinds in families and says what is done there", () => {
    expect(placeFamily("lake")).toBe("nature");
    expect(placeActivity("park")).toBe("rest");
    expect(placeActivity("viewpoint")).toBe("gaze");
    expect(placeActivity("monument")).toBe("study");
    expect(placeFamily("something_new")).toBe("art");
  });
});

describe("falling for a place", () => {
  it("loves a place it enjoys only after coming back to it", () => {
    const id = parkWhere((felt) => felt >= 0.8);
    const { affinity, loves } = visitDaily(emptyAffinity(AVAIA), place(id), 6);

    expect(loves).toHaveLength(1);
    expect(loves[0]).toBeGreaterThanOrEqual(LOVE_VISITS - 1);
    expect(feelingFor(affinity, id, T0 + 6 * DAY)).toBe("loved");
    expect(favourites(affinity, T0 + 6 * DAY)[0]?.id).toBe(id);
  });

  it("never loves a place it is lukewarm about, however often it goes", () => {
    const id = parkWhere((felt) => felt <= 0.55, "museum");
    const { affinity, loves } = visitDaily(
      emptyAffinity(AVAIA),
      place(id, "museum"),
      12,
    );

    expect(loves).toEqual([]);
    expect(feelingFor(affinity, id, T0 + 12 * DAY)).not.toBe("loved");
  });

  it("knows a place it has never been to as new", () => {
    expect(feelingFor(emptyAffinity(AVAIA), "park:x", T0)).toBe("new");
  });

  it("builds a taste for a family of places from how its visits went", () => {
    const id = parkWhere((felt) => felt >= 0.8);
    const { affinity } = visitDaily(emptyAffinity(AVAIA), place(id), 4);
    expect(tasteFor(affinity, "nature")).toBeGreaterThan(0.5);
    expect(tasteFor(affinity, "history")).toBe(0.5);
  });

  it("feels the same about the same visits, wherever they are replayed", () => {
    const id = parkWhere((felt) => felt >= 0.7);
    expect(visitDaily(emptyAffinity(AVAIA), place(id), 5)).toEqual(
      visitDaily(emptyAffinity(AVAIA), place(id), 5),
    );
  });
});

describe("absence", () => {
  it("halves fondness over the half-life, but love never below its floor", () => {
    const liked = parkWhere((felt) => felt >= 0.6 && felt < 0.7);
    const { affinity: once } = visitDaily(
      emptyAffinity(AVAIA),
      place(liked),
      1,
    );
    const fond = once.places[0]!;
    expect(fondnessAt(fond, T0 + FONDNESS_HALF_LIFE_MS)).toBeCloseTo(
      fond.fondness / 2,
    );

    const id = parkWhere((felt) => felt >= 0.8);
    const { affinity } = visitDaily(emptyAffinity(AVAIA), place(id), 6);
    const loved = affinity.places.find((entry) => entry.id === id)!;
    expect(fondnessAt(loved, loved.lastAt + 10 * FONDNESS_HALF_LIFE_MS)).toBe(
      LOVED_FLOOR,
    );
  });

  it("longs for a dear place more the longer it is away", () => {
    const id = parkWhere((felt) => felt >= 0.8);
    const { affinity } = visitDaily(emptyAffinity(AVAIA), place(id), 6);
    const loved = affinity.places[0]!;
    expect(longing(loved, loved.lastAt)).toBe(0);
    expect(longing(loved, loved.lastAt + LONGING_RAMP_MS / 2)).toBeLessThan(
      longing(loved, loved.lastAt + LONGING_RAMP_MS),
    );
  });
});

describe("going back", () => {
  const id = parkWhere((felt) => felt >= 0.8);
  const { affinity } = visitDaily(emptyAffinity(AVAIA), place(id), 6);
  const lastAt = affinity.places[0]!.lastAt;
  const here = { longitude: 30.52, latitude: 50.45 };

  it("goes back to a loved place once it has been missed long enough", () => {
    expect(placeToReturnTo(affinity, here, 3_000, lastAt + DAY / 2)).toBe(
      undefined,
    );
    expect(placeToReturnTo(affinity, here, 3_000, lastAt + 2 * DAY)?.id).toBe(
      id,
    );
  });

  it("does not go back past its reach or into the fog", () => {
    const far = { longitude: 31.52, latitude: 50.45 };
    expect(placeToReturnTo(affinity, far, 3_000, lastAt + 2 * DAY)).toBe(
      undefined,
    );
    expect(
      placeToReturnTo(affinity, here, 3_000, lastAt + 2 * DAY, () => false),
    ).toBe(undefined);
  });

  it("never goes back on its own to a place it does not care for", () => {
    const meh = parkWhere((felt) => felt <= 0.5, "museum");
    const { affinity: once } = visitDaily(
      emptyAffinity(AVAIA),
      place(meh, "museum"),
      1,
    );
    expect(placeToReturnTo(once, here, 3_000, T0 + 30 * DAY)).toBe(undefined);
  });

  it("may return to a loved place after a day, a favourite after three", () => {
    expect(returnAfterMs(affinity, id, 7 * DAY)).toBe(LOVED_RETURN_MS);
    expect(returnAfterMs(affinity, "park:unknown", 7 * DAY)).toBe(7 * DAY);
    expect(FOND_RETURN_MS).toBeLessThan(7 * DAY);
  });

  it("lingers longer where it is fond, and rests longer than it studies", () => {
    expect(lingerMs(emptyAffinity(AVAIA), { id: "p", kind: "park" }, T0)).toBe(
      LINGER_MS.rest,
    );
    expect(LINGER_MS.rest).toBeGreaterThan(LINGER_MS.study);
    expect(lingerMs(affinity, { id, kind: "park" }, lastAt)).toBeGreaterThan(
      LINGER_MS.rest * 1.5,
    );
  });

  it("wants a missed loved place more than a nearer new one", () => {
    const now = lastAt + 3 * DAY;
    const loved = outingAppeal(
      affinity,
      { id, kind: "park", meters: 2_000 },
      now,
      3_000,
    );
    const fresh = outingAppeal(
      affinity,
      { id: "park:new", kind: "park", meters: 300 },
      now,
      3_000,
    );
    expect(loved).toBeGreaterThan(fresh);
  });
});

describe("on its own", () => {
  const here = { longitude: 30.52, latitude: 50.45 };

  /**
   * Lets the Avaia go back by itself for `days`, checking every six hours,
   * after one first visit: the curiosity loop, with nobody forcing a visit.
   */
  function liveOn(visited: VisitedPlace, days: number) {
    let affinity = recordVisit(
      emptyAffinity(AVAIA),
      visited,
      T0,
      NOON,
    ).affinity;
    const visits = [T0];
    let lovedAt: number | undefined;
    for (let at = T0; at <= T0 + days * DAY; at += DAY / 4) {
      if (placeToReturnTo(affinity, here, 3_000, at)?.id !== visited.id)
        continue;
      const visit = recordVisit(affinity, visited, at, NOON);
      affinity = visit.affinity;
      visits.push(at);
      if (visit.fellInLove) lovedAt = at;
    }
    return { affinity, visits, lovedAt };
  }

  it("wants to come back after one visit it enjoyed, not after a dull one", () => {
    const liked = parkWhere((felt) => felt >= 0.75);
    const once = recordVisit(emptyAffinity(AVAIA), place(liked), T0, NOON);
    expect(feelingFor(once.affinity, liked, T0)).toBe("fond");
    expect(
      placeToReturnTo(once.affinity, here, 3_000, T0 + FOND_RETURN_MS)?.id,
    ).toBe(liked);

    const dull = parkWhere((felt) => felt <= 0.6, "museum");
    const meh = recordVisit(
      emptyAffinity(AVAIA),
      place(dull, "museum"),
      T0,
      NOON,
    );
    expect(feelingFor(meh.affinity, dull, T0)).toBe("known");
  });

  /**
   * The threshold case: a first impression just over the favourite line has
   * faded under it by the time its three-day wait is over. It is still the
   * favourite that visit made it, so it is still gone back to.
   */
  it("goes back to a favourite by a hair once its wait is over", () => {
    const id = parkWhere((felt) => felt >= 0.67 && felt < 0.7);
    const once = recordVisit(emptyAffinity(AVAIA), place(id), T0, NOON);
    const after = T0 + FOND_RETURN_MS;
    expect(once.place.fondness).toBeGreaterThanOrEqual(FOND_AT);
    expect(fondnessAt(once.place, after)).toBeLessThan(FOND_AT);

    expect(returnAfterMs(once.affinity, id, 7 * DAY)).toBe(FOND_RETURN_MS);
    expect(placeToReturnTo(once.affinity, here, 3_000, after)?.id).toBe(id);
    expect(liveOn(place(id), 7).visits.length).toBeGreaterThan(1);
  });

  it("falls in love through its own returns alone", () => {
    const id = parkWhere((felt) => felt >= 0.8);
    const { affinity, visits, lovedAt } = liveOn(place(id), 30);

    expect(lovedAt).toBeDefined();
    expect(visits.indexOf(lovedAt!) + 1).toBeGreaterThanOrEqual(LOVE_VISITS);
    expect(feelingFor(affinity, id, T0 + 30 * DAY)).toBe("loved");
    for (let index = 1; index < visits.length; index++) {
      expect(visits[index]! - visits[index - 1]!).toBeGreaterThanOrEqual(
        LOVED_RETURN_MS,
      );
    }
  });

  it("never goes back to, or falls for, a place it found dull", () => {
    const id = parkWhere((felt) => felt <= 0.6, "museum");
    const { visits, lovedAt } = liveOn(place(id, "museum"), 60);
    expect(visits).toEqual([T0]);
    expect(lovedAt).toBeUndefined();
  });
});

describe("the favourites over time", () => {
  it("lets a favourite fade out when its time comes, and never a loved place", () => {
    const liked = parkWhere((felt) => felt >= 0.7 && felt < 0.75);
    const id = parkWhere((felt) => felt >= 0.8);
    let { affinity } = visitDaily(emptyAffinity(AVAIA), place(id), 6);
    affinity = recordVisit(affinity, place(liked), T0 + 6 * DAY, NOON).affinity;
    const now = T0 + 6 * DAY;

    const due = nextFavouriteChange(affinity, now);
    expect(due).toBeDefined();
    expect(favourites(affinity, due! - 1).map((entry) => entry.id)).toContain(
      liked,
    );
    expect(favourites(affinity, due! + 1).map((entry) => entry.id)).toEqual([
      id,
    ]);
    expect(nextFavouriteChange(affinity, due! + 1)).toBeUndefined();
  });
});

describe("memory", () => {
  it("keeps loved places when it forgets past the limit", () => {
    const id = parkWhere((felt) => felt >= 0.8);
    let { affinity } = visitDaily(emptyAffinity(AVAIA), place(id), 6);
    for (let index = 0; index < AFFINITY_LIMIT + 10; index++) {
      affinity = recordVisit(
        affinity,
        place(`statue:${index}`, "statue"),
        T0 + 7 * DAY + index,
        NOON,
      ).affinity;
    }
    expect(affinity.places).toHaveLength(AFFINITY_LIMIT);
    expect(affinity.places.some((entry) => entry.id === id)).toBe(true);
  });

  function memoryStorage(): AffinityStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
  }

  it("reads back what it wrote, for this Avaia only", () => {
    const storage = memoryStorage();
    const id = parkWhere((felt) => felt >= 0.8);
    const { affinity } = visitDaily(emptyAffinity(AVAIA), place(id), 6);
    writeAffinity("xdasha", affinity, storage);

    expect(readAffinity("xdasha", AVAIA, storage)).toEqual(affinity);
    expect(readAffinity("xdasha", "xskyai", storage)).toEqual(
      emptyAffinity("xskyai"),
    );
  });

  it("reads nonsense as nothing, and drops the entries it cannot trust", () => {
    const storage = memoryStorage();
    storage.setItem("nilx-one.avaia.affinity.v1.xdasha", "{not json");
    expect(readAffinity("xdasha", AVAIA, storage)).toEqual(
      emptyAffinity(AVAIA),
    );

    storage.setItem(
      "nilx-one.avaia.affinity.v1.xdasha",
      JSON.stringify({
        by: AVAIA,
        places: [
          { id: "ok", kind: "park", longitude: 1, latitude: 2, fondness: 3 },
          {
            id: "ok",
            kind: "park",
            longitude: 1,
            latitude: 2,
            fondness: 3,
            visits: 1,
            firstAt: T0,
            lastAt: T0,
          },
        ],
        taste: { nature: 7, nowhere: 1 },
      }),
    );
    const read = readAffinity("xdasha", AVAIA, storage);
    expect(read.places).toHaveLength(1);
    expect(read.places[0]?.fondness).toBe(1);
    expect(read.taste).toEqual({ nature: 1 });
  });
});

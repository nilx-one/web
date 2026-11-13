// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** A point on screen, in CSS pixels. */
export type Point = readonly [x: number, y: number];

/** A drawn box's corners on screen: top left, top right, bottom right, bottom left. */
export type Quad = readonly [Point, Point, Point, Point];

/** A CSS 4×4 matrix, column-major, in the order `matrix3d()` lists it. */
export type CssMatrix = readonly number[];

export const IDENTITY: CssMatrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

export function multiply(a: CssMatrix, b: CssMatrix): CssMatrix {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row]! * b[column * 4 + k]!;
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function translation(x: number, y: number, z = 0): CssMatrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function scaling(x: number, y: number, z = 1): CssMatrix {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

function numbers(value: string): number[] {
  return value
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map((part) => Number.parseFloat(part));
}

/** A computed `transform`: `none`, `matrix(…)` or `matrix3d(…)`. */
export function parseCssTransform(value: string): CssMatrix {
  const match = /^(matrix3d|matrix)\(([^)]*)\)$/.exec(value.trim());
  if (match === null) return IDENTITY;
  const values = numbers(match[2]!);
  if (values.some((entry) => !Number.isFinite(entry))) return IDENTITY;
  if (match[1] === "matrix3d") return values.length === 16 ? values : IDENTITY;
  if (values.length !== 6) return IDENTITY;
  const [a, b, c, d, e, f] = values as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
}

/** A computed `translate`: `none` or up to three pixel lengths. */
export function parseCssTranslate(value: string): CssMatrix {
  const values = value.trim() === "none" ? [] : numbers(value);
  const [x = 0, y = 0, z = 0] = values.map((entry) =>
    Number.isFinite(entry) ? entry : 0,
  );
  return translation(x, y, z);
}

/** A computed `scale`: `none`, one factor for both axes, or one per axis. */
export function parseCssScale(value: string): CssMatrix {
  const values = value.trim() === "none" ? [] : numbers(value);
  const finite = values.map((entry) => (Number.isFinite(entry) ? entry : 1));
  const x = finite[0] ?? 1;
  return scaling(x, finite[1] ?? x, finite[2] ?? 1);
}

/** A computed `transform-origin`, in pixels. */
export function parseCssOrigin(value: string): Point {
  const [x = 0, y = 0] = numbers(value).map((entry) =>
    Number.isFinite(entry) ? entry : 0,
  );
  return [x, y];
}

/**
 * The matrix a box is drawn with, as CSS composes it: the individual
 * `translate` and `scale` first, then `transform`, all about the origin.
 */
export function composeBoxMatrix(style: {
  readonly transformOrigin: string;
  readonly translate: string;
  readonly scale: string;
  readonly transform: string;
}): CssMatrix {
  const [ox, oy] = parseCssOrigin(style.transformOrigin);
  return [
    translation(ox, oy),
    parseCssTranslate(style.translate),
    parseCssScale(style.scale),
    parseCssTransform(style.transform),
    translation(-ox, -oy),
  ].reduce(multiply);
}

export function transformPoint(matrix: CssMatrix, x: number, y: number): Point {
  const m = matrix;
  const w = m[3]! * x + m[7]! * y + m[15]!;
  const scale = Math.abs(w) < 1e-6 ? 1 : 1 / w;
  return [
    (m[0]! * x + m[4]! * y + m[12]!) * scale,
    (m[1]! * x + m[5]! * y + m[13]!) * scale,
  ];
}

/**
 * Where a box is drawn on screen. Layout gives its untransformed size, the
 * bounding rectangle where its transformed corners landed, and `matrix` how
 * it was transformed; the corners follow from the three. Anything an
 * ancestor adds is read as a shift, which is all an ancestor here does.
 */
export function boxQuad(
  bounds: { readonly left: number; readonly top: number },
  width: number,
  height: number,
  matrix: CssMatrix,
): Quad {
  const corners: Quad = [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, width, 0),
    transformPoint(matrix, width, height),
    transformPoint(matrix, 0, height),
  ];
  const minX = Math.min(...corners.map(([x]) => x));
  const minY = Math.min(...corners.map(([, y]) => y));
  const dx = bounds.left - minX;
  const dy = bounds.top - minY;
  return corners.map(([x, y]) => [x + dx, y + dy] as const) as unknown as Quad;
}

/** The point at (u, v) of a quad, extrapolated outside [0, 1]. */
export function quadPoint(quad: Quad, u: number, v: number): Point {
  const [tl, tr, br, bl] = quad;
  const top: Point = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
  const bottom: Point = [
    bl[0] + (br[0] - bl[0]) * u,
    bl[1] + (br[1] - bl[1]) * u,
  ];
  return [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v];
}

/**
 * The neighbours of every node of a `columns × rows` lattice, four per node
 * (left, right, up, down), `-1` where the lattice ends. `first` is the index
 * of the lattice's first node in a larger network.
 */
export function latticeNeighbours(
  columns: number,
  rows: number,
  first = 0,
): Int32Array {
  const out = new Int32Array(columns * rows * 4);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const node = row * columns + column;
      out[node * 4] = column > 0 ? first + node - 1 : -1;
      out[node * 4 + 1] = column < columns - 1 ? first + node + 1 : -1;
      out[node * 4 + 2] = row > 0 ? first + node - columns : -1;
      out[node * 4 + 3] = row < rows - 1 ? first + node + columns : -1;
    }
  }
  return out;
}

/** The neighbours of a chain of `count` nodes: previous and next only. */
export function chainNeighbours(count: number, first = 0): Int32Array {
  const out = new Int32Array(count * 4).fill(-1);
  for (let node = 0; node < count; node += 1) {
    if (node > 0) out[node * 4] = first + node - 1;
    if (node < count - 1) out[node * 4 + 1] = first + node + 1;
  }
  return out;
}

/** The triangles of a `columns × rows` lattice, two per cell. */
export function latticeTriangles(
  columns: number,
  rows: number,
  first = 0,
): Uint32Array {
  const out = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let at = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = first + row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      out.set([a, b, c, b, d, c], at);
      at += 6;
    }
  }
  return out;
}

/** A cubic Bézier through four points, at `t`. */
export function bezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/**
 * The two ribbons' rest curves around a pair of cards: one sweeps under both
 * cards, the other over them, each from the left card to the right one.
 */
export function ribbonCurves(
  left: Quad,
  right: Quad,
): readonly [
  readonly [Point, Point, Point, Point],
  readonly [Point, Point, Point, Point],
] {
  const leftHeight = left[3][1] - left[0][1];
  const rightHeight = right[3][1] - right[0][1];
  const leftWidth = left[1][0] - left[0][0];
  const rightWidth = right[1][0] - right[0][0];
  const under = [
    quadPoint(left, -0.04, 0.62),
    [left[3][0] + leftWidth * 0.18, left[3][1] + leftHeight * 0.42],
    [right[2][0] - rightWidth * 0.55, right[2][1] + rightHeight * 0.34],
    quadPoint(right, 1.05, 0.46),
  ] as const;
  const over = [
    quadPoint(left, -0.02, 0.3),
    [left[0][0] + leftWidth * 0.3, left[0][1] - leftHeight * 0.36],
    [right[1][0] - rightWidth * 0.42, right[1][1] - rightHeight * 0.3],
    quadPoint(right, 1.04, 0.16),
  ] as const;
  return [under, over];
}

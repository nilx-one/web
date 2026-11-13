// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  boxQuad,
  chainNeighbours,
  composeBoxMatrix,
  latticeNeighbours,
  latticeTriangles,
  parseCssScale,
  parseCssTransform,
  parseCssTranslate,
  quadPoint,
  ribbonCurves,
  transformPoint,
  type Quad,
} from "./geometry";

const still = {
  transformOrigin: "0px 0px",
  translate: "none",
  scale: "none",
  transform: "none",
};

describe("CSS matrices", () => {
  it("reads matrix() and matrix3d() in CSS order", () => {
    expect(
      transformPoint(parseCssTransform("matrix(1, 0, 0, 1, 12, -4)"), 3, 5),
    ).toEqual([15, 1]);
    const lifted = parseCssTransform(
      "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 9, 0, 1)",
    );
    expect(transformPoint(lifted, 0, 0)).toEqual([7, 9]);
  });

  it("treats none and anything malformed as no transform", () => {
    expect(transformPoint(parseCssTransform("none"), 4, 6)).toEqual([4, 6]);
    expect(transformPoint(parseCssTransform("matrix(1, 2)"), 4, 6)).toEqual([
      4, 6,
    ]);
    expect(transformPoint(parseCssTranslate("none"), 4, 6)).toEqual([4, 6]);
    expect(transformPoint(parseCssScale("none"), 4, 6)).toEqual([4, 6]);
  });

  it("reads one scale factor for both axes", () => {
    expect(transformPoint(parseCssScale("2"), 3, 4)).toEqual([6, 8]);
    expect(transformPoint(parseCssScale("2 0.5"), 3, 4)).toEqual([6, 2]);
  });

  it("divides by w, so a perspective tilt narrows the far edge", () => {
    const tilted = composeBoxMatrix({
      ...still,
      transformOrigin: "100px 200px",
      transform:
        "matrix3d(1, 0, 0, 0, 0, 0.99, 0.14, -0.0001, 0, -0.14, 0.99, 0, 0, 0, 0, 1)",
    });
    const [topLeft] = [transformPoint(tilted, 0, 0)];
    const bottomLeft = transformPoint(tilted, 0, 200);
    expect(bottomLeft[0]).toBeCloseTo(0, 6);
    expect(topLeft[0]).toBeGreaterThan(0);
  });
});

describe("boxQuad", () => {
  it("is the layout box when nothing is transformed", () => {
    expect(
      boxQuad({ left: 10, top: 20 }, 100, 50, composeBoxMatrix(still)),
    ).toEqual([
      [10, 20],
      [110, 20],
      [110, 70],
      [10, 70],
    ]);
  });

  it("recovers the corners of a skewed box from its bounding rectangle", () => {
    // skewX(10deg) about the bottom edge: the top slides right by h·tan(10°).
    const shear = Math.tan((10 * Math.PI) / 180);
    const matrix = composeBoxMatrix({
      ...still,
      transformOrigin: "50px 50px",
      transform: `matrix(1, 0, ${-shear}, 1, 0, 0)`,
    });
    const quad = boxQuad({ left: 10, top: 20 }, 100, 50, matrix);
    expect(quad[3][0]).toBeCloseTo(10, 6);
    expect(quad[0][0]).toBeCloseTo(10 + 50 * shear, 6);
    expect(quad[2][1]).toBeCloseTo(70, 6);
  });

  it("composes translate and scale before transform", () => {
    const matrix = composeBoxMatrix({
      transformOrigin: "0px 0px",
      translate: "5px 0px",
      scale: "2",
      transform: "matrix(1, 0, 0, 1, 3, 0)",
    });
    // translate(5) · scale(2) · translate(3): x → 5 + 2·(x + 3).
    expect(transformPoint(matrix, 1, 0)).toEqual([13, 0]);
  });
});

describe("lattices and ribbons", () => {
  const square: Quad = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it("extrapolates quad points outside the box for the shadow margin", () => {
    expect(quadPoint(square, 0.5, 0.5)).toEqual([5, 5]);
    expect(quadPoint(square, -0.2, 1.2)).toEqual([-2, 12]);
  });

  it("joins each lattice node to its four neighbours within the lattice", () => {
    const near = latticeNeighbours(3, 2, 100);
    expect([...near.subarray(0, 4)]).toEqual([-1, 101, -1, 103]);
    expect([...near.subarray(4 * 4, 5 * 4)]).toEqual([103, 105, 101, -1]);
  });

  it("joins a chain only end to end", () => {
    const near = chainNeighbours(3, 7);
    expect([...near]).toEqual([-1, 8, -1, -1, 7, 9, -1, -1, 8, -1, -1, -1]);
  });

  it("covers a lattice with two triangles a cell", () => {
    expect([...latticeTriangles(2, 2, 4)]).toEqual([4, 5, 6, 5, 7, 6]);
  });

  it("runs one ribbon under the cards and one over them, left to right", () => {
    const left: Quad = [
      [0, 100],
      [200, 100],
      [200, 300],
      [0, 300],
    ];
    const right: Quad = [
      [260, 100],
      [460, 100],
      [460, 300],
      [260, 300],
    ];
    const [under, over] = ribbonCurves(left, right);
    expect(under[0][0]).toBeLessThan(under[3][0]);
    expect(under[1][1]).toBeGreaterThan(300);
    expect(over[1][1]).toBeLessThan(100);
  });
});

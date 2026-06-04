import { describe, expect, it } from "vitest";
import {
  instanceLocalTransform,
  instanceOpacity,
  instanceTransform,
  maxAbsScale,
  paintOrder,
  seamHalves,
  subsetIndices,
} from "./repeatMath";
import type { Box, RepeatParams } from "../types";

const base: RepeatParams = {
  count: 8,
  angleOffset: 0,
  radiusOffset: 100,
  sourceRotation: 0,
  sourceScale: 1,
  orientationMode: "rotateWithCircle",
  scaleStep: 0,
  opacityStep: 0,
  paintOffset: 0,
  tuck: false,
  seamBlend: 2,
};

describe("instanceTransform", () => {
  it("places copies on evenly-spaced spokes (count 8 => 45deg step)", () => {
    expect(instanceTransform(base, 0)).toBe(
      "rotate(0) translate(100,0) rotate(0) scale(1)"
    );
    expect(instanceTransform(base, 1)).toBe(
      "rotate(45) translate(100,0) rotate(0) scale(1)"
    );
    expect(instanceTransform(base, 2)).toBe(
      "rotate(90) translate(100,0) rotate(0) scale(1)"
    );
  });

  it("rotateWithCircle: local orientation is constant (faces outward)", () => {
    const p = { ...base, sourceRotation: 10 };
    expect(instanceTransform(p, 3)).toContain("rotate(135) translate(100,0) rotate(10)");
  });

  it("keepUpright: cancels the spoke angle so screen orientation is constant", () => {
    const p: RepeatParams = { ...base, orientationMode: "keepUpright", sourceRotation: 0 };
    // copy i: placement rotate(45*i), local rotate(-45*i) -> net upright
    expect(instanceTransform(p, 1)).toBe(
      "rotate(45) translate(100,0) rotate(-45) scale(1)"
    );
    expect(instanceTransform(p, 2)).toBe(
      "rotate(90) translate(100,0) rotate(-90) scale(1)"
    );
  });

  it("scaleStep applies progressively and may be negative", () => {
    const p = { ...base, scaleStep: 0.5 };
    expect(instanceTransform(p, 2)).toContain("scale(2)");
    const n = { ...base, scaleStep: -0.25 };
    // i=1: scale = 1 + 1*(-0.25) = 0.75
    expect(instanceTransform(n, 1)).toContain("scale(0.75)");
  });

  it("radiusOffset 0 stacks all copies at the center", () => {
    const p = { ...base, radiusOffset: 0 };
    for (const i of [0, 3, 7]) {
      expect(instanceTransform(p, i)).toContain("translate(0,0)");
    }
  });
});

describe("instanceOpacity", () => {
  it("steps and clamps to [0,1]", () => {
    expect(instanceOpacity(base, 5)).toBe(1);
    expect(instanceOpacity({ ...base, opacityStep: -0.2 }, 2)).toBeCloseTo(0.6);
    expect(instanceOpacity({ ...base, opacityStep: -0.5 }, 10)).toBe(0);
    expect(instanceOpacity({ ...base, opacityStep: 0.5 }, 10)).toBe(1);
  });
});

describe("paintOrder (seam relocation)", () => {
  it("is the identity order at offset 0", () => {
    expect(paintOrder(8, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("rotates the z-order without changing geometry", () => {
    expect(paintOrder(8, 3)).toEqual([3, 4, 5, 6, 7, 0, 1, 2]);
  });
  it("wraps negative and out-of-range offsets", () => {
    expect(paintOrder(8, -1)).toEqual([7, 0, 1, 2, 3, 4, 5, 6]);
    expect(paintOrder(8, 10)).toEqual([2, 3, 4, 5, 6, 7, 0, 1]);
  });
});

describe("maxAbsScale", () => {
  it("is 1 with no scale step", () => {
    expect(maxAbsScale(base)).toBe(1);
  });
  it("finds the largest magnitude across copies", () => {
    expect(maxAbsScale({ ...base, count: 4, scaleStep: 0.5 })).toBe(2.5); // 1+3*0.5
    expect(maxAbsScale({ ...base, count: 4, scaleStep: -1 })).toBe(2); // |1-3|
  });
  it("folds in the uniform sourceScale", () => {
    expect(maxAbsScale({ ...base, sourceScale: 1.5 })).toBe(1.5);
    expect(maxAbsScale({ ...base, count: 4, scaleStep: 0.5, sourceScale: 2 })).toBe(5); // 2.5*2
  });
});

describe("sourceScale", () => {
  it("scales every copy uniformly in its local transform", () => {
    expect(instanceLocalTransform({ ...base, sourceScale: 2 }, 0)).toContain("scale(2)");
  });
});

const leaf: Box = { x: 0, y: 0, width: 120, height: 80 };

describe("seamHalves (two complementary half-disks; no depth)", () => {
  it("returns two closed sector clips at the local origin", () => {
    const h = seamHalves({ ...base, count: 24 }, leaf);
    for (const d of [h.oppHalfD, h.seamHalfD]) {
      expect(d.startsWith("M 0,0 L")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
    }
  });

  it("paints each half in a full paint order, rotated ~N/2 apart", () => {
    const h = seamHalves({ ...base, count: 24, paintOffset: 0 }, leaf);
    // every copy appears once in each half (complementary clips do the masking)
    expect([...h.oppOrder].sort((a, b) => a - b)).toEqual([...Array(24).keys()]);
    expect([...h.seamOrder].sort((a, b) => a - b)).toEqual([...Array(24).keys()]);
    // the seam half starts ~half a turn away from the opposite half
    expect(h.oppOrder[0]).toBe(0);
    expect(h.seamOrder[0]).toBe(12);
  });

  it("the opposite half's order has its seam where the seam half is clipped (and vice versa)", () => {
    // opp order = paintOrder(F); seam order = paintOrder(F + N/2). Their first
    // entries (and thus their discontinuities) are ~180° apart.
    const h = seamHalves({ ...base, count: 8, paintOffset: 2 }, leaf);
    expect(h.oppOrder[0]).toBe(2);
    expect(h.seamOrder[0]).toBe((2 + 4) % 8);
  });
});

describe("subsetIndices", () => {
  it("returns all indices when count <= cap", () => {
    expect(subsetIndices(5, 24)).toEqual([0, 1, 2, 3, 4]);
  });
  it("returns an evenly-spaced, deduped subset capped at `cap`", () => {
    const s = subsetIndices(128, 24);
    expect(s.length).toBeLessThanOrEqual(24);
    expect(s[0]).toBe(0);
    // strictly increasing
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    // every index in range
    expect(Math.max(...s)).toBeLessThan(128);
  });
});

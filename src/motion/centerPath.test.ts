import { describe, expect, it } from "vitest";
import { centerPathCss, motionLocalPoints, smoothPathD } from "./centerPath";
import type { CenterPathAnimation, Layer, Motif, RepeatParams } from "../types";

const params: RepeatParams = {
  count: 6,
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
const motif: Motif = {
  innerHtml: "<rect width='10' height='10'/>",
  anchorX: 5,
  anchorY: 5,
  box: { x: 0, y: 0, width: 10, height: 10 },
  weight: 1,
  simplified: false,
};
const anim = (over: Partial<CenterPathAnimation> = {}): CenterPathAnimation => ({
  enabled: true,
  type: "centerPath",
  path: { points: [{ x: 100, y: 0 }, { x: 150, y: 0 }], closed: false },
  durationSeconds: 4,
  delaySeconds: 0,
  easing: "linear",
  direction: "out-and-back",
  orientationMode: "fixed",
  closed: false,
  ...over,
});
const layer = (a: CenterPathAnimation, scale = 1): Layer => ({
  id: "L1", name: "L", visible: true, locked: false, motif, params,
  center: { x: 0, y: 0 }, scale, components: {}, animation: a, createdAt: 0, updatedAt: 0,
});

describe("smoothPathD", () => {
  it("makes a straight line for two points", () => {
    expect(smoothPathD([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe("M 0 0 L 10 5");
  });
  it("uses cubic Béziers through 3+ points and closes with Z", () => {
    const d = smoothPathD([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], true);
    expect(d.startsWith("M 0 0 C")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("motionLocalPoints", () => {
  it("is relative to the first point and divided by layer scale", () => {
    // points (100,0)->(150,0), angleOffset 0, scale 2 => local [(0,0),(25,0)]
    expect(motionLocalPoints(params, 2, anim())).toEqual([{ x: 0, y: 0 }, { x: 25, y: 0 }]);
  });
  it("un-rotates by the spoke angle so copy 0 sits in its local frame", () => {
    // angleOffset 90: the outward (+x) world delta becomes -y in local space
    const pts = motionLocalPoints({ ...params, angleOffset: 90 }, 1, anim())!;
    expect(pts[1].x).toBeCloseTo(0, 6);
    expect(pts[1].y).toBeCloseTo(-50, 6);
  });
});

describe("centerPathCss", () => {
  it("translates through the path; 0% is rest (translate 0,0) so adding a path never shifts", () => {
    const css = centerPathCss(layer(anim()), true);
    expect(css).toContain("@keyframes motion-L1-keyframes");
    expect(css).toContain("0% { transform: translate(0px, 0px); }");
    expect(css).toContain("100% { transform: translate(50px, 0px); }");
    expect(css).toContain("animation-play-state: running");
    expect(css).not.toContain("offset-path");
  });
  it("follow-path adds tangent rotation keyframes on the follow-wrapper", () => {
    const css = centerPathCss(layer(anim({ orientationMode: "followPath" })), true);
    expect(css).toContain(".instance-follow-wrapper");
    expect(css).toContain("@keyframes motion-L1-rotate");
  });
  it("emits nothing when disabled", () => {
    expect(centerPathCss(layer(anim({ enabled: false })), true)).toBe("");
  });
});

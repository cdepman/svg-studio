import { describe, expect, it } from "vitest";
import { buildExportSvg } from "./exportSvg";
import { createLayer } from "../document/layers";
import type { Layer, Motif, RepeatParams } from "../types";

const motif: Motif = {
  innerHtml: "<rect width='10' height='10'/>",
  anchorX: 5,
  anchorY: 5,
  box: { x: 0, y: 0, width: 10, height: 10 },
  weight: 1,
  simplified: false,
};

const params: RepeatParams = {
  count: 4,
  angleOffset: 0,
  radiusOffset: 50,
  sourceRotation: 0,
  orientationMode: "rotateWithCircle",
  mirrorAlternates: false,
  scaleStep: 0,
  opacityStep: 0,
  paintOffset: 0,
  tuck: false,
  seamBlend: 2,
};

const mk = (over: Partial<Layer>) => ({
  ...createLayer({ name: "L", motif, params, center: { x: 0, y: 0 } }),
  ...over,
});

describe("buildExportSvg (PRD §14)", () => {
  it("omits hidden layers and keeps locked visible layers", () => {
    const a = mk({ id: "a", visible: true, locked: false });
    const b = mk({ id: "b", visible: false }); // hidden
    const c = mk({ id: "c", visible: true, locked: true }); // locked but visible
    const svg = buildExportSvg([a, b, c]);
    expect(svg).toContain('data-layer-id="a"');
    expect(svg).not.toContain('data-layer-id="b"');
    expect(svg).toContain('data-layer-id="c"');
  });

  it("emits layers back-to-front (array order)", () => {
    const a = mk({ id: "back" });
    const b = mk({ id: "front" });
    const svg = buildExportSvg([a, b]);
    expect(svg.indexOf('data-layer-id="back"')).toBeLessThan(
      svg.indexOf('data-layer-id="front"')
    );
  });

  it("gives each layer an independent motif def and resolves all copies", () => {
    const a = mk({ id: "a" });
    const svg = buildExportSvg([a]);
    expect(svg).toContain('id="motif-a"');
    expect((svg.match(/<use /g) ?? []).length).toBe(4); // count 4, no tuck
  });

  it("returns an empty (but valid) svg when nothing is visible", () => {
    const a = mk({ id: "a", visible: false });
    const svg = buildExportSvg([a]);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<use");
  });
});

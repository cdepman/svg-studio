import { describe, expect, it } from "vitest";
import {
  buildAnimatedExportSvg,
  buildExportSvg,
  buildExportSvgFromRenderedLayers,
  ensureSvgFilename,
} from "./exportSvg";
import { createLayer } from "../document/layers";
import { createCenterPathAnimation } from "../motion/centerPath";
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

  it("normalizes the document canvas to a positive origin for thumbnail renderers", () => {
    const a = mk({ id: "a", center: { x: -100, y: -50 } });
    const svg = buildExportSvg([a]);
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg).toContain('<g transform="translate(');
  });

  it("returns an empty (but valid) svg when nothing is visible", () => {
    const a = mk({ id: "a", visible: false });
    const svg = buildExportSvg([a]);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<use");
  });

  it("can snapshot the currently rendered layer transforms from the canvas", () => {
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const root = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const repeatRoot = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");

    root.classList.add("layers-root");
    layer.classList.add("layer");
    layer.setAttribute("data-layer-id", "a");
    repeatRoot.classList.add("repeat-root");
    repeatRoot.setAttribute("transform", "translate(25,30)");
    use.setAttribute("href", "#motif-a");

    repeatRoot.appendChild(use);
    layer.appendChild(repeatRoot);
    root.appendChild(layer);
    svgEl.appendChild(root);
    Object.defineProperty(root, "getBBox", {
      value: () => ({ x: -10, y: 20, width: 100, height: 80 }),
    });

    const svg = buildExportSvgFromRenderedLayers(root);
    expect(svg).toContain('viewBox="0 0 116 96"');
    expect(svg).toContain('<g transform="translate(18,-12)">');
    expect(svg).toContain('data-layer-id="a"');
    expect(svg).toContain('transform="translate(25,30)"');
  });

  it("forces downloaded filenames to keep an .svg extension", () => {
    expect(ensureSvgFilename("radial-repeat-004")).toBe("radial-repeat-004.svg");
    expect(ensureSvgFilename("radial-repeat-004.SVG")).toBe("radial-repeat-004.SVG");
    expect(ensureSvgFilename("  ")).toBe("radial-repeat.svg");
  });

  it("animated export includes CSS motion path while static export does not", () => {
    const a = mk({ id: "a", center: { x: 10, y: 20 } });
    a.animation = createCenterPathAnimation(a, { x: 110, y: 70 });

    expect(buildExportSvg([a])).not.toContain("--motion-dx");
    const svg = buildAnimatedExportSvg([a]);
    expect(svg).toContain("translate(var(--motion-dx), var(--motion-dy))");
    expect(svg).toContain("@keyframes motion-a-keyframes");
    expect(svg).toContain("--motion-dx:50px");
    expect(svg).toContain("--motion-dy:50px");
    expect((svg.match(/class="instance-motion-wrapper motion-wrapper motion-a"/g) ?? []).length).toBe(4);
    expect(svg).not.toContain('clip-path="url(#seam-');
  });

  it("animated export keeps tucked seam ordering without clipping the motion", () => {
    const a = mk({ id: "a", params: { ...params, tuck: true, seamBlend: 2 } });
    a.animation = createCenterPathAnimation(a, { x: 110, y: 70 });

    const svg = buildAnimatedExportSvg([a]);
    expect(svg).not.toContain('clip-path="url(#seam-');
    expect(svg).toContain('class="alt"');
    expect((svg.match(/class="instance-motion-wrapper motion-wrapper motion-a"/g) ?? []).length).toBe(6);
  });
});

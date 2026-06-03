import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Canvas } from "./Canvas";
import { useScene } from "./useScene";
import { importSvgFromText } from "../motif/importSvg";
import { DEFAULT_MOTIF_SVG } from "../defaultMotif";
import type { RepeatParams } from "../types";

const motif = importSvgFromText(DEFAULT_MOTIF_SVG);

const params: RepeatParams = {
  count: 8,
  angleOffset: 0,
  radiusOffset: 120,
  sourceRotation: 0,
  orientationMode: "rotateWithCircle",
  mirrorAlternates: false,
  scaleStep: 0,
  opacityStep: 0,
  paintOffset: 0,
  tuck: false,
  seamBlend: 2,
};

// useScene is a hook, so drive Canvas through a tiny host component.
function Host({ p }: { p: RepeatParams }) {
  const scene = useScene();
  return (
    <Canvas
      motif={motif}
      params={p}
      center={{ x: 0, y: 0 }}
      viewport={{ tx: 0, ty: 0, s: 1 }}
      dragging={false}
      scene={scene}
      onCenterPointerDown={() => {}}
      onWheel={() => {}}
      panBy={() => {}}
    />
  );
}

describe("Canvas seam tuck", () => {
  it("emits no clip path and exactly `count` instances when tuck is off", () => {
    const html = renderToString(<Host p={params} />);
    expect(html).not.toContain("clipPath");
    expect((html.match(/class="instance"/g) ?? []).length).toBe(8);
  });

  it("emits the seam-wedge clip and k extra redrawn copies when tuck is on", () => {
    const html = renderToString(<Host p={{ ...params, tuck: true, seamBlend: 3 }} />);
    expect(html).toContain('clipPath id="seam-wedge"');
    expect(html).toContain('clip-path="url(#seam-wedge)"');
    // 8 main copies + 3 redrawn = 11
    expect((html.match(/class="instance"/g) ?? []).length).toBe(11);
  });

  it("relocating the seam (paintOffset) reorders the painted copies", () => {
    const html = renderToString(<Host p={{ ...params, paintOffset: 3 }} />);
    // first painted <use> should now carry data-i="3"
    const firstUse = html.indexOf("<use");
    const slice = html.slice(firstUse, firstUse + 80);
    expect(slice).toContain('data-i="3"');
  });
});

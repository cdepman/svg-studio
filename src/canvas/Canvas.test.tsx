import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Canvas, type SelectionBox } from "./Canvas";
import { useScene } from "./useScene";
import { boundsReach } from "./repeatMath";
import { importSvgFromText } from "../motif/importSvg";
import { DEFAULT_MOTIF_SVG } from "../defaultMotif";
import { createLayer } from "../document/layers";
import type { Center, Layer, RepeatParams } from "../types";

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

function layer(overrides: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ name: "L", motif: importSvgFromText(DEFAULT_MOTIF_SVG), params, center: { x: 0, y: 0 } }),
    ...overrides,
  };
}

// Mirror App's derivation of the editable-selected set -> boxes/handle.
function derive(layers: Layer[], selected: Set<string>) {
  const editable = layers.filter((l) => selected.has(l.id) && l.visible && !l.locked);
  const boxes: SelectionBox[] = editable.map((l) => ({ id: l.id, center: l.center, reach: boundsReach(l.params, l.motif.box) }));
  const handlePos: Center | null = editable.length
    ? {
        x: editable.reduce((a, l) => a + l.center.x, 0) / editable.length,
        y: editable.reduce((a, l) => a + l.center.y, 0) / editable.length,
      }
    : null;
  return { boxes, handlePos };
}

function Host({ layers, selected }: { layers: Layer[]; selected: Set<string> }) {
  const scene = useScene();
  const { boxes, handlePos } = derive(layers, selected);
  return (
    <Canvas
      layers={layers}
      selectedIds={selected}
      boxes={boxes}
      handlePos={handlePos}
      viewport={{ tx: 0, ty: 0, s: 1 }}
      dragging={false}
      scene={scene}
      onSelect={() => {}}
      onMarqueeSelect={() => {}}
      onCenterPointerDown={() => {}}
      onWheel={() => {}}
      panBy={() => {}}
    />
  );
}

describe("Canvas layer stack + selection", () => {
  it("renders only visible layers, back-to-front", () => {
    const a = layer({ id: "a" });
    const b = layer({ id: "b", visible: false });
    const html = renderToString(<Host layers={[a, b]} selected={new Set(["a"])} />);
    expect(html).toContain('data-layer-id="a"');
    expect(html).not.toContain('data-layer-id="b"');
  });

  it("draws a selection box + handle for a selected, editable layer", () => {
    const a = layer({ id: "a" });
    const html = renderToString(<Host layers={[a]} selected={new Set(["a"])} />);
    expect(html).toContain('data-sel-for="a"');
    expect(html).toContain("center-handle");
  });

  it("draws no box/handle for a selected locked layer (art still shows)", () => {
    const a = layer({ id: "a", locked: true });
    const html = renderToString(<Host layers={[a]} selected={new Set(["a"])} />);
    expect(html).toContain('data-layer-id="a"'); // artwork rendered
    expect(html).not.toContain('data-sel-for="a"'); // not editable -> no box
    expect(html).not.toContain("center-handle");
  });

  it("draws a box for every selected layer when all are selected (synchronized)", () => {
    const a = layer({ id: "a", center: { x: -50, y: 0 } });
    const b = layer({ id: "b", center: { x: 50, y: 0 } });
    const html = renderToString(<Host layers={[a, b]} selected={new Set(["a", "b"])} />);
    expect(html).toContain('data-sel-for="a"');
    expect(html).toContain('data-sel-for="b"');
    // one combined handle at the centroid (x = 0)
    expect((html.match(/center-handle/g) ?? []).length).toBe(1);
    expect(html).toContain("translate(0,0)");
  });
});

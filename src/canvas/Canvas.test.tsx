import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Canvas } from "./Canvas";
import { useScene } from "./useScene";
import { unionBounds } from "./selectionBounds";
import { importSvgFromText } from "../motif/importSvg";
import { DEFAULT_MOTIF_SVG } from "../defaultMotif";
import { createLayer } from "../document/layers";
import type { Layer, RepeatParams } from "../types";

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

function Host({ layers, selected }: { layers: Layer[]; selected: Set<string> }) {
  const scene = useScene();
  const editable = layers.filter((l) => selected.has(l.id) && l.visible && !l.locked);
  const gizmo = unionBounds(editable);
  return (
    <Canvas
      layers={layers}
      selectedIds={selected}
      gizmo={gizmo}
      motionCss=""
      motionPath={null}
      drawingMotionPath={false}
      animationsMoving={false}
      tool="select"
      pencil={{ size: 18, smoothing: 55, fillColor: "#7c93ff" }}
      onDrawCommit={() => {}}
      viewport={{ tx: 0, ty: 0, s: 1 }}
      dragging={false}
      scene={scene}
      onLayerPointerDown={() => {}}
      onMarqueeSelect={() => {}}
      onMotionPathCommit={() => {}}
      onResizePointerDown={() => {}}
      onDuplicateSelected={() => {}}
      onGroupSelection={() => {}}
      onUngroupSelection={() => {}}
      canGroupSelection={selected.size >= 2}
      canUngroupSelection={false}
      onWheel={() => {}}
      panBy={() => {}}
    />
  );
}

describe("Canvas layer stack + selection gizmo", () => {
  it("renders only visible layers, back-to-front", () => {
    const a = layer({ id: "a" });
    const b = layer({ id: "b", visible: false });
    const html = renderToString(<Host layers={[a, b]} selected={new Set(["a"])} />);
    expect(html).toContain('data-layer-id="a"');
    expect(html).not.toContain('data-layer-id="b"');
  });

  it("draws the gizmo (frame + handles + action menu) for an editable selection", () => {
    const a = layer({ id: "a" });
    const html = renderToString(<Host layers={[a]} selected={new Set(["a"])} />);
    expect(html).toContain("gizmo-frame");
    expect((html.match(/gizmo-handle/g) ?? []).length).toBe(4);
    expect(html).toContain("gizmo-action-menu");
  });

  it("draws no gizmo for a selected locked layer (art still shows)", () => {
    const a = layer({ id: "a", locked: true });
    const html = renderToString(<Host layers={[a]} selected={new Set(["a"])} />);
    expect(html).toContain('data-layer-id="a"');
    expect(html).not.toContain("gizmo-frame");
  });

  it("the gizmo wraps the union of all selected layers", () => {
    const a = layer({ id: "a", center: { x: -50, y: 0 } });
    const b = layer({ id: "b", center: { x: 50, y: 0 } });
    const html = renderToString(<Host layers={[a, b]} selected={new Set(["a", "b"])} />);
    // union center is at x=0; a single gizmo wraps both layers.
    expect((html.match(/class="gizmo"/g) ?? []).length).toBe(1);
  });
});

// On-canvas editing of a motif's sub-parts. Parts live inside a shared <g> def
// instanced via <use>, whose shadow content isn't hit-testable — so this draws a
// thin interactive overlay on the representative copy (copy 0): one hit-rect per
// part. Click selects; drag moves; the knob rotates. Edits affect the shared
// motif, so every copy updates. During a drag we mutate the def's part group AND
// the overlay imperatively (zero React renders), committing once on pointerup.
import { useRef } from "react";
import { instanceTransform } from "./repeatMath";
import { partTransformAttr } from "../motif/parts";
import type { Scene } from "./useScene";
import type { Center, Layer, MotifPart, PartTransform } from "../types";

interface PartEditLayerProps {
  layer: Layer;
  selectedPartId: string | null;
  /** Which copy the overlay is drawn on (edits still sync to all copies). */
  index: number;
  scene: Scene;
  /** 1 / viewport scale, for screen-constant handle sizing. */
  inv: number;
  onSelectPart: (partId: string) => void;
  onCommitTransform: (partId: string, t: PartTransform) => void;
  setDragging: (d: boolean) => void;
}

export function PartEditLayer({ layer, selectedPartId, index, scene, inv, onSelectPart, onCommitTransform, setDragging }: PartEditLayerProps) {
  const partSpaceRef = useRef<SVGGElement>(null);
  const drag = useRef<{
    part: MotifPart;
    mode: "move" | "rotate";
    start: Center;
    startT: PartTransform;
    startAngle: number;
    latest: PartTransform;
  } | null>(null);

  const parts = (layer.motif.parts ?? []).filter((p) => p.visible);

  // Map a screen point into the part-parent coordinate space (where tx/ty live).
  const toLocal = (clientX: number, clientY: number): Center => {
    const g = partSpaceRef.current;
    const svg = scene.svgRef.current;
    if (!g || !svg) return { x: 0, y: 0 };
    const ctm = g.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  // Live, imperative transform paint: the overlay group + the def's part group.
  const paint = (part: MotifPart, t: PartTransform) => {
    const attr = partTransformAttr(t, part.cx, part.cy) ?? "";
    const overlay = partSpaceRef.current?.querySelector(`[data-part-overlay="${part.id}"]`);
    overlay?.setAttribute("transform", attr);
    const def = scene.layersRootRef.current?.querySelector(`[data-part-render="${part.id}"]`);
    def?.setAttribute("transform", attr);
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const cur = toLocal(e.clientX, e.clientY);
    if (d.mode === "move") {
      d.latest = { ...d.startT, tx: d.startT.tx + (cur.x - d.start.x), ty: d.startT.ty + (cur.y - d.start.y) };
    } else {
      const ang = (Math.atan2(cur.y - d.part.cy, cur.x - d.part.cx) * 180) / Math.PI;
      d.latest = { ...d.startT, rotation: d.startT.rotation + (ang - d.startAngle) };
    }
    paint(d.part, d.latest);
  };

  const onUp = () => {
    const d = drag.current;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    drag.current = null;
    setDragging(false);
    if (d) onCommitTransform(d.part.id, d.latest);
  };

  const begin = (e: React.PointerEvent, part: MotifPart, mode: "move" | "rotate") => {
    e.preventDefault();
    e.stopPropagation();
    if (part.id !== selectedPartId) onSelectPart(part.id);
    const start = toLocal(e.clientX, e.clientY);
    drag.current = {
      part,
      mode,
      start,
      startT: part.transform,
      startAngle: (Math.atan2(start.y - part.cy, start.x - part.cx) * 180) / Math.PI,
      latest: part.transform,
    };
    setDragging(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <g className="part-edit-overlay" transform={`translate(${layer.center.x},${layer.center.y})`}>
      <g transform={`scale(${layer.scale})`}>
        <g transform={instanceTransform(layer.params, index)}>
          <g ref={partSpaceRef} transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}>
            {parts.map((part) => {
              const sel = part.id === selectedPartId;
              const knobY = part.cy - part.h / 2 - (Math.max(part.w, part.h) * 0.25 + 14 * inv);
              return (
                <g key={part.id} data-part-overlay={part.id} transform={partTransformAttr(part.transform, part.cx, part.cy) ?? undefined}>
                  <rect
                    className={`part-hit${sel ? " selected" : ""}`}
                    x={part.cx - part.w / 2}
                    y={part.cy - part.h / 2}
                    width={part.w}
                    height={part.h}
                    onPointerDown={(e) => begin(e, part, "move")}
                  />
                  {sel && (
                    <g className="part-rotate" onPointerDown={(e) => begin(e, part, "rotate")}>
                      <line className="part-rotate-line" x1={part.cx} y1={part.cy - part.h / 2} x2={part.cx} y2={knobY} />
                      <circle className="part-rotate-knob" cx={part.cx} cy={knobY} r={6 * inv} />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </g>
    </g>
  );
}

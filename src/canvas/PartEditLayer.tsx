// On-canvas editing of a motif's sub-parts. Parts live inside a shared <g> def
// instanced via <use>, whose shadow content isn't hit-testable — so this draws a
// thin interactive overlay on the representative copy: one hit-rect per part.
// Click selects; drag moves; corner handles resize; the knob rotates; Alt-drag
// duplicates. Edits affect the shared motif, so every copy updates. During a drag
// we mutate the def's part group AND the overlay imperatively (zero React
// renders), committing once on pointerup.
import { useCallback, useRef } from "react";
import { instanceTransform } from "./repeatMath";
import { GIZMO_HANDLE, ROTATE_GAP } from "../config";
import { partTransformAttr } from "../motif/parts";
import { recolorMarkup } from "../motif/recolor";
import type { Scene } from "./useScene";
import type { Center, Layer, MotifPart, PartTransform } from "../types";

const CORNERS = ["tl", "tr", "bl", "br"] as const;
const CORNER_CURSOR: Record<string, string> = { tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize" };

type Mode = "move" | "rotate" | "resize";

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
  /** Alt-drag: copy the part with the gesture's transform applied. */
  onDuplicatePart: (partId: string, t: PartTransform) => void;
  setDragging: (d: boolean) => void;
}

export function PartEditLayer(props: PartEditLayerProps) {
  const { layer, selectedPartId, index, inv } = props;
  // Stable callbacks read via a ref so the window listeners never go stale across
  // the re-render that selecting a part triggers mid-gesture.
  const optsRef = useRef(props);
  optsRef.current = props;
  const partSpaceRef = useRef<SVGGElement>(null);
  // A live "ghost" of the part shown while Alt-dragging (the copy-to-be), so the
  // original stays put and the copy follows the cursor immediately.
  const ghostRef = useRef<SVGGElement>(null);
  const drag = useRef<{
    part: MotifPart;
    mode: Mode;
    alt: boolean;
    start: Center;
    pivot: Center;
    startT: PartTransform;
    startAngle: number;
    startDist: number;
    latest: PartTransform;
  } | null>(null);

  const parts = (layer.motif.parts ?? []).filter((p) => p.visible);

  // Map a screen point into the part-parent coordinate space (where tx/ty live).
  const toLocal = useCallback((clientX: number, clientY: number): Center => {
    const g = partSpaceRef.current;
    const svg = optsRef.current.scene.svgRef.current;
    if (!g || !svg) return { x: 0, y: 0 };
    const ctm = g.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  // Live, imperative transform paint: the overlay group + the def's part group.
  // Use the same identity fallback as the render so React stays authoritative.
  const paint = useCallback((part: MotifPart, t: PartTransform) => {
    const attr = partTransformAttr(t, part.cx, part.cy) ?? "translate(0 0)";
    partSpaceRef.current?.querySelector(`[data-part-overlay="${part.id}"]`)?.setAttribute("transform", attr);
    optsRef.current.scene.layersRootRef.current?.querySelector(`[data-part-render="${part.id}"]`)?.setAttribute("transform", attr);
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const cur = toLocal(e.clientX, e.clientY);
    if (d.mode === "move") {
      d.latest = { ...d.startT, tx: d.startT.tx + (cur.x - d.start.x), ty: d.startT.ty + (cur.y - d.start.y) };
    } else if (d.mode === "rotate") {
      const ang = (Math.atan2(cur.y - d.pivot.y, cur.x - d.pivot.x) * 180) / Math.PI;
      d.latest = { ...d.startT, rotation: d.startT.rotation + (ang - d.startAngle) };
    } else {
      const cd = Math.hypot(cur.x - d.pivot.x, cur.y - d.pivot.y);
      const ratio = d.startDist > 1e-6 ? cd / d.startDist : 1;
      d.latest = { ...d.startT, scale: Math.max(0.05, d.startT.scale * ratio) };
    }
    // Alt-drag: move the ghost copy and leave the original alone. Otherwise move
    // the part itself live.
    if (d.alt) ghostRef.current?.setAttribute("transform", partTransformAttr(d.latest, d.part.cx, d.part.cy) ?? "translate(0 0)");
    else paint(d.part, d.latest);
  }, [toLocal, paint]);

  const onUp = useCallback(() => {
    const d = drag.current;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    drag.current = null;
    optsRef.current.setDragging(false);
    const ghost = ghostRef.current;
    if (ghost) { ghost.style.display = "none"; ghost.innerHTML = ""; }
    if (!d) return;
    if (d.alt) optsRef.current.onDuplicatePart(d.part.id, d.latest);
    else optsRef.current.onCommitTransform(d.part.id, d.latest);
  }, [onMove, paint]);

  const begin = (e: React.PointerEvent, part: MotifPart, mode: Mode) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (part.id !== optsRef.current.selectedPartId) optsRef.current.onSelectPart(part.id);
    const start = toLocal(e.clientX, e.clientY);
    // The part's visual center in part-parent space (rotation/scale pivot).
    const pivot = { x: part.cx + part.transform.tx, y: part.cy + part.transform.ty };
    const alt = e.altKey;
    drag.current = {
      part,
      mode,
      alt,
      start,
      pivot,
      startT: part.transform,
      startAngle: (Math.atan2(start.y - pivot.y, start.x - pivot.x) * 180) / Math.PI,
      startDist: Math.hypot(start.x - pivot.x, start.y - pivot.y),
      latest: part.transform,
    };
    // Alt: paint a live ghost of the copy from the start (original stays put).
    if (alt && ghostRef.current) {
      ghostRef.current.innerHTML = part.fill ? recolorMarkup(part.baseMarkup, part.fill) : part.baseMarkup;
      ghostRef.current.setAttribute("transform", partTransformAttr(part.transform, part.cx, part.cy) ?? "translate(0 0)");
      ghostRef.current.style.display = "";
    }
    optsRef.current.setDragging(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // World-size of this copy's artwork (before each part's own scale), so handles
  // and the rotate gap stay screen-constant — same trick as the component gizmo.
  const p = layer.params;
  const instScale = layer.scale * p.sourceScale * (1 + index * p.scaleStep);

  return (
    <g className="part-edit-overlay" transform={`translate(${layer.center.x},${layer.center.y})`}>
      <g transform={`scale(${layer.scale})`}>
        <g transform={instanceTransform(layer.params, index)}>
          <g ref={partSpaceRef} transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}>
            {/* Live ghost of the copy during an Alt-drag (populated imperatively). */}
            <g ref={ghostRef} className="part-ghost" style={{ display: "none" }} />
            {parts.map((part) => {
              const sel = part.id === selectedPartId;
              const x0 = part.cx - part.w / 2;
              const y0 = part.cy - part.h / 2;
              // Divide by the full chain scale (instance × this part's scale) so
              // handles/gap are a constant size on screen, regardless of zoom.
              const eff = Math.max(1e-3, Math.abs(instScale * part.transform.scale));
              const hs = (GIZMO_HANDLE * inv) / eff;
              const gap = (ROTATE_GAP * inv) / eff;
              return (
                <g key={part.id} data-part-overlay={part.id} transform={partTransformAttr(part.transform, part.cx, part.cy) ?? "translate(0 0)"}>
                  {/* Invisible hit-area — click to select; drag to move. No visible
                      outline so the canvas stays clean (Illustrator-style). */}
                  <rect
                    className="part-hit"
                    x={x0}
                    y={y0}
                    width={part.w}
                    height={part.h}
                    onPointerDown={(e) => begin(e, part, "move")}
                  />
                  {sel && (
                    <>
                      {/* One clean gizmo on the selected part, matching the
                          composite/component selection box. */}
                      <rect className="part-frame" x={x0} y={y0} width={part.w} height={part.h} />
                      {CORNERS.map((c) => {
                        const cxh = c.includes("r") ? x0 + part.w : x0;
                        const cyh = c.includes("b") ? y0 + part.h : y0;
                        return (
                          <rect
                            key={c}
                            className="part-handle"
                            x={cxh - hs / 2}
                            y={cyh - hs / 2}
                            width={hs}
                            height={hs}
                            style={{ cursor: CORNER_CURSOR[c] }}
                            onPointerDown={(e) => begin(e, part, "resize")}
                          />
                        );
                      })}
                      <g className="part-rotate" onPointerDown={(e) => begin(e, part, "rotate")}>
                        <line className="part-rotate-line" x1={part.cx} y1={y0} x2={part.cx} y2={y0 - gap} />
                        <circle className="part-rotate-knob" cx={part.cx} cy={y0 - gap} r={hs * 0.6} />
                      </g>
                    </>
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

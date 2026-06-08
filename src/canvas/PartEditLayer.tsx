// On-canvas editing of a motif's sub-parts. The real motif is instanced via
// <use>, whose cloned content is inconsistent for hit testing, so this draws an
// interactive overlay on the representative copy. Click selects; marquee selects
// multiple parts; handles resize/rotate; Alt-drag on a single part duplicates.
import { useCallback, useEffect, useRef, useState } from "react";
import { instanceTransform } from "./repeatMath";
import { CANCEL_GESTURE_EVENT } from "../config";
import { partTransformAttr } from "../motif/parts";
import { recolorMarkup } from "../motif/recolor";
import type { Scene } from "./useScene";
import type { Center, Layer, MotifPart, PartTransform } from "../types";

const CORNERS = ["tl", "tr", "bl", "br"] as const;
const CORNER_CURSOR: Record<string, string> = { tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize" };

type Mode = "move" | "rotate" | "resize";
type Rect = { minX: number; minY: number; maxX: number; maxY: number };

interface PartEditLayerProps {
  layer: Layer;
  selectedPartIds: string[];
  /** Which copy the overlay is drawn on (edits still sync to all copies). */
  index: number;
  scene: Scene;
  /** 1 / viewport scale, for screen-constant handle sizing. */
  inv: number;
  onSelectPart: (partId: string, additive?: boolean) => void;
  onSelectParts: (partIds: string[], additive?: boolean) => void;
  onCommitTransform: (partId: string, t: PartTransform) => void;
  onCommitTransforms: (transforms: Record<string, PartTransform>) => void;
  /** Alt-drag: copy the part with the gesture's transform applied. */
  onDuplicatePart: (partId: string, t: PartTransform) => void;
  setDragging: (d: boolean) => void;
  handlePx: number;
  rotateGapPx: number;
  /** While space is held the canvas wants to pan, so the overlay yields its
   *  pointer gestures (lets the event bubble to the SVG pan handler). */
  spaceHeldRef?: { current: boolean };
  /** True while a two-finger pinch-zoom is in progress — suppress select/marquee. */
  pinchingRef?: { current: boolean };
  /** A click on another layer's artwork selects it (returns true) instead of
   *  starting a marquee on the layer currently being edited. */
  onPickLayer?: (clientX: number, clientY: number) => boolean;
  /** A marquee over other layers selects those layers instead of motif parts. */
  onSelectLayersByRect?: (rect: Rect, additive: boolean, excludeLayerId?: string) => boolean;
  isDuplicateModifierActive?: () => boolean;
}

// The marquee/select surface spans far beyond the motif box so a selection drag
// can begin anywhere around the artwork (motif-local units; transparent).
const SURFACE_REACH = 20000;

const normRect = (a: Center, b: Center): Rect => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

const transformPoint = (part: MotifPart, p: Center, t: PartTransform = part.transform): Center => {
  const a = (t.rotation * Math.PI) / 180;
  const x = (p.x - part.cx) * t.scale;
  const y = (p.y - part.cy) * t.scale;
  return {
    x: part.cx + t.tx + x * Math.cos(a) - y * Math.sin(a),
    y: part.cy + t.ty + x * Math.sin(a) + y * Math.cos(a),
  };
};

const partBox = (part: MotifPart, t: PartTransform = part.transform): Rect => {
  const x0 = part.cx - part.w / 2;
  const y0 = part.cy - part.h / 2;
  const pts = [
    transformPoint(part, { x: x0, y: y0 }, t),
    transformPoint(part, { x: x0 + part.w, y: y0 }, t),
    transformPoint(part, { x: x0, y: y0 + part.h }, t),
    transformPoint(part, { x: x0 + part.w, y: y0 + part.h }, t),
  ];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
};

const unionRects = (rects: Rect[]): Rect | null => {
  if (!rects.length) return null;
  return {
    minX: Math.min(...rects.map((r) => r.minX)),
    minY: Math.min(...rects.map((r) => r.minY)),
    maxX: Math.max(...rects.map((r) => r.maxX)),
    maxY: Math.max(...rects.map((r) => r.maxY)),
  };
};

const rectIntersects = (a: Rect, b: Rect): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

const rotateAround = (p: Center, pivot: Center, degrees: number): Center => {
  const a = (degrees * Math.PI) / 180;
  const x = p.x - pivot.x;
  const y = p.y - pivot.y;
  return { x: pivot.x + x * Math.cos(a) - y * Math.sin(a), y: pivot.y + x * Math.sin(a) + y * Math.cos(a) };
};

export function PartEditLayer(props: PartEditLayerProps) {
  const { layer, selectedPartIds, index, inv, handlePx, rotateGapPx } = props;
  const optsRef = useRef(props);
  optsRef.current = props;
  const partSpaceRef = useRef<SVGGElement>(null);
  const ghostRef = useRef<SVGGElement>(null);
  const [worldMarquee, setWorldMarquee] = useState<Rect | null>(null);
  const drag = useRef<{
    parts: MotifPart[];
    mode: Mode;
    alt: boolean;
    start: Center;
    pivot: Center;
    startTransforms: Record<string, PartTransform>;
    startAngle: number;
    startDist: number;
    latest: Record<string, PartTransform>;
    // Click-vs-drag: a pointerdown on the group frame starts a group move, but if
    // released without moving it should isolate the single part under the cursor.
    pickOnClick: boolean;
    clickAdditive: boolean;
    moved: boolean;
    startClientX: number;
    startClientY: number;
  } | null>(null);
  const marqueeDrag = useRef<{ start: Center; worldStart: Center; additive: boolean } | null>(null);

  const parts = (layer.motif.parts ?? []).filter((p) => p.visible);
  const selectedSet = new Set(selectedPartIds);
  const selectedParts = parts.filter((p) => selectedSet.has(p.id));
  const selectedUnion = unionRects(selectedParts.map((part) => partBox(part)));
  const showIndividualFrames = selectedParts.length <= 50;

  const toLocal = useCallback((clientX: number, clientY: number): Center => {
    const g = partSpaceRef.current;
    if (!g) return { x: 0, y: 0 };
    const ctm = g.getScreenCTM();
    if (!ctm || typeof DOMPoint === "undefined") return { x: 0, y: 0 };
    const local = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const paint = useCallback((part: MotifPart, t: PartTransform) => {
    const attr = partTransformAttr(t, part.cx, part.cy) ?? "translate(0 0)";
    partSpaceRef.current?.querySelector(`[data-part-overlay="${part.id}"]`)?.setAttribute("transform", attr);
    optsRef.current.scene.layersRootRef.current?.querySelector(`[data-part-render="${part.id}"]`)?.setAttribute("transform", attr);
  }, []);

  const paintMany = useCallback((next: Record<string, PartTransform>) => {
    for (const part of optsRef.current.layer.motif.parts ?? []) {
      const t = next[part.id];
      if (t) paint(part, t);
    }
  }, [paint]);

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) > 3) d.moved = true;
    const cur = toLocal(e.clientX, e.clientY);
    const next: Record<string, PartTransform> = {};
    if (d.mode === "move") {
      const dx = cur.x - d.start.x;
      const dy = cur.y - d.start.y;
      d.parts.forEach((part) => {
        const t = d.startTransforms[part.id];
        next[part.id] = { ...t, tx: t.tx + dx, ty: t.ty + dy };
      });
    } else if (d.mode === "rotate") {
      const ang = (Math.atan2(cur.y - d.pivot.y, cur.x - d.pivot.x) * 180) / Math.PI;
      const delta = ang - d.startAngle;
      d.parts.forEach((part) => {
        const t = d.startTransforms[part.id];
        const center = rotateAround({ x: part.cx + t.tx, y: part.cy + t.ty }, d.pivot, delta);
        next[part.id] = { ...t, tx: center.x - part.cx, ty: center.y - part.cy, rotation: t.rotation + delta };
      });
    } else {
      const cd = Math.hypot(cur.x - d.pivot.x, cur.y - d.pivot.y);
      const ratio = d.startDist > 1e-6 ? cd / d.startDist : 1;
      d.parts.forEach((part) => {
        const t = d.startTransforms[part.id];
        const center = {
          x: d.pivot.x + (part.cx + t.tx - d.pivot.x) * ratio,
          y: d.pivot.y + (part.cy + t.ty - d.pivot.y) * ratio,
        };
        next[part.id] = { ...t, tx: center.x - part.cx, ty: center.y - part.cy, scale: Math.max(0.05, t.scale * ratio) };
      });
    }
    d.latest = next;
    if (d.alt && d.parts.length === 1) {
      const part = d.parts[0];
      ghostRef.current?.setAttribute("transform", partTransformAttr(next[part.id], part.cx, part.cy) ?? "translate(0 0)");
    } else {
      paintMany(next);
    }
  }, [toLocal, paintMany]);

  const onUp = useCallback(() => {
    const d = drag.current;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    drag.current = null;
    optsRef.current.setDragging(false);
    const ghost = ghostRef.current;
    if (ghost) { ghost.style.display = "none"; ghost.innerHTML = ""; }
    if (!d) return;
    // A click (no real movement) inside a multi-part selection drills in to the
    // single part under the cursor instead of moving the whole group.
    if (d.pickOnClick && !d.moved) {
      const ps = (optsRef.current.layer.motif.parts ?? []).filter((p) => p.visible);
      for (let i = ps.length - 1; i >= 0; i--) {
        const b = partBox(ps[i]);
        if (d.start.x >= b.minX && d.start.x <= b.maxX && d.start.y >= b.minY && d.start.y <= b.maxY) {
          optsRef.current.onSelectPart(ps[i].id, d.clickAdditive);
          return;
        }
      }
      // Clicked an empty gap inside the frame: clear (unless additive).
      if (!d.clickAdditive) optsRef.current.onSelectParts([], false);
      return;
    }
    if (d.alt && d.moved && d.parts.length === 1) optsRef.current.onDuplicatePart(d.parts[0].id, d.latest[d.parts[0].id]);
    else if (d.parts.length === 1) optsRef.current.onCommitTransform(d.parts[0].id, d.latest[d.parts[0].id]);
    else optsRef.current.onCommitTransforms(d.latest);
  }, [onMove]);

  // Abort an in-flight part move/resize/rotate (snap parts back, commit nothing).
  // Fired when a pinch-zoom interrupts the drag.
  const cancelDrag = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    paintMany(d.startTransforms);
    const ghost = ghostRef.current;
    if (ghost) { ghost.style.display = "none"; ghost.innerHTML = ""; }
    drag.current = null;
    optsRef.current.setDragging(false);
  }, [onMove, onUp, paintMany]);

  useEffect(() => {
    window.addEventListener(CANCEL_GESTURE_EVENT, cancelDrag);
    return () => window.removeEventListener(CANCEL_GESTURE_EVENT, cancelDrag);
  }, [cancelDrag]);

  const beginSelectionDrag = (
    e: React.PointerEvent,
    dragParts: MotifPart[],
    mode: Mode,
    pivot: Center,
    pickOnClick = false
  ) => {
    if (optsRef.current.spaceHeldRef?.current || optsRef.current.pinchingRef?.current) return; // pan / pinch
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const start = toLocal(e.clientX, e.clientY);
    const startTransforms = Object.fromEntries(dragParts.map((part) => [part.id, part.transform]));
    const alt = (e.altKey || !!optsRef.current.isDuplicateModifierActive?.()) && dragParts.length === 1;
    drag.current = {
      parts: dragParts,
      mode,
      alt,
      start,
      pivot,
      startTransforms,
      startAngle: (Math.atan2(start.y - pivot.y, start.x - pivot.x) * 180) / Math.PI,
      startDist: Math.hypot(start.x - pivot.x, start.y - pivot.y),
      latest: startTransforms,
      pickOnClick,
      clickAdditive: e.shiftKey || e.metaKey || e.ctrlKey,
      moved: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    if (alt && ghostRef.current) {
      const part = dragParts[0];
      ghostRef.current.innerHTML = part.fill ? recolorMarkup(part.baseMarkup, part.fill) : part.baseMarkup;
      ghostRef.current.setAttribute("transform", partTransformAttr(part.transform, part.cx, part.cy) ?? "translate(0 0)");
      ghostRef.current.style.display = "";
    }
    optsRef.current.setDragging(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const beginPart = (e: React.PointerEvent, part: MotifPart, mode: Mode) => {
    if (optsRef.current.spaceHeldRef?.current || optsRef.current.pinchingRef?.current) return; // pan / pinch
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (additive) {
      e.preventDefault();
      e.stopPropagation();
      optsRef.current.onSelectPart(part.id, true);
      return;
    }
    const inMulti = selectedSet.has(part.id) && selectedParts.length > 1;
    const activeParts = inMulti ? selectedParts : [part];
    if (!inMulti && part.id !== selectedPartIds[0]) optsRef.current.onSelectPart(part.id);
    const union = unionRects(activeParts.map((p) => partBox(p)));
    const pivot = union
      ? { x: (union.minX + union.maxX) / 2, y: (union.minY + union.maxY) / 2 }
      : { x: part.cx + part.transform.tx, y: part.cy + part.transform.ty };
    // In a multi-selection, a plain click drills to this part; a drag moves the group.
    beginSelectionDrag(e, activeParts, mode, pivot, inMulti);
  };

  const onMarqueeMove = useCallback((e: PointerEvent) => {
    const d = marqueeDrag.current;
    if (!d) return;
    // A pinch started mid-drag → abandon the marquee (no rubber-band, no select).
    if (optsRef.current.pinchingRef?.current) {
      marqueeDrag.current = null;
      setWorldMarquee(null);
      return;
    }
    setWorldMarquee(normRect(d.worldStart, optsRef.current.scene.screenToWorld(e.clientX, e.clientY)));
  }, [toLocal]);

  const onMarqueeUp = useCallback((e: PointerEvent) => {
    const d = marqueeDrag.current;
    window.removeEventListener("pointermove", onMarqueeMove);
    window.removeEventListener("pointerup", onMarqueeUp);
    marqueeDrag.current = null;
    if (!d || optsRef.current.pinchingRef?.current) {
      setWorldMarquee(null);
      return;
    }
    const rect = normRect(d.start, toLocal(e.clientX, e.clientY));
    const worldRect = normRect(d.worldStart, optsRef.current.scene.screenToWorld(e.clientX, e.clientY));
    if (optsRef.current.onSelectLayersByRect?.(worldRect, d.additive, optsRef.current.layer.id)) {
      setWorldMarquee(null);
      return;
    }
    const ids = parts.filter((part) => rectIntersects(rect, partBox(part))).map((part) => part.id);
    optsRef.current.onSelectParts(ids, d.additive);
    setWorldMarquee(null);
  }, [onMarqueeMove, parts, toLocal]);

  const beginMarquee = (e: React.PointerEvent) => {
    if (optsRef.current.spaceHeldRef?.current || optsRef.current.pinchingRef?.current) return; // pan / pinch
    // A click on another layer's artwork switches to editing that layer instead
    // of marquee-selecting parts of the current one.
    if (optsRef.current.onPickLayer?.(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const start = toLocal(e.clientX, e.clientY);
    const worldStart = props.scene.screenToWorld(e.clientX, e.clientY);
    marqueeDrag.current = { start, worldStart, additive: e.shiftKey || e.metaKey || e.ctrlKey };
    setWorldMarquee(normRect(worldStart, worldStart));
    window.addEventListener("pointermove", onMarqueeMove);
    window.addEventListener("pointerup", onMarqueeUp);
  };

  const p = layer.params;
  const instScale = layer.scale * p.sourceScale * (1 + index * p.scaleStep);
  const hsFor = (partScale = 1) => (handlePx * inv) / Math.max(1e-3, Math.abs(instScale * partScale));
  const groupHandle = (handlePx * inv) / Math.max(1e-3, Math.abs(instScale));
  const groupGap = (rotateGapPx * inv) / Math.max(1e-3, Math.abs(instScale));
  const motifBox = layer.motif.box;

  return (
    <g className="part-edit-overlay" transform={`translate(${layer.center.x},${layer.center.y})`}>
      {worldMarquee && (
        <rect
          className="part-marquee"
          x={worldMarquee.minX - layer.center.x}
          y={worldMarquee.minY - layer.center.y}
          width={worldMarquee.maxX - worldMarquee.minX}
          height={worldMarquee.maxY - worldMarquee.minY}
        />
      )}
      <g transform={`scale(${layer.scale})`}>
        <g transform={instanceTransform(layer.params, index)}>
          <g ref={partSpaceRef} transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}>
            <rect
              className="part-marquee-surface"
              x={motifBox.x + motifBox.width / 2 - SURFACE_REACH}
              y={motifBox.y + motifBox.height / 2 - SURFACE_REACH}
              width={SURFACE_REACH * 2}
              height={SURFACE_REACH * 2}
              onPointerDown={beginMarquee}
            />
            <g ref={ghostRef} className="part-ghost" style={{ display: "none" }} />
            <g className="part-hit-targets">
              {parts.map((part) => (
                <g
                  key={part.id}
                  className="part-hit-shape"
                  data-part-hit={part.id}
                  transform={partTransformAttr(part.transform, part.cx, part.cy) ?? "translate(0 0)"}
                  onPointerDown={(e) => beginPart(e, part, "move")}
                  dangerouslySetInnerHTML={{ __html: part.fill ? recolorMarkup(part.baseMarkup, part.fill) : part.baseMarkup }}
                />
              ))}
            </g>
            {showIndividualFrames && selectedParts.map((part) => {
              const x0 = part.cx - part.w / 2;
              const y0 = part.cy - part.h / 2;
              const hs = hsFor(part.transform.scale);
              const gap = (rotateGapPx * inv) / Math.max(1e-3, Math.abs(instScale * part.transform.scale));
              const single = selectedParts.length === 1;
              return (
                <g key={part.id} data-part-overlay={part.id} transform={partTransformAttr(part.transform, part.cx, part.cy) ?? "translate(0 0)"}>
                  <rect className="part-frame" x={x0} y={y0} width={part.w} height={part.h} />
                  {single && CORNERS.map((c) => {
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
                        onPointerDown={(e) => beginPart(e, part, "resize")}
                      />
                    );
                  })}
                  {single && (
                    <g className="part-rotate" onPointerDown={(e) => beginPart(e, part, "rotate")}>
                      <line className="part-rotate-line" x1={part.cx} y1={y0} x2={part.cx} y2={y0 - gap} />
                      <circle className="part-rotate-knob" cx={part.cx} cy={y0 - gap} r={hs * 0.6} />
                    </g>
                  )}
                </g>
              );
            })}
            {selectedParts.length > 1 && selectedUnion && (
              <g className="part-group-overlay">
                <rect
                  className="part-frame part-group-frame"
                  x={selectedUnion.minX}
                  y={selectedUnion.minY}
                  width={selectedUnion.maxX - selectedUnion.minX}
                  height={selectedUnion.maxY - selectedUnion.minY}
                  onPointerDown={(e) =>
                    beginSelectionDrag(e, selectedParts, "move", {
                      x: (selectedUnion.minX + selectedUnion.maxX) / 2,
                      y: (selectedUnion.minY + selectedUnion.maxY) / 2,
                    }, true)
                  }
                />
                {CORNERS.map((c) => {
                  const cxh = c.includes("r") ? selectedUnion.maxX : selectedUnion.minX;
                  const cyh = c.includes("b") ? selectedUnion.maxY : selectedUnion.minY;
                  return (
                    <rect
                      key={c}
                      className="part-handle"
                      x={cxh - groupHandle / 2}
                      y={cyh - groupHandle / 2}
                      width={groupHandle}
                      height={groupHandle}
                      style={{ cursor: CORNER_CURSOR[c] }}
                      onPointerDown={(e) =>
                        beginSelectionDrag(e, selectedParts, "resize", {
                          x: (selectedUnion.minX + selectedUnion.maxX) / 2,
                          y: (selectedUnion.minY + selectedUnion.maxY) / 2,
                        })
                      }
                    />
                  );
                })}
                <g
                  className="part-rotate"
                  onPointerDown={(e) =>
                    beginSelectionDrag(e, selectedParts, "rotate", {
                      x: (selectedUnion.minX + selectedUnion.maxX) / 2,
                      y: (selectedUnion.minY + selectedUnion.maxY) / 2,
                    })
                  }
                >
                  <line className="part-rotate-line" x1={(selectedUnion.minX + selectedUnion.maxX) / 2} y1={selectedUnion.minY} x2={(selectedUnion.minX + selectedUnion.maxX) / 2} y2={selectedUnion.minY - groupGap} />
                  <circle className="part-rotate-knob" cx={(selectedUnion.minX + selectedUnion.maxX) / 2} cy={selectedUnion.minY - groupGap} r={groupHandle * 0.6} />
                </g>
              </g>
            )}
          </g>
        </g>
      </g>
    </g>
  );
}

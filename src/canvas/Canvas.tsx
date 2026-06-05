// The <svg>, pan/zoom group, the layer stack, and the selection UI.
//
// There is no center handle: you MOVE a layer by grabbing its artwork and
// dragging (onLayerPointerDown -> useMoveDrag). The only on-canvas widget is the
// selection gizmo: a frame around the union of the selected layers, with corner
// resize handles and a compact selection-action menu.
import { useEffect, useRef, useState } from "react";
import { GIZMO_HANDLE, ROTATE_GAP, isHeavy } from "../config";
import { LayerArt } from "./LayerArt";
import { pencilPreviewPath, type PencilSettings } from "../motif/drawnPath";
import { PartEditLayer } from "./PartEditLayer";
import { ComponentEditLayer } from "./ComponentEditLayer";
import { smoothPathD } from "../motion/centerPath";
import type { Scene } from "./useScene";
import type { GBounds } from "./selectionBounds";
import type { WorldRect } from "../App";
import type { Center, DesignView, Layer, PartTransform, RepeatParams, Viewport } from "../types";

const CORNERS = ["tl", "tr", "bl", "br"] as const;
const CORNER_CURSOR: Record<string, string> = {
  tl: "nwse-resize",
  br: "nwse-resize",
  tr: "nesw-resize",
  bl: "nesw-resize",
};

interface CanvasProps {
  layers: Layer[];
  selectedIds: Set<string>;
  /** Selection gizmo bounds (union of selected, editable layers), or null. */
  gizmo: GBounds | null;
  /** Per-layer outline boxes when several are selected (id + bounds). */
  selectionBoxes: (GBounds & { id: string })[];
  /** Design-mode canvas framing (focus the motif), or null outside Design. */
  designView: DesignView | null;
  /** What a double-click drills into: parts (Design), a copy (Arrange), or none. */
  dblClickTarget: "part" | "component" | null;
  /** Which layer+copy is in single-component edit mode, or null. */
  componentEdit: { layerId: string; index: number } | null;
  onComponentSelect: (layerId: string, index: number) => void;
  onComponentExit: () => void;
  onCommitComponent: (partial: Partial<RepeatParams>) => void;
  /** Sub-part editing: which layer is in part-edit mode + the selected part. */
  partEdit: { layerId: string; partId: string | null; index: number } | null;
  onEnterPartMode: (layerId: string, index: number) => void;
  onSelectPart: (layerId: string, partId: string) => void;
  onCommitPartTransform: (layerId: string, partId: string, t: PartTransform) => void;
  onDuplicatePart: (layerId: string, partId: string, t: PartTransform) => void;
  onExitPart: () => void;
  motionCss: string;
  /** The primary layer's motion path (world points), shown while in Animate mode. */
  motionPath: { points: Center[]; closed: boolean } | null;
  drawingMotionPath: boolean;
  /** Where the drawn path is anchored (the primary petal's center), or null. */
  motionAnchor: Center | null;
  animationsMoving: boolean;
  /** Active tool. "pencil" replaces select/marquee on the canvas with drawing. */
  tool: "select" | "pencil";
  pencil: PencilSettings;
  fillColor: string;
  /** Finalize a pencil stroke (raw world points) into a drawn layer. */
  onDrawCommit: (points: Center[]) => void;
  viewport: Viewport;
  dragging: boolean;
  setDragging: (d: boolean) => void;
  scene: Scene;
  /** Grab a layer's artwork: select-if-needed and begin a move. */
  onLayerPointerDown: (e: React.PointerEvent, id: string, additive: boolean) => void;
  onMarqueeSelect: (rect: WorldRect, additive: boolean) => void;
  /** Commit a freehand-drawn motion path (raw world points). */
  onMotionPathDrawn: (points: Center[]) => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onRotatePointerDown: (e: React.PointerEvent) => void;
  /** Zoom the canvas at an svg-local point. */
  onZoom: (lx: number, ly: number, deltaY: number) => void;
  panBy: (dx: number, dy: number) => void;
}

export function Canvas({
  layers,
  selectedIds,
  gizmo,
  selectionBoxes,
  designView,
  dblClickTarget,
  componentEdit,
  onComponentSelect,
  onComponentExit,
  onCommitComponent,
  partEdit,
  onEnterPartMode,
  onSelectPart,
  onCommitPartTransform,
  onDuplicatePart,
  onExitPart,
  motionCss,
  motionPath,
  drawingMotionPath,
  motionAnchor,
  animationsMoving,
  tool,
  pencil,
  fillColor,
  onDrawCommit,
  viewport,
  dragging,
  setDragging,
  scene,
  onLayerPointerDown,
  onMarqueeSelect,
  onMotionPathDrawn,
  onResizePointerDown,
  onRotatePointerDown,
  onZoom,
  panBy,
}: CanvasProps) {
  const { s, tx, ty } = viewport;
  const inv = 1 / s;

  const spaceHeld = useRef(false);
  const panState = useRef({ active: false, lastX: 0, lastY: 0 });
  // Manual double-tap detection (native dblclick is unreliable under the
  // pointer-capture used by the move gesture).
  const lastTap = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  const motionPathRef = useRef<SVGPathElement>(null);
  // Marquee selection. Mode is tracked on a ref (per-frame), rect in state so
  // the dashed box renders; LayerArt is memoized so this re-render is cheap.
  const mode = useRef<"pan" | "marquee" | "motion-path" | "draw" | null>(null);
  const marqueeStart = useRef<Center>({ x: 0, y: 0 });
  // Pencil: collect world points; preview path is mutated imperatively via rAF.
  // No React state is written until the stroke is committed on pointerup. PRD §9.
  const drawPts = useRef<Center[]>([]);
  const drawStart = useRef<Center>({ x: 0, y: 0 });
  const drawQueued = useRef(false);
  const pencilPreviewRef = useRef<SVGPathElement>(null);
  const pencilAnchorRef = useRef<SVGCircleElement>(null);
  // Freehand motion-path drawing: collect world points, preview imperatively.
  const motionPts = useRef<Center[]>([]);
  const motionDraw = useRef({ pending: null as PointerEvent | null, queued: false });
  const [marquee, setMarquee] = useState<WorldRect | null>(null);

  const normRect = (a: Center, b: Center): WorldRect => ({
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Native, NON-passive wheel listener: React's onWheel is passive, so
  // preventDefault there is ignored and the browser page-zooms on a trackpad
  // pinch (ctrl+wheel). Here we can preventDefault and zoom only the canvas.
  useEffect(() => {
    const svg = scene.svgRef.current;
    if (!svg) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      onZoom(e.clientX - r.left, e.clientY - r.top, e.deltaY);
    };
    svg.addEventListener("wheel", onWheelNative, { passive: false });
    return () => svg.removeEventListener("wheel", onWheelNative);
  }, [onZoom, scene]);

  // Preview points: the drawn stroke translated so its first point sits on the
  // anchor (the primary petal's center) — the path always starts from the petal.
  const motionFirst = useRef<Center>({ x: 0, y: 0 });
  const anchoredPreview = (pts: Center[]): Center[] => {
    const a = motionAnchor;
    if (!a) return pts;
    const f = motionFirst.current;
    return pts.map((p) => ({ x: a.x + (p.x - f.x), y: a.y + (p.y - f.y) }));
  };

  const applyMotionDraw = () => {
    motionDraw.current.queued = false;
    const e = motionDraw.current.pending;
    if (!e) return;
    const p = scene.screenToWorld(e.clientX, e.clientY);
    const pts = motionPts.current;
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 2 * inv) pts.push(p);
    motionPathRef.current?.setAttribute("d", smoothPathD(anchoredPreview(pts), false));
  };

  const motionDrawMove = (e: PointerEvent) => {
    motionDraw.current.pending = e;
    if (!motionDraw.current.queued) {
      motionDraw.current.queued = true;
      requestAnimationFrame(applyMotionDraw);
    }
  };

  const motionDrawUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", motionDrawMove);
    window.removeEventListener("pointerup", motionDrawUp);
    const end = scene.screenToWorld(e.clientX, e.clientY);
    const pts = motionPts.current;
    if (pts.length === 0 || Math.hypot(end.x - pts[pts.length - 1].x, end.y - pts[pts.length - 1].y) > 0.5) pts.push(end);
    mode.current = null;
    motionPts.current = [];
    if (pts.length >= 2) onMotionPathDrawn(pts);
  };

  // Draw a freehand motion path: each copy will trace it relative to the center.
  const beginMotionDraw = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    mode.current = "motion-path";
    const start = scene.screenToWorld(e.clientX, e.clientY);
    motionPts.current = [start];
    motionFirst.current = start;
    const a = motionAnchor ?? start;
    motionPathRef.current?.setAttribute("d", `M ${a.x} ${a.y}`);
    window.addEventListener("pointermove", motionDrawMove);
    window.addEventListener("pointerup", motionDrawUp);
  };

  // --- Pencil drawing (PRD §8–10) ---
  const SNAP_PX = 16;
  const nearStart = (p: Center) =>
    drawPts.current.length > 8 &&
    Math.hypot(p.x - drawStart.current.x, p.y - drawStart.current.y) < SNAP_PX * inv;

  const updateDrawPreview = () => {
    drawQueued.current = false;
    const pts = drawPts.current;
    const last = pts[pts.length - 1];
    const snapping = !!last && nearStart(last);
    // When the pen returns near the start, preview the closed loop exactly.
    const previewPts = snapping ? [...pts, drawStart.current] : pts;
    pencilPreviewRef.current?.setAttribute(
      "d",
      pencilPreviewPath(previewPts, pencil.size * inv, pencil.smoothing)
    );
    pencilAnchorRef.current?.classList.toggle("snapping", snapping);
  };
  const scheduleDraw = () => {
    if (!drawQueued.current) {
      drawQueued.current = true;
      requestAnimationFrame(updateDrawPreview);
    }
  };
  const showAnchor = (p: Center) => {
    const a = pencilAnchorRef.current;
    if (!a) return;
    a.setAttribute("cx", String(p.x));
    a.setAttribute("cy", String(p.y));
    a.setAttribute("r", String(6 * inv));
    a.style.opacity = "1";
    a.classList.remove("snapping");
  };
  const hideAnchor = () => {
    const a = pencilAnchorRef.current;
    if (a) {
      a.style.opacity = "0";
      a.classList.remove("snapping");
    }
  };
  const beginDraw = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    mode.current = "draw";
    const start = scene.screenToWorld(e.clientX, e.clientY);
    drawStart.current = start;
    drawPts.current = [start];
    const el = pencilPreviewRef.current;
    if (el) {
      el.setAttribute("fill", fillColor);
      el.setAttribute("stroke", fillColor);
      el.setAttribute("stroke-width", String(pencil.size * inv));
      el.setAttribute("d", "");
    }
    showAnchor(start);
  };

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const wantPan = e.button === 1 || (e.button === 0 && spaceHeld.current);
    if (wantPan) {
      e.preventDefault();
      mode.current = "pan";
      panState.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    // The gizmo (resize handles + selection menu), component overlay and part
    // overlay own their own pointerdowns.
    if ((e.target as Element).closest?.(".gizmo, .motion-path-ui, .component-ui, .part-edit-overlay")) return;

    // A click anywhere outside the component/part overlays exits those edit
    // modes (then falls through to normal select/marquee behavior).
    if (componentEdit) onComponentExit();
    if (partEdit) onExitPart();

    // Pencil tool: draw instead of select/marquee. PRD §8.
    if (tool === "pencil") {
      beginDraw(e);
      return;
    }

    if (drawingMotionPath) {
      beginMotionDraw(e);
      return;
    }

    // Grab on a layer's artwork: select-if-needed and begin a move (locked
    // artwork is inert). A double-tap on the artwork drills into the copy under
    // the cursor (component edit) — detected manually, because pointer-capture
    // during a move suppresses the browser's native dblclick.
    const el = (e.target as Element).closest?.(".layer[data-layer-id]");
    const id = el?.getAttribute("data-layer-id");
    if (id) {
      const layer = layers.find((l) => l.id === id);
      if (layer && !layer.locked) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const last = lastTap.current;
        const isDouble =
          !!last && last.id === id && now - last.t < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6;
        lastTap.current = isDouble ? null : { id, t: now, x: e.clientX, y: e.clientY };
        if (isDouble && tool === "select" && dblClickTarget) {
          e.preventDefault();
          const iEl = (e.target as Element).closest?.("[data-i]");
          const i = iEl != null ? parseInt(iEl.getAttribute("data-i") ?? "0", 10) : 0;
          if (dblClickTarget === "part") onEnterPartMode(id, i);
          else onComponentSelect(id, i);
          return;
        }
        onLayerPointerDown(e, id, e.shiftKey);
      }
      return;
    }

    // Empty canvas: begin a marquee.
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    mode.current = "marquee";
    const w = scene.screenToWorld(e.clientX, e.clientY);
    marqueeStart.current = w;
    setMarquee(normRect(w, w));
  };
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode.current === "pan") {
      panBy(e.clientX - panState.current.lastX, e.clientY - panState.current.lastY);
      panState.current.lastX = e.clientX;
      panState.current.lastY = e.clientY;
    } else if (mode.current === "marquee") {
      setMarquee(normRect(marqueeStart.current, scene.screenToWorld(e.clientX, e.clientY)));
    } else if (mode.current === "draw") {
      const p = scene.screenToWorld(e.clientX, e.clientY);
      const pts = drawPts.current;
      const last = pts[pts.length - 1];
      // Throttle by a minimum (≈1.5 screen px) so huge strokes stay bounded. PRD §18.
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1.5 * inv) {
        pts.push(p);
        scheduleDraw();
      }
    }
  };
  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode.current === "draw") {
      const pts = drawPts.current;
      const end = scene.screenToWorld(e.clientX, e.clientY);
      // Snap closed: if the pen ended near the start anchor, return the path to
      // the start so the loop joins cleanly. PRD (start/end anchor join).
      if (nearStart(end)) pts.push(drawStart.current);
      drawPts.current = [];
      pencilPreviewRef.current?.setAttribute("d", "");
      hideAnchor();
      mode.current = null;
      onDrawCommit(pts);
      return;
    }
    if (mode.current === "marquee") {
      const rect = normRect(marqueeStart.current, scene.screenToWorld(e.clientX, e.clientY));
      onMarqueeSelect(rect, e.shiftKey);
      setMarquee(null);
    }
    if (mode.current !== "motion-path") mode.current = null;
    panState.current.active = false;
  };
  // Drill from the component gizmo into the motif's sub-parts (if it has any).
  const drillToParts = () => {
    if (!componentEdit) return;
    const cl = layers.find((l) => l.id === componentEdit.layerId);
    if (cl && (cl.motif.parts?.length ?? 0) >= 1) onEnterPartMode(componentEdit.layerId, componentEdit.index);
  };

  const endPan = () => {
    if (mode.current === "marquee") setMarquee(null);
    if (mode.current === "draw") {
      drawPts.current = [];
      pencilPreviewRef.current?.setAttribute("d", "");
      hideAnchor();
    }
    mode.current = null;
    panState.current.active = false;
  };

  return (
    <svg
      ref={scene.svgRef}
      className={`canvas-svg${drawingMotionPath ? " drawing-path" : ""}${designView ? ` design-mode view-${designView}` : ""}`}
      onPointerDown={onSvgPointerDown}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onPointerLeave={endPan}
    >
      {motionCss && <style>{motionCss}</style>}
      <g ref={scene.panZoomRef} transform={`translate(${tx},${ty}) scale(${s})`}>
        <g ref={scene.layersRootRef} className="layers-root">
          {layers
            .filter((l) => l.visible)
            .map((l) => (
              <LayerArt
                key={l.id}
                layer={l}
                // Proxy only the layers being dragged in a heavy scene.
                proxy={dragging && selectedIds.has(l.id) && isHeavy(l.params.count, l.motif.weight)}
                animationsMoving={animationsMoving}
              />
            ))}
        </g>

        {/* Live pencil preview (imperative; not part of committed state). PRD §10. */}
        {tool === "pencil" && (
          <>
            <path
              ref={pencilPreviewRef}
              className="pencil-preview"
              fill={fillColor}
              stroke={fillColor}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ pointerEvents: "none" }}
            />
            {/* Start anchor; grows/highlights when the pen returns to snap closed. */}
            <circle ref={pencilAnchorRef} className="pencil-anchor" r={0} style={{ opacity: 0, pointerEvents: "none" }} />
          </>
        )}

        <g className="selection-ui">
          {marquee && (
            <rect
              className="marquee"
              x={marquee.minX}
              y={marquee.minY}
              width={marquee.maxX - marquee.minX}
              height={marquee.maxY - marquee.minY}
            />
          )}
          {/* Per-layer selection outlines (hidden mid-drag — they'd lag the live
              union gizmo, which updates imperatively). */}
          {!dragging &&
            selectionBoxes.map((b) => (
              <rect
                key={b.id}
                className="selection-box"
                x={b.cx - b.hw}
                y={b.cy - b.hh}
                width={2 * b.hw}
                height={2 * b.hh}
              />
            ))}
          {(motionPath || drawingMotionPath) && (
            <g className="motion-path-ui">
              <path
                ref={motionPathRef}
                className={motionPath?.closed ? "motion-path-line closed" : "motion-path-line"}
                d={motionPath ? smoothPathD(motionPath.points, motionPath.closed) : ""}
                style={{ strokeWidth: 2 * inv }}
              />
              {motionPath && motionPath.points[0] && (
                <circle className="motion-path-start" cx={motionPath.points[0].x} cy={motionPath.points[0].y} r={6 * inv} />
              )}
              {/* While drawing: a pulsing "start here" marker on the primary petal. */}
              {drawingMotionPath && motionAnchor && (
                <>
                  <circle className="motion-anchor-halo" cx={motionAnchor.x} cy={motionAnchor.y} r={16 * inv} />
                  <circle className="motion-anchor" cx={motionAnchor.x} cy={motionAnchor.y} r={5 * inv} />
                </>
              )}
            </g>
          )}
          {/* Selection gizmo: union frame + corner resize handles + a compact
              action menu. The menu sits on the 45° corner ray from top-right. */}
          {gizmo && (
            <g ref={scene.gizmoRef} className="gizmo" transform={`translate(${gizmo.cx},${gizmo.cy})`}>
              <rect
                className="gizmo-frame"
                x={-gizmo.hw}
                y={-gizmo.hh}
                width={2 * gizmo.hw}
                height={2 * gizmo.hh}
                fill="none"
              />
              {/* Rotate knob above the top edge: rotates the whole composite
                  (angle offset). */}
              <g className="gizmo-rotate" transform={`translate(0,${-gizmo.hh})`} onPointerDown={onRotatePointerDown}>
                <line className="gizmo-rotate-line" x1={0} y1={0} x2={0} y2={-ROTATE_GAP * inv} />
                <circle className="gizmo-rotate-knob" cx={0} cy={-ROTATE_GAP * inv} r={6 * inv} />
              </g>
              {CORNERS.map((c) => {
                const sx = c.includes("r") ? 1 : -1;
                const sy = c.includes("b") ? 1 : -1;
                const hs = GIZMO_HANDLE * inv;
                return (
                  <rect
                    key={c}
                    className="gizmo-handle"
                    data-corner={c}
                    x={sx * gizmo.hw - hs / 2}
                    y={sy * gizmo.hh - hs / 2}
                    width={hs}
                    height={hs}
                    style={{ cursor: CORNER_CURSOR[c] }}
                    onPointerDown={onResizePointerDown}
                  />
                );
              })}
            </g>
          )}
          {/* Individual-component gizmo: a frame that hugs the edited copy, with
              corner handles to resize (sourceScale) and a knob to rotate
              (sourceRotation); dragging the frame moves it (symmetric). */}
          {componentEdit && (() => {
            const cl = layers.find((l) => l.id === componentEdit.layerId);
            return cl ? (
              <ComponentEditLayer
                layer={cl}
                index={componentEdit.index}
                scene={scene}
                inv={inv}
                onCommit={onCommitComponent}
                onDrill={drillToParts}
                setDragging={setDragging}
              />
            ) : null;
          })()}
          {/* Sub-part edit overlay: per-part hit-rects on the representative copy. */}
          {partEdit && (() => {
            const pl = layers.find((l) => l.id === partEdit.layerId);
            return pl ? (
              <PartEditLayer
                layer={pl}
                selectedPartId={partEdit.partId}
                index={partEdit.index}
                scene={scene}
                inv={inv}
                onSelectPart={(partId) => onSelectPart(pl.id, partId)}
                onCommitTransform={(partId, t) => onCommitPartTransform(pl.id, partId, t)}
                onDuplicatePart={(partId, t) => onDuplicatePart(pl.id, partId, t)}
                setDragging={setDragging}
              />
            ) : null;
          })()}
        </g>
      </g>
    </svg>
  );
}

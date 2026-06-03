// The <svg>, pan/zoom group, the layer stack, and the selection UI.
//
// There is no center handle: you MOVE a layer by grabbing its artwork and
// dragging (onLayerPointerDown -> useMoveDrag). The only on-canvas widget is the
// selection gizmo: a frame around the union of the selected layers, with corner
// resize handles and a compact selection-action menu.
import { useEffect, useRef, useState } from "react";
import { GIZMO_DUP_GAP, GIZMO_HANDLE, isHeavy } from "../config";
import { LayerArt } from "./LayerArt";
import { pencilPreviewPath, type PencilSettings } from "../motif/drawnPath";
import type { Scene } from "./useScene";
import type { GBounds } from "./selectionBounds";
import type { WorldRect } from "../App";
import type { Center, Layer, Viewport } from "../types";

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
  motionCss: string;
  motionPath: { start: Center; end: Center; closed: boolean } | null;
  drawingMotionPath: boolean;
  animationsMoving: boolean;
  /** Active tool. "pencil" replaces select/marquee on the canvas with drawing. */
  tool: "select" | "pencil";
  pencil: PencilSettings;
  /** Finalize a pencil stroke (raw world points) into a drawn layer. */
  onDrawCommit: (points: Center[]) => void;
  viewport: Viewport;
  dragging: boolean;
  scene: Scene;
  /** Grab a layer's artwork: select-if-needed and begin a move. */
  onLayerPointerDown: (e: React.PointerEvent, id: string, additive: boolean) => void;
  onMarqueeSelect: (rect: WorldRect, additive: boolean) => void;
  onMotionPathCommit: (handle: "start" | "end", point: Center) => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onDuplicateSelected: () => void;
  onGroupSelection: () => void;
  onUngroupSelection: () => void;
  canGroupSelection: boolean;
  canUngroupSelection: boolean;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  panBy: (dx: number, dy: number) => void;
}

export function Canvas({
  layers,
  selectedIds,
  gizmo,
  motionCss,
  motionPath,
  drawingMotionPath,
  animationsMoving,
  tool,
  pencil,
  onDrawCommit,
  viewport,
  dragging,
  scene,
  onLayerPointerDown,
  onMarqueeSelect,
  onMotionPathCommit,
  onResizePointerDown,
  onDuplicateSelected,
  onGroupSelection,
  onUngroupSelection,
  canGroupSelection,
  canUngroupSelection,
  onWheel,
  panBy,
}: CanvasProps) {
  const { s, tx, ty } = viewport;
  const inv = 1 / s;

  const spaceHeld = useRef(false);
  const panState = useRef({ active: false, lastX: 0, lastY: 0 });
  const motionLineRef = useRef<SVGLineElement>(null);
  const motionStartRef = useRef<SVGCircleElement>(null);
  const motionEndRef = useRef<SVGCircleElement>(null);
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
  const motionDrag = useRef({
    handle: "end" as "start" | "end",
    pending: null as PointerEvent | null,
    queued: false,
  });
  const [marquee, setMarquee] = useState<WorldRect | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);

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

  const paintMotionHandle = (handle: "start" | "end", point: Center) => {
    const axis = handle === "start" ? "1" : "2";
    motionLineRef.current?.setAttribute(`x${axis}`, String(point.x));
    motionLineRef.current?.setAttribute(`y${axis}`, String(point.y));
    const circle = handle === "start" ? motionStartRef.current : motionEndRef.current;
    circle?.setAttribute("cx", String(point.x));
    circle?.setAttribute("cy", String(point.y));
  };

  const applyMotionDrag = () => {
    motionDrag.current.queued = false;
    const e = motionDrag.current.pending;
    if (!e) return;
    paintMotionHandle(motionDrag.current.handle, scene.screenToWorld(e.clientX, e.clientY));
  };

  const motionMove = (e: PointerEvent) => {
    motionDrag.current.pending = e;
    if (!motionDrag.current.queued) {
      motionDrag.current.queued = true;
      requestAnimationFrame(applyMotionDrag);
    }
  };

  const motionUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", motionMove);
    window.removeEventListener("pointerup", motionUp);
    const point = scene.screenToWorld(e.clientX, e.clientY);
    const handle = motionDrag.current.handle;
    paintMotionHandle(handle, point);
    mode.current = null;
    onMotionPathCommit(handle, point);
  };

  const beginMotionDrag = (e: React.PointerEvent, handle: "start" | "end" = "end") => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    mode.current = "motion-path";
    motionDrag.current.handle = handle;
    const point = scene.screenToWorld(e.clientX, e.clientY);
    paintMotionHandle(handle, point);
    window.addEventListener("pointermove", motionMove);
    window.addEventListener("pointerup", motionUp);
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
      el.setAttribute("fill", pencil.fillColor);
      el.setAttribute("stroke", pencil.fillColor);
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
    // The gizmo (resize handles + selection menu) owns its own pointerdowns.
    if ((e.target as Element).closest?.(".gizmo, .motion-path-ui")) return;
    setActionMenuOpen(false);

    // Pencil tool: draw instead of select/marquee. PRD §8.
    if (tool === "pencil") {
      beginDraw(e);
      return;
    }

    if (drawingMotionPath && motionPath) {
      beginMotionDrag(e);
      return;
    }

    // Grab on a layer's artwork: select-if-needed and begin a move (locked
    // artwork is inert).
    const el = (e.target as Element).closest?.(".layer[data-layer-id]");
    const id = el?.getAttribute("data-layer-id");
    if (id) {
      const layer = layers.find((l) => l.id === id);
      if (layer && !layer.locked) onLayerPointerDown(e, id, e.shiftKey);
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
      className="canvas-svg"
      onWheel={onWheel}
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
              fill={pencil.fillColor}
              stroke={pencil.fillColor}
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
          {motionPath && (
            <g className="motion-path-ui">
              <line
                ref={motionLineRef}
                className={motionPath.closed ? "motion-path-line closed" : "motion-path-line"}
                x1={motionPath.start.x}
                y1={motionPath.start.y}
                x2={motionPath.end.x}
                y2={motionPath.end.y}
              />
              <circle
                ref={motionStartRef}
                className="motion-path-start"
                cx={motionPath.start.x}
                cy={motionPath.start.y}
                r={7 * inv}
                onPointerDown={(e) => beginMotionDrag(e, "start")}
              />
              <circle
                ref={motionEndRef}
                className="motion-path-end"
                cx={motionPath.end.x}
                cy={motionPath.end.y}
                r={9 * inv}
                onPointerDown={(e) => beginMotionDrag(e, "end")}
              />
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
              {/* Selection action menu, drawn in screen px via scale(inv). */}
              <g
                className="gizmo-action-menu"
                transform={`translate(${gizmo.hw + GIZMO_DUP_GAP * inv},${-gizmo.hh - GIZMO_DUP_GAP * inv}) scale(${inv})`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {actionMenuOpen && (
                  <>
                    <g
                      className="gizmo-action"
                      transform="translate(0,-32)"
                      onClick={() => {
                        onDuplicateSelected();
                        setActionMenuOpen(false);
                      }}
                    >
                      <title>Duplicate selection</title>
                      <circle r={11} />
                      <path className="gizmo-icon" d="M -4 -3 H 3 V 4 H -4 Z M -1 -6 H 6 V 1" />
                    </g>
                    <g
                      className={canGroupSelection || canUngroupSelection ? "gizmo-action" : "gizmo-action disabled"}
                      transform="translate(32,0)"
                      onClick={() => {
                        if (canUngroupSelection) onUngroupSelection();
                        else if (canGroupSelection) onGroupSelection();
                        setActionMenuOpen(false);
                      }}
                    >
                      <title>{canUngroupSelection ? "Ungroup selection" : "Group selection"}</title>
                      <circle r={11} />
                      {canUngroupSelection ? (
                        <path className="gizmo-icon" d="M -6 -5 H -1 V 0 H -6 Z M 1 0 H 6 V 5 H 1 Z M -1 0 L 1 0" />
                      ) : (
                        <path className="gizmo-icon" d="M -6 -5 H -1 V 0 H -6 Z M 1 0 H 6 V 5 H 1 Z M -1 0 L 1 0" />
                      )}
                    </g>
                  </>
                )}
                <g
                  className="gizmo-action primary"
                  onClick={() => setActionMenuOpen((open) => !open)}
                >
                  <title>Selection actions</title>
                  <circle r={11} />
                  <path className="gizmo-plus" d="M -5 0 H 5 M 0 -5 V 5" />
                </g>
              </g>
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}

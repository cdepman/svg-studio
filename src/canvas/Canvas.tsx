// The <svg>, pan/zoom group, motif def, instances, and center handle.
//
// DOM OWNERSHIP (PRD §4): everything React renders here is STRUCTURE + COMMITTED
// values. During a gesture, useCenterDrag / the slider handlers mutate these
// same nodes' transforms imperatively and this component does NOT re-render.
// The refs (via `scene`) are how the imperative side reaches these nodes.
import { useEffect, useRef } from "react";
import {
  HANDLE_HIT_R,
  HANDLE_R,
  PROXY_CAP,
  isHeavy,
} from "../config";
import {
  instanceOpacity,
  instanceTransform,
  paintOrder,
  seamReach,
  seamWedgePath,
  subsetIndices,
  tuckIndices,
} from "./repeatMath";
import type { Scene } from "./useScene";
import type { Center, Motif, RepeatParams, Viewport } from "../types";

interface CanvasProps {
  motif: Motif;
  params: RepeatParams;
  center: Center;
  viewport: Viewport;
  /** True while any gesture is active. Drives the fidelity fallback. PRD §9. */
  dragging: boolean;
  scene: Scene;
  onCenterPointerDown: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  panBy: (dx: number, dy: number) => void;
}

export function Canvas({
  motif,
  params,
  center,
  viewport,
  dragging,
  scene,
  onCenterPointerDown,
  onWheel,
  panBy,
}: CanvasProps) {
  const { s, tx, ty } = viewport;
  const inv = 1 / s; // counter-scale so the handle stays a constant screen size

  // Fidelity fallback: a clean swap, not a per-frame decision. When heavy AND a
  // drag is active, render only a representative subset; the full render is
  // restored in one React commit on release. PRD §9.
  const heavy = isHeavy(params.count, motif.weight);
  const useProxy = heavy && dragging;
  // Paint in paintOrder (z-order) so the seam can be relocated. The proxy subset
  // is a drag-fidelity detail and ignores the offset.
  const indices = useProxy
    ? subsetIndices(params.count, PROXY_CAP)
    : paintOrder(params.count, params.paintOffset);

  // Tuck: redraw the first few painted copies clipped to a wedge straddling the
  // seam. Skipped while the proxy is active (a fidelity detail, not worth it
  // mid-drag). Wedge geometry depends on params + motif size, never the center.
  const showTuck = params.tuck && !useProxy;
  const tuckIdx = showTuck
    ? tuckIndices(params.count, params.paintOffset, params.seamBlend)
    : [];
  const wedgeD = seamWedgePath(params, seamReach(params, motif.box));

  // --- Pan: middle-drag or space-drag adjusts tx,ty. PRD §5. ---
  const spaceHeld = useRef(false);
  const panState = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
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

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const wantPan = e.button === 1 || (e.button === 0 && spaceHeld.current);
    if (!wantPan) return;
    e.preventDefault();
    panState.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!panState.current.active) return;
    // client-px delta == svg-local px delta (svg is 1:1, no viewBox).
    panBy(e.clientX - panState.current.lastX, e.clientY - panState.current.lastY);
    panState.current.lastX = e.clientX;
    panState.current.lastY = e.clientY;
  };
  const endPan = () => {
    panState.current.active = false;
  };

  const centerTransform = `translate(${center.x},${center.y})`;

  return (
    <svg
      ref={scene.svgRef}
      className="canvas"
      onWheel={onWheel}
      onPointerDown={onSvgPointerDown}
      onPointerMove={onSvgPointerMove}
      onPointerUp={endPan}
      onPointerLeave={endPan}
    >
      <g
        ref={scene.panZoomRef}
        transform={`translate(${tx},${ty}) scale(${s})`}
      >
        <defs>
          {/* Motif anchored so its center sits at local (0,0). PRD §6. */}
          <g
            id="motif"
            transform={`translate(${-motif.anchorX},${-motif.anchorY})`}
            dangerouslySetInnerHTML={{ __html: motif.innerHtml }}
          />
          {/* Seam wedge, in repeat-root LOCAL coords (userSpaceOnUse resolves at
              the clipped <g> inside repeat-root, so it inherits translate(cx,cy)
              and tracks the center for free). */}
          {showTuck && (
            <clipPath id="seam-wedge" clipPathUnits="userSpaceOnUse">
              <path ref={scene.seamPathRef} d={wedgeD} />
            </clipPath>
          )}
        </defs>

        {/* repeat-root: its transform changes during the center drag (imperative). */}
        <g ref={scene.repeatRootRef} className="repeat-root" transform={centerTransform}>
          {indices.map((i) => (
            <use
              key={i}
              data-i={i}
              className="instance"
              href="#motif"
              transform={instanceTransform(params, i)}
              opacity={instanceOpacity(params, i)}
            />
          ))}

          {/* The tuck: first k copies redrawn on top, clipped to the wedge, so
              copy 0 sits OVER the last-painted copy there — completing the cycle.
              Same .instance/data-i contract, so applyInstances updates them too.
              NOTE: with opacityStep < 1 the redraw double-blends inside the wedge
              (reads slightly darker); keep the wedge tight or relocate instead. */}
          {showTuck && (
            <g clipPath="url(#seam-wedge)">
              {tuckIdx.map((i) => (
                <use
                  key={`tuck-${i}`}
                  data-i={i}
                  className="instance"
                  href="#motif"
                  transform={instanceTransform(params, i)}
                  opacity={instanceOpacity(params, i)}
                />
              ))}
            </g>
          )}
        </g>

        {/* center-ui-root: ALSO translate(cx,cy), moved in lockstep. The handle
            lives here, not inside repeat-root, so it never inherits repeat
            clipping/styling but still tracks the center. PRD §4, §7. */}
        <g ref={scene.centerUiRootRef} className="center-ui-root" transform={centerTransform}>
          <line
            className="center-cross"
            x1={-HANDLE_R * inv}
            y1={0}
            x2={HANDLE_R * inv}
            y2={0}
            strokeWidth={1.5 * inv}
          />
          <line
            className="center-cross"
            x1={0}
            y1={-HANDLE_R * inv}
            x2={0}
            y2={HANDLE_R * inv}
            strokeWidth={1.5 * inv}
          />
          <circle
            className="center-handle"
            r={HANDLE_R * inv}
            strokeWidth={2 * inv}
          />
          {/* Generous, invisible hit target carries the drag. PRD §7. */}
          <circle
            className="center-hit"
            r={HANDLE_HIT_R * inv}
            onPointerDown={onCenterPointerDown}
          />
        </g>
      </g>
    </svg>
  );
}

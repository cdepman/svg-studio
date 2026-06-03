// One layer's artwork: its motif def and instances. When tuck is on, the ring is
// drawn as two complementary half-disks (see seamHalves) so the cyclic-overlap
// seam is hidden with no double-blend. When off (or in the drag proxy), it's a
// single normal pass.
//
// React.memo + a stable `layer` reference means a commit that changes ONE layer
// re-renders only that layer. A center/slider drag mutates the DOM imperatively
// and re-renders nothing here. PRD §11, §15.
import { memo } from "react";
import {
  instanceOpacity,
  instanceTransform,
  paintOrder,
  seamHalves,
  subsetIndices,
} from "./repeatMath";
import { PROXY_CAP } from "../config";
import { animationReachPadding, instanceMotionStyle, motionClassName } from "../motion/centerPath";
import type { Layer } from "../types";

interface LayerArtProps {
  layer: Layer;
  /** Render only a representative subset (drag-time fidelity fallback). PRD §9. */
  proxy: boolean;
  /** True only while CSS preview playback is actively moving instances. */
  animationsMoving: boolean;
}

function LayerArtImpl({ layer, proxy }: LayerArtProps) {
  const p = layer.params;
  const motifId = `motif-${layer.id}`;
  const oppClipId = `seam-opp-${layer.id}`;
  const seamClipId = `seam-half-${layer.id}`;

  const showTuck = p.tuck && !proxy;
  const halves = showTuck ? seamHalves(p, layer.motif.box, animationReachPadding(layer)) : null;

  // `alt` tags the second (seam-half) pass so the two passes are distinguishable;
  // both carry `instance` so the imperative sweep updates them together.
  const instanceKeyPrefix = layer.animation?.enabled
    ? `${p.count}:${p.angleOffset}:${p.radiusOffset}:${layer.scale}`
    : "";
  const Use = (i: number, alt = false) => (
    <g
      key={`${instanceKeyPrefix}:${alt ? `${i}-alt` : i}`}
      className={`instance-motion-wrapper motion-wrapper ${motionClassName(layer.id)}`}
      style={instanceMotionStyle(layer, i)}
    >
      <g
        data-i={i}
        className="instance-placement"
        transform={instanceTransform(p, i)}
        opacity={instanceOpacity(p, i)}
      >
        <g className="instance-follow-wrapper">
          <use
            data-i={i}
            className={alt ? "instance alt" : "instance"}
            href={`#${motifId}`}
          />
        </g>
      </g>
    </g>
  );

  return (
    <g className="layer" data-layer-id={layer.id}>
      <defs>
        {/* Motif anchored so its center sits at local (0,0). */}
        <g
          id={motifId}
          transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}
          dangerouslySetInnerHTML={{ __html: layer.motif.innerHtml }}
        />
        {halves && (
          <>
            <clipPath id={oppClipId} clipPathUnits="userSpaceOnUse">
              <path data-seam-opp-for={layer.id} d={halves.oppHalfD} />
            </clipPath>
            <clipPath id={seamClipId} clipPathUnits="userSpaceOnUse">
              <path data-seam-half-for={layer.id} d={halves.seamHalfD} />
            </clipPath>
          </>
        )}
      </defs>

      {/* layer-center-root: its translate changes during moves. Each repeated
          item gets its own motion-wrapper so synchronized path animation is
          applied per copy, not once to the whole layer. */}
      <g
        className="layer-center-root"
        transform={`translate(${layer.center.x},${layer.center.y})`}
      >
        <g className="repeat-root">
          <g className="repeat-scale" transform={`scale(${layer.scale})`}>
            {halves ? (
              <>
                {/* Half opposite the seam: normal order (its seam is excluded here). */}
                <g clipPath={`url(#${oppClipId})`}>{halves.oppOrder.map((i) => Use(i))}</g>
                {/* Half containing the seam: order rotated 180° (its seam is on the
                    far side, excluded here). Complementary clips => no double-blend. */}
                <g clipPath={`url(#${seamClipId})`}>{halves.seamOrder.map((i) => Use(i, true))}</g>
              </>
            ) : (
              (proxy ? subsetIndices(p.count, PROXY_CAP) : paintOrder(p.count, p.paintOffset)).map((i) => Use(i))
            )}
          </g>
        </g>
      </g>
    </g>
  );
}

export const LayerArt = memo(LayerArtImpl);

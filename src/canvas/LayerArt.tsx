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
  instanceLocalTransform,
  instanceSpokeTransform,
  instanceTransform,
  paintOrder,
  seamHalves,
  subsetIndices,
} from "./repeatMath";
import { PROXY_CAP } from "../config";
import { animationReachPadding, motionClassName } from "../motion/centerPath";
import { effectsReachPadding, instanceEffectStyle, isLayerAnimated } from "../motion/effects";
import { recolorMarkup } from "../motif/recolor";
import { partTransformAttr } from "../motif/parts";
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

  const animated = isLayerAnimated(layer);
  const showTuck = p.tuck && !proxy;
  const halves = showTuck
    ? seamHalves(p, layer.motif.box, animationReachPadding(layer) + effectsReachPadding(layer))
    : null;
  const e = layer.effects;
  const compositeSpin = !!e?.compositeSpin.enabled;

  // Per-component fill: one recolored <defs> entry per distinct override color,
  // so each instance <use> can point at its own colored source. PRD components.
  const overrideColors = Array.from(
    new Set(Object.values(layer.components).map((c) => c.fill).filter((f): f is string => !!f))
  );
  const colorDefId = new Map(overrideColors.map((c, n) => [c, `${motifId}-c${n}`]));
  const hrefForIndex = (i: number) => {
    const f = layer.components[i]?.fill;
    return f ? `#${colorDefId.get(f)}` : `#${motifId}`;
  };

  // `alt` tags the second (seam-half) pass so the two passes are distinguishable;
  // both carry `instance` so the imperative sweep updates them together. The
  // effects signature is in the key so toggling an effect remounts cleanly.
  const effectSig = e
    ? `${+e.individualSpin.enabled}${+e.compositeSpin.enabled}${+e.scalePulse.enabled}${+e.radialPulse.enabled}`
    : "";
  const instanceKeyPrefix = animated
    ? `${p.count}:${p.angleOffset}:${p.radiusOffset}:${layer.scale}:${effectSig}`
    : "";
  const Use = (i: number, alt = false) => (
    <g key={`${instanceKeyPrefix}:${alt ? `${i}-alt` : i}`}>
      <g
        data-i={i}
        className="instance-placement"
        transform={animated ? instanceSpokeTransform(p, i) : instanceTransform(p, i)}
        opacity={instanceOpacity(p, i)}
      >
        {/* radial-pulse wrapper: translateX runs along the spoke (outward). */}
        <g className="instance-radial-wrapper" style={instanceEffectStyle(layer, i)}>
          <g className={`instance-motion-wrapper motion-wrapper ${motionClassName(layer.id)}`}>
            <g className="instance-local-transform" transform={animated ? instanceLocalTransform(p, i) : undefined}>
              {/* spin + pulse wrappers rotate/scale the copy about its own center. */}
              <g className="instance-spin-wrapper">
                <g className="instance-pulse-wrapper">
                  <g className="instance-follow-wrapper">
                    <use data-i={i} className={alt ? "instance alt" : "instance"} href={hrefForIndex(i)} />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );

  return (
    <g className="layer" data-layer-id={layer.id}>
      <defs>
        {/* Motif anchored so its center sits at local (0,0). When the motif has
            addressable parts, render them as individual groups (tagged for live
            imperative part-drag) instead of one opaque blob. */}
        {layer.motif.parts ? (
          <g id={motifId} transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}>
            {layer.motif.defs && <g dangerouslySetInnerHTML={{ __html: layer.motif.defs }} />}
            {layer.motif.parts
              .filter((part) => part.visible)
              .map((part) => (
                <g
                  key={part.id}
                  data-part-render={part.id}
                  transform={partTransformAttr(part.transform, part.cx, part.cy) ?? undefined}
                  dangerouslySetInnerHTML={{ __html: part.fill ? recolorMarkup(part.baseMarkup, part.fill) : part.baseMarkup }}
                />
              ))}
          </g>
        ) : (
          <g
            id={motifId}
            transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}
            dangerouslySetInnerHTML={{ __html: layer.motif.innerHtml }}
          />
        )}
        {overrideColors.map((c) => (
          <g
            key={c}
            id={colorDefId.get(c)}
            transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}
            dangerouslySetInnerHTML={{ __html: recolorMarkup(layer.motif.innerHtml, c) }}
          />
        ))}
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
        <g className={compositeSpin ? `repeat-root composite-spin ${motionClassName(layer.id)}-composite` : "repeat-root"}>
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

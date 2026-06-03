import { angleStep } from "../canvas/repeatMath";
import type { CSSProperties } from "react";
import type { Center, CenterPathAnimation, Layer, LayerAnimation, RepeatParams } from "../types";

export const DEFAULT_CENTER_PATH_OFFSET = 160;

function rotate(v: Center, degrees: number): Center {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function referenceInstancePointForGeometry(
  params: RepeatParams,
  center: Center,
  scale: number
): Center {
  const angle = (params.angleOffset * Math.PI) / 180;
  const radius = params.radiusOffset * scale;
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

export function referenceInstancePoint(layer: Layer): Center {
  return referenceInstancePointForGeometry(layer.params, layer.center, layer.scale);
}

export function createCenterPathAnimation(layer: Layer, end?: Center): CenterPathAnimation {
  const start = referenceInstancePoint(layer);
  const outward = rotate({ x: DEFAULT_CENTER_PATH_OFFSET, y: 0 }, layer.params.angleOffset);
  const target = end ?? { x: start.x + outward.x, y: start.y + outward.y };
  return {
    enabled: true,
    type: "centerPath",
    path: { points: [start, target], closed: false },
    durationSeconds: 4,
    delaySeconds: 0,
    easing: "linear",
    direction: "out-and-back",
    orientationMode: "fixed",
    closed: false,
  };
}

export function animationPoints(animation: CenterPathAnimation, fallbackStart: Center) {
  const start = animation.path.points[0] ?? fallbackStart;
  const end = animation.path.points[1] ?? start;
  return { start, end };
}

export function translateCenterPathAnimation(
  animation: CenterPathAnimation | undefined,
  delta: Center
): CenterPathAnimation | undefined {
  if (!animation) return undefined;
  return {
    ...animation,
    path: {
      ...animation.path,
      points: animation.path.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
    },
  };
}

export function motionClassName(layerId: string) {
  return `motion-${layerId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function instanceMotionVectorForGeometry(
  params: RepeatParams,
  scale: number,
  raw: LayerAnimation | undefined,
  fallbackStart: Center,
  index: number
) {
  if (!raw || raw.type !== "centerPath") return null;
  const animation = normalizedAnimation(raw);
  const { start, end } = animationPoints(animation, fallbackStart);
  const refDelta = { x: end.x - start.x, y: end.y - start.y };
  const worldDelta = rotate(refDelta, index * angleStep(params.count));
  const safeScale = scale || 1;
  return {
    dx: worldDelta.x / safeScale,
    dy: worldDelta.y / safeScale,
    angle: Math.atan2(worldDelta.y, worldDelta.x) * (180 / Math.PI),
  };
}

export function instanceMotionVector(layer: Layer, index: number) {
  return instanceMotionVectorForGeometry(
    layer.params,
    layer.scale,
    layer.animation,
    referenceInstancePoint(layer),
    index
  );
}

export function instanceMotionStyle(layer: Layer, index: number): CSSProperties | undefined {
  if (!layer.animation?.enabled) return undefined;
  const v = instanceMotionVector(layer, index);
  if (!v) return undefined;
  return {
    "--motion-dx": `${v.dx}px`,
    "--motion-dy": `${v.dy}px`,
    "--motion-angle": `${v.angle}deg`,
  } as CSSProperties;
}

export function instanceMotionStyleText(layer: Layer, index: number) {
  if (!layer.animation?.enabled) return "";
  const v = instanceMotionVector(layer, index);
  if (!v) return "";
  return ` style="--motion-dx:${v.dx}px;--motion-dy:${v.dy}px;--motion-angle:${v.angle}deg"`;
}

export function motionPathD(animation: CenterPathAnimation, layerCenter: Center) {
  const { start, end } = animationPoints(animation, layerCenter);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return animation.closed || animation.path.closed ? `M 0 0 L ${dx} ${dy} L 0 0` : `M 0 0 L ${dx} ${dy}`;
}

export function directionForCss(animation: CenterPathAnimation) {
  return animation.direction === "out-and-back" ? "alternate" : "normal";
}

export function normalizedAnimation(animation: CenterPathAnimation): CenterPathAnimation {
  if (animation.direction !== "loop") return animation;
  return {
    ...animation,
    closed: true,
    path: { ...animation.path, closed: true },
  };
}

export function centerPathCss(layer: Layer, playing: boolean) {
  const raw = layer.animation;
  if (!raw || raw.type !== "centerPath" || !raw.enabled) return "";
  const animation = normalizedAnimation(raw);
  const klass = motionClassName(layer.id);
  const keyframes = `${klass}-keyframes`;
  const rotateKeyframes = `${klass}-rotate-keyframes`;
  const follow = animation.orientationMode === "followPath";
  const middle = animation.closed || animation.path.closed
    ? `  50% { transform: translate(var(--motion-dx), var(--motion-dy)); }
  100% { transform: translate(0, 0); }`
    : `  to { transform: translate(var(--motion-dx), var(--motion-dy)); }`;
  const rotateMiddle = animation.closed || animation.path.closed
    ? `  50% { transform: rotate(var(--motion-angle)); }
  100% { transform: rotate(0deg); }`
    : `  to { transform: rotate(var(--motion-angle)); }`;
  return `
.${klass} {
  transform: translate(0, 0);
  animation: ${keyframes} ${animation.durationSeconds}s ${animation.easing} ${animation.delaySeconds}s infinite;
  animation-direction: ${directionForCss(animation)};
  animation-play-state: ${playing ? "running" : "paused"};
}
@keyframes ${keyframes} {
  from { transform: translate(0, 0); }
${middle}
}${
    follow
      ? `
.${klass} .instance-follow-wrapper {
  transform: rotate(0deg);
  animation: ${rotateKeyframes} ${animation.durationSeconds}s ${animation.easing} ${animation.delaySeconds}s infinite;
  animation-direction: ${directionForCss(animation)};
  animation-play-state: ${playing ? "running" : "paused"};
}
@keyframes ${rotateKeyframes} {
  from { transform: rotate(0deg); }
${rotateMiddle}
}`
      : ""
  }`;
}

export function centerPathStyles(layers: Layer[], playing: boolean) {
  return layers.map((layer) => centerPathCss(layer, playing)).filter(Boolean).join("\n");
}

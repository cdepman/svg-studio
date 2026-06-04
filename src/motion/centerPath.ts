import type { Center, CenterPathAnimation, Layer, LayerAnimation, RepeatParams } from "../types";

export const DEFAULT_CENTER_PATH_OFFSET = 160;

function rotate(v: Center, degrees: number): Center {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

const num = (n: number) => (Object.is(Math.round(n * 1e4) / 1e4, -0) ? "0" : String(Math.round(n * 1e4) / 1e4));

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
  const end = animation.path.points[animation.path.points.length - 1] ?? start;
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

/**
 * A smooth SVG path `d` through `points` (Catmull-Rom → cubic Bézier). 2 points
 * stay a straight line; `closed` appends Z (and wraps the tangents). Used for
 * both the offset-path keyframe target and the on-canvas preview.
 */
export function smoothPathD(points: Center[], closed = false): string {
  const p = points;
  if (p.length < 2) return "";
  if (p.length === 2) {
    return `M ${num(p[0].x)} ${num(p[0].y)} L ${num(p[1].x)} ${num(p[1].y)}${closed ? " Z" : ""}`;
  }
  const last = p.length - 1;
  let d = `M ${num(p[0].x)} ${num(p[0].y)}`;
  for (let i = 0; i < last; i++) {
    const p0 = p[i === 0 ? (closed ? last : 0) : i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2 > last ? (closed ? 0 : last) : i + 2];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(p2.x)} ${num(p2.y)}`;
  }
  if (closed) d += " Z";
  return d;
}

/**
 * The motion path expressed in copy-0's LOCAL frame: every point taken relative
 * to the path's first point (so the copy starts at rest = (0,0)), un-rotated by
 * the spoke angle, and divided by layer scale (the motion-wrapper sits inside
 * repeat-scale). Each copy applies these same offsets in its own rotated frame,
 * so the whole ring follows the path in radial symmetry. Null if < 2 points.
 */
export function motionLocalPoints(params: RepeatParams, scale: number, raw: LayerAnimation | undefined): Center[] | null {
  if (!raw || raw.type !== "centerPath" || raw.path.points.length < 2) return null;
  const animation = normalizedAnimation(raw);
  const pts = animation.path.points;
  const p0 = pts[0];
  const s = scale || 1;
  return pts.map((pt) => {
    const v = rotate({ x: pt.x - p0.x, y: pt.y - p0.y }, -params.angleOffset);
    return { x: v.x / s, y: v.y / s };
  });
}

/** Farthest a copy travels from its rest position, in world px (for seam/bounds). */
export function animationReachPaddingForGeometry(
  _params: RepeatParams,
  _scale: number,
  raw: LayerAnimation | undefined,
  _referencePoint?: Center
) {
  if (!raw || raw.type !== "centerPath" || !raw.enabled || raw.path.points.length < 2) return 0;
  const p0 = raw.path.points[0];
  let max = 0;
  for (const pt of raw.path.points) max = Math.max(max, Math.hypot(pt.x - p0.x, pt.y - p0.y));
  return max; // already world px (points are world coords)
}

export function animationReachPadding(layer: Layer) {
  return animationReachPaddingForGeometry(layer.params, layer.scale, layer.animation);
}

/**
 * CSS for one layer's center-path motion: the motion-wrapper (`.motion-{id}`)
 * `translate`s through the path's local points (so 0% = translate(0,0) = rest —
 * adding a path never shifts the artwork). For "follow path", the follow-wrapper
 * rotates to the path tangent at each stop. One per-layer rule drives every copy
 * (each copy applies it in its own rotated frame → radial symmetry).
 */
export function centerPathCss(layer: Layer, playing: boolean) {
  const raw = layer.animation;
  if (!raw || raw.type !== "centerPath" || !raw.enabled) return "";
  const animation = normalizedAnimation(raw);
  const local = motionLocalPoints(layer.params, layer.scale, raw);
  if (!local || local.length < 2) return "";
  const klass = motionClassName(layer.id);
  const closed = animation.closed || animation.path.closed;
  const follow = animation.orientationMode === "followPath";
  const stops = closed ? [...local, local[0]] : local; // a closed loop returns to start
  const n = stops.length;
  const at = (i: number) => num((i / (n - 1)) * 100);
  const timing = `${animation.durationSeconds}s ${animation.easing} ${animation.delaySeconds}s infinite`;
  const playState = playing ? "running" : "paused";

  const moveKf = stops.map((p, i) => `  ${at(i)}% { transform: translate(${num(p.x)}px, ${num(p.y)}px); }`).join("\n");

  let rotateBlock = "";
  if (follow) {
    const angleAt = (i: number) => {
      const a = stops[Math.min(i, n - 2)];
      const b = stops[Math.min(i, n - 2) + 1];
      return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    };
    const rotKf = stops.map((_, i) => `  ${at(i)}% { transform: rotate(${num(angleAt(i))}deg); }`).join("\n");
    rotateBlock = `
.${klass} .instance-follow-wrapper {
  animation: ${klass}-rotate ${timing};
  animation-direction: ${directionForCss(animation)};
  animation-play-state: ${playState};
}
@keyframes ${klass}-rotate {
${rotKf}
}`;
  }

  return `
.${klass} {
  animation: ${klass}-keyframes ${timing};
  animation-direction: ${directionForCss(animation)};
  animation-play-state: ${playState};
}
@keyframes ${klass}-keyframes {
${moveKf}
}${rotateBlock}`;
}

export function centerPathStyles(layers: Layer[], playing: boolean) {
  return layers.map((layer) => centerPathCss(layer, playing)).filter(Boolean).join("\n");
}

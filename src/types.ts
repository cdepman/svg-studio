// Orientation is a single enum, never two booleans. Two booleans can express
// invalid states ("neither" / "both"); the enum cannot. See PRD §1, §8.
export type OrientationMode = "rotateWithCircle" | "keepUpright";

/** Committed parameters of the single radial repeat. Center is tracked separately. */
export interface RepeatParams {
  count: number;
  angleOffset: number;
  /** Distance from the repeat center to the motif anchor (motif center). PRD §8. */
  radiusOffset: number;
  sourceRotation: number;
  orientationMode: OrientationMode;
  mirrorAlternates: boolean;
  // Secondary controls (PRD §1): progressive across copies.
  scaleStep: number;
  opacityStep: number;

  // --- Seam handling (the card-loop paradox: there is always exactly one seam
  // between the last-painted and first-painted copy; you can move it or hide it,
  // never delete it). ---

  /**
   * Relocate the seam by rotating the PAINT order (not the geometry). The seam
   * always falls between the last- and first-painted copy, so this picks which
   * angular gap it lands in — drop it at the back or in a dense region. 0..count-1.
   */
  paintOffset: number;
  /** Tuck: after painting all copies, redraw the first few clipped to a wedge
   *  straddling the seam, so the overlap reads continuous all the way around. */
  tuck: boolean;
  /** Wedge "blend": how many copies to redraw / how many angular steps the wedge
   *  spans. Roughly how many neighbors a petal laps. Tune by eye. Integer >= 1. */
  seamBlend: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sanitized, anchor-normalized imported (or default) motif. */
export interface Motif {
  /** Sanitized inner SVG markup, mounted via <g id="motif"> in <defs>. */
  innerHtml: string;
  /** Intrinsic center (icx, icy) = box center. The motif is offset by -anchor. PRD §6. */
  anchorX: number;
  anchorY: number;
  /** Intrinsic box, for export and fit-to-view. PRD §6. */
  box: Box;
  /** Paintable element count, for the heavy-scene estimate. PRD §9. */
  weight: number;
  /** True if sanitization altered the markup (changed counts / removed style/filter). PRD §11. */
  simplified: boolean;
}

export interface Center {
  x: number;
  y: number;
}

export type AnimationEasing = "linear" | "ease-in-out" | "ease-in" | "ease-out";
export type CenterPathDirection = "out" | "out-and-back" | "loop";
export type CenterPathOrientation = "fixed" | "followPath";

export interface MotionPath {
  points: Center[];
  closed: boolean;
}

export interface CenterPathAnimation {
  enabled: boolean;
  type: "centerPath";
  path: MotionPath;
  durationSeconds: number;
  delaySeconds: number;
  easing: AnimationEasing;
  direction: CenterPathDirection;
  orientationMode: CenterPathOrientation;
  closed: boolean;
}

export type LayerAnimation = CenterPathAnimation;

export interface LayerGroup {
  id: string;
  name: string;
  layerIds: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * A flat layer: one radial-repeat composition. No nesting, no folders. PRD §4.
 * `center` is kept off RepeatParams on purpose so the repeat math stays
 * center-independent (instances never reference the center).
 */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  motif: Motif;
  params: RepeatParams;
  center: Center;
  /** Uniform scale of the whole composition (ring + petals). Resize gizmo. */
  scale: number;
  /** Optional straight-line center-path animation. */
  animation?: LayerAnimation;
  createdAt: number;
  updatedAt: number;
}

export interface Viewport {
  tx: number;
  ty: number;
  s: number;
}

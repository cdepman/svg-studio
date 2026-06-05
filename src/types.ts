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
  /** Uniform size of each copy on its own center (resize one petal => all). 1 = intrinsic. */
  sourceScale: number;
  orientationMode: OrientationMode;
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

/** Non-destructive per-part transform, applied about the part's own center. */
export interface PartTransform {
  tx: number;
  ty: number;
  /** Degrees, about (cx,cy). */
  rotation: number;
  scale: number;
}

export const IDENTITY_PART_TRANSFORM: PartTransform = { tx: 0, ty: 0, rotation: 0, scale: 1 };

/**
 * One addressable piece of a motif — a single paintable element (with its
 * ancestor transforms baked into `baseMarkup`), so an imported SVG's sub-paths
 * become first-class objects. Edits are non-destructive: `baseMarkup` is the
 * imported geometry; `transform` and `fill` layer on top and the rendered markup
 * is derived from them. PRD §6.
 */
export interface MotifPart {
  id: string;
  /** Display name in the layer tree (element id, nearest group id, or "Path N"). */
  name: string;
  /** Element markup as imported: own + ancestor transforms baked in. Immutable. */
  baseMarkup: string;
  /** Intrinsic center of `baseMarkup` in motif-local space — the rotate/scale pivot. */
  cx: number;
  cy: number;
  /** Intrinsic bounding-box size in motif-local space — for the on-canvas hit-rect. */
  w: number;
  h: number;
  /** Editable move/rotate/scale layered on top of `baseMarkup`. */
  transform: PartTransform;
  /** Editable non-destructive color override (fill + stroke). */
  fill?: string;
  visible: boolean;
}

/** A sanitized, anchor-normalized imported (or default) motif. */
export interface Motif {
  /**
   * Sanitized inner SVG markup, mounted via <g id="motif"> in <defs>. This is
   * the single rendered source of truth — when `parts` exist it is kept derived
   * from them (defs preamble + visible parts). PRD §6, §11.
   */
  innerHtml: string;
  /** Addressable sub-parts (imported SVGs / drawn shapes). Absent for legacy motifs. */
  parts?: MotifPart[];
  /** Non-paintable preamble (e.g. <defs>/gradients) preserved across part edits. */
  defs?: string;
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

/** Editor modes: design the unit, arrange the repeat, animate it. */
export type EditorMode = "design" | "arrange" | "animate";
/** How the Design canvas frames the active motif vs. its repeated preview. */
export type DesignView = "context" | "isolated" | "full";

// --- Concurrent, looping ambient effects (independent of the center path).
// Each is realized as an infinite CSS @keyframes loop; they compose with each
// other and with the center-path motion. PRD §ANIM.
export type EffectDirection = "cw" | "ccw";

/** Each copy rotates around its own center. `stagger` sends the spin around the ring. */
export interface IndividualSpinEffect {
  enabled: boolean;
  periodSeconds: number;
  direction: EffectDirection;
  stagger: boolean;
}
/** The whole ring rotates around the layer center. */
export interface CompositeSpinEffect {
  enabled: boolean;
  periodSeconds: number;
  direction: EffectDirection;
}
/** Copies breathe (scale up/down). `amount` is the peak extra scale (0..1). */
export interface ScalePulseEffect {
  enabled: boolean;
  periodSeconds: number;
  amount: number;
  stagger: boolean;
}
/** Copies move in/out along their spoke. `amount` is world px of travel. */
export interface RadialPulseEffect {
  enabled: boolean;
  periodSeconds: number;
  amount: number;
  stagger: boolean;
}
/** Copies ripple perpendicular to their spoke, like a travelling wave around the ring. */
export interface WaveEffect {
  enabled: boolean;
  periodSeconds: number;
  amount: number;
  frequency: number;
  direction: EffectDirection;
  stagger: boolean;
}
export interface LayerEffects {
  individualSpin: IndividualSpinEffect;
  compositeSpin: CompositeSpinEffect;
  scalePulse: ScalePulseEffect;
  radialPulse: RadialPulseEffect;
  wave: WaveEffect;
}

export interface LayerGroup {
  id: string;
  name: string;
  layerIds: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Per-component (per-instance) overrides on top of the parametric repeat. The
 * base arrangement (count/radius/angle/rotation) stays symmetric; individual
 * components can override their appearance. Keyed by instance index (sparse).
 * Extensible — today just fill, later individual transform etc.
 */
export interface ComponentOverride {
  fill?: string;
}

export type ComponentOverrides = Record<number, ComponentOverride>;

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
  /** Per-component overrides (color now). Sparse, keyed by instance index. */
  components: ComponentOverrides;
  /** Optional straight-line center-path animation. */
  animation?: LayerAnimation;
  /** Optional concurrent looping effects (spin/pulse), independent of `animation`. */
  effects?: LayerEffects;
  createdAt: number;
  updatedAt: number;
}

export interface Viewport {
  tx: number;
  ty: number;
  s: number;
}

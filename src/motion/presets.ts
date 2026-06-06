import type { LayerEffects, RepeatParams } from "../types";

export interface AnimationPreset {
  id: string;
  name: string;
  hint: string;
  effects: LayerEffects;
  params?: Partial<RepeatParams>;
}

const off: LayerEffects = {
  individualSpin: { enabled: false, periodSeconds: 6, direction: "cw", stagger: false },
  compositeSpin: { enabled: false, periodSeconds: 12, direction: "cw" },
  scalePulse: { enabled: false, periodSeconds: 3, amount: 0.2, stagger: false },
  radialPulse: { enabled: false, periodSeconds: 3, amount: 40, stagger: false },
  wave: { enabled: false, periodSeconds: 4, amount: 40, frequency: 3, direction: "cw", stagger: false },
};

const preset = (p: AnimationPreset): AnimationPreset => p;

export const ANIMATION_PRESETS: AnimationPreset[] = [
  preset({
    id: "jelly-pulse",
    name: "Jelly Pulse",
    hint: "Fast spin, quick breathing, and a soft radius pulse.",
    effects: {
      ...off,
      individualSpin: { enabled: true, periodSeconds: 5, direction: "ccw", stagger: false },
      compositeSpin: { enabled: true, periodSeconds: 13.1, direction: "ccw" },
      scalePulse: { enabled: true, periodSeconds: 2.5, amount: 0.31, stagger: false },
      radialPulse: { enabled: true, periodSeconds: 5.2, amount: 35, stagger: false },
    },
    params: { count: 24, radiusOffset: 146, sourceRotation: 180, orientationMode: "rotateWithCircle" },
  }),
  preset({
    id: "needle-thread",
    name: "Needle Thread",
    hint: "Faithful timing from the VDJ needle-and-thread preset.",
    effects: {
      ...off,
      individualSpin: { enabled: true, periodSeconds: 11.6, direction: "ccw", stagger: false },
      compositeSpin: { enabled: true, periodSeconds: 26.2, direction: "ccw" },
      scalePulse: { enabled: true, periodSeconds: 3, amount: 0.16, stagger: false },
      radialPulse: { enabled: true, periodSeconds: 20.9, amount: 85, stagger: false },
    },
    params: { count: 24, radiusOffset: 197, sourceRotation: 150, orientationMode: "rotateWithCircle" },
  }),
  preset({
    id: "cup-orbit",
    name: "Cup Orbit",
    hint: "Big synchronized breathing with a slow turn.",
    effects: {
      ...off,
      individualSpin: { enabled: true, periodSeconds: 15, direction: "ccw", stagger: false },
      compositeSpin: { enabled: true, periodSeconds: 26.2, direction: "ccw" },
      scalePulse: { enabled: true, periodSeconds: 8.7, amount: 0.48, stagger: false },
      radialPulse: { enabled: true, periodSeconds: 8.7, amount: 164, stagger: false },
    },
    params: { count: 45, radiusOffset: 197, sourceRotation: 180, orientationMode: "rotateWithCircle" },
  }),
  preset({
    id: "mane-bloom",
    name: "Mane Bloom",
    hint: "Fast petal spin with staggered size variation.",
    effects: {
      ...off,
      individualSpin: { enabled: true, periodSeconds: 3.3, direction: "ccw", stagger: false },
      compositeSpin: { enabled: true, periodSeconds: 20.9, direction: "ccw" },
      scalePulse: { enabled: true, periodSeconds: 2.5, amount: 0.31, stagger: true },
      radialPulse: { enabled: true, periodSeconds: 5.2, amount: 35, stagger: false },
    },
    params: { count: 24, radiusOffset: 146, sourceRotation: 180, orientationMode: "rotateWithCircle" },
  }),
  preset({
    id: "optical-wave",
    name: "Optical Wave",
    hint: "Needle timing plus a fast tangential ripple.",
    effects: {
      ...off,
      individualSpin: { enabled: true, periodSeconds: 11.6, direction: "ccw", stagger: false },
      scalePulse: { enabled: true, periodSeconds: 3, amount: 0.16, stagger: false },
      radialPulse: { enabled: true, periodSeconds: 20.9, amount: 85, stagger: false },
      wave: { enabled: true, periodSeconds: 1.7, amount: 40, frequency: 11, direction: "ccw", stagger: true },
    },
    params: { count: 34, radiusOffset: 230, sourceRotation: 150, orientationMode: "rotateWithCircle" },
  }),
  preset({
    id: "tomopteris-surge",
    name: "Tomopteris Surge",
    hint: "Dense repeat count with huge staggered radial motion.",
    effects: {
      ...off,
      individualSpin: { enabled: true, periodSeconds: 3.4, direction: "ccw", stagger: false },
      compositeSpin: { enabled: true, periodSeconds: 11.6, direction: "ccw" },
      radialPulse: { enabled: true, periodSeconds: 2.1, amount: 200, stagger: true },
    },
    params: { count: 128, radiusOffset: 139, sourceRotation: 0, orientationMode: "rotateWithCircle" },
  }),
];

export function cloneEffects(effects: LayerEffects): LayerEffects {
  return {
    individualSpin: { ...effects.individualSpin },
    compositeSpin: { ...effects.compositeSpin },
    scalePulse: { ...effects.scalePulse },
    radialPulse: { ...effects.radialPulse },
    wave: { ...effects.wave },
  };
}

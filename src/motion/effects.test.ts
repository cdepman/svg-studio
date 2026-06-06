import { describe, expect, it } from "vitest";
import { anyEffectEnabled, effectsCss, effectsReachPadding, instanceEffectStyle, isLayerAnimated } from "./effects";
import type { Layer, LayerEffects, Motif, RepeatParams } from "../types";

const params: RepeatParams = {
  count: 8,
  angleOffset: 0,
  radiusOffset: 100,
  sourceRotation: 0,
  sourceScale: 1,
  orientationMode: "rotateWithCircle",
  scaleStep: 0,
  opacityStep: 0,
  paintOffset: 0,
  tuck: false,
  seamBlend: 2,
};
const motif: Motif = {
  innerHtml: "<rect width='10' height='10'/>",
  anchorX: 5,
  anchorY: 5,
  box: { x: 0, y: 0, width: 10, height: 10 },
  weight: 1,
  simplified: false,
};
const allOff: LayerEffects = {
  individualSpin: { enabled: false, periodSeconds: 6, direction: "cw", stagger: false },
  compositeSpin: { enabled: false, periodSeconds: 12, direction: "cw" },
  scalePulse: { enabled: false, periodSeconds: 3, amount: 0.2, stagger: false },
  radialPulse: { enabled: false, periodSeconds: 3, amount: 40, stagger: false },
  wave: { enabled: false, periodSeconds: 4, amount: 40, frequency: 3, direction: "cw", stagger: false },
};
const layer = (effects?: Partial<LayerEffects>, scale = 1): Layer => ({
  id: "L1",
  name: "L",
  visible: true,
  locked: false,
  motif,
  params,
  center: { x: 0, y: 0 },
  scale,
  components: {},
  effects: effects ? { ...allOff, ...effects } : undefined,
  createdAt: 0,
  updatedAt: 0,
});

describe("effects: enabled detection", () => {
  it("anyEffectEnabled / isLayerAnimated truth table", () => {
    expect(anyEffectEnabled(undefined)).toBe(false);
    expect(anyEffectEnabled(allOff)).toBe(false);
    expect(anyEffectEnabled({ ...allOff, individualSpin: { ...allOff.individualSpin, enabled: true } })).toBe(true);
    expect(isLayerAnimated(layer())).toBe(false);
    expect(isLayerAnimated(layer({ compositeSpin: { ...allOff.compositeSpin, enabled: true } }))).toBe(true);
  });
});

describe("effects: CSS emission", () => {
  it("emits keyframes only for enabled effects", () => {
    const css = effectsCss(layer({ individualSpin: { ...allOff.individualSpin, enabled: true } }), true);
    expect(css).toContain("@keyframes motion-L1-spin");
    expect(css).toContain(".instance-spin-wrapper");
    expect(css).not.toContain("-composite-spin");
    expect(css).not.toContain("-pulse");
    expect(css).not.toContain("-radial");
    expect(css).not.toContain("-wave");
  });

  it("maps cw->normal and ccw->reverse", () => {
    expect(effectsCss(layer({ individualSpin: { ...allOff.individualSpin, enabled: true, direction: "cw" } }), true))
      .toContain("animation-direction: normal");
    expect(effectsCss(layer({ individualSpin: { ...allOff.individualSpin, enabled: true, direction: "ccw" } }), true))
      .toContain("animation-direction: reverse");
  });

  it("gates play-state on the playing flag", () => {
    const on = { individualSpin: { ...allOff.individualSpin, enabled: true } };
    expect(effectsCss(layer(on), true)).toContain("animation-play-state: running");
    expect(effectsCss(layer(on), false)).toContain("animation-play-state: paused");
  });

  it("composite spin targets the -composite class on repeat-root", () => {
    const css = effectsCss(layer({ compositeSpin: { ...allOff.compositeSpin, enabled: true } }), true);
    expect(css).toContain(".motion-L1-composite {");
    expect(css).toContain("@keyframes motion-L1-composite-spin");
  });

  it("scale and radial pulse oscillate around the base value", () => {
    const css = effectsCss(layer({
      scalePulse: { ...allOff.scalePulse, enabled: true, amount: 0.5, periodSeconds: 4 },
      radialPulse: { ...allOff.radialPulse, enabled: true, amount: 60, periodSeconds: 8 },
    }), true);
    expect(css).toContain("animation: motion-L1-pulse 4s");
    expect(css).toContain("transform: scale(1.5)"); // peak
    expect(css).toContain("transform: scale(0.5)"); // trough
    // Smooth grow↔shrink: no neutral-size keyframe, so it never stops mid-cycle.
    expect(css).not.toContain("transform: scale(1);");
    expect(css).toContain("animation: motion-L1-radial 8s");
    // Radiate = a clean outward bloom and return (no inward half, no rest-point stutter).
    expect(css).toContain("translateX(var(--radial-amt, 0px))");
    expect(css).not.toContain("translateX(calc(var(--radial-amt, 0px) * -1))");
  });

  it("emits tangent wave keyframes and direction", () => {
    const css = effectsCss(layer({ wave: { ...allOff.wave, enabled: true, direction: "ccw" } }), true);
    expect(css).toContain(".instance-wave-wrapper");
    expect(css).toContain("@keyframes motion-L1-wave");
    expect(css).toContain("translateY(var(--wave-amt, 0px))");
    expect(css).toContain("animation-direction: reverse");
  });
});

describe("effects: per-copy vars", () => {
  it("stagger delay = -(i/count)*period; 0 when off", () => {
    const staggered = layer({ individualSpin: { ...allOff.individualSpin, enabled: true, periodSeconds: 8, stagger: true } });
    expect(instanceEffectStyle(staggered, 0)!["--spin-delay" as never]).toBe("0s");
    expect(instanceEffectStyle(staggered, 2)!["--spin-delay" as never]).toBe("-2s"); // -(2/8)*8
    const rigid = layer({ individualSpin: { ...allOff.individualSpin, enabled: true, periodSeconds: 8, stagger: false } });
    expect(instanceEffectStyle(rigid, 2)!["--spin-delay" as never]).toBe("0s");
  });

  it("radial amount is divided by layer scale (world px)", () => {
    const l = layer({ radialPulse: { ...allOff.radialPulse, enabled: true, amount: 60 } }, 2);
    expect(instanceEffectStyle(l, 0)!["--radial-amt" as never]).toBe("30px");
  });

  it("wave vars include tangent amount and a frequency-based phase delay", () => {
    const l = layer({ wave: { ...allOff.wave, enabled: true, periodSeconds: 8, amount: 80, frequency: 2 } }, 2);
    expect(instanceEffectStyle(l, 0)!["--wave-amt" as never]).toBe("40px");
    expect(instanceEffectStyle(l, 2)!["--wave-delay" as never]).toBe("-4s");
  });
});

describe("effects: reach padding", () => {
  it("spin adds nothing; pulse + radial sum", () => {
    expect(effectsReachPadding(layer({ individualSpin: { ...allOff.individualSpin, enabled: true } }))).toBe(0);
    // halfDiag = 0.5*hypot(10,10)*1 ~= 7.071; scalePulse amount 0.5 => ~3.536; radial 40 => +40
    const l = layer({
      scalePulse: { ...allOff.scalePulse, enabled: true, amount: 0.5 },
      radialPulse: { ...allOff.radialPulse, enabled: true, amount: 40 },
      wave: { ...allOff.wave, enabled: true, amount: 12 },
    });
    expect(effectsReachPadding(l)).toBeCloseTo(0.5 * Math.hypot(10, 10) * 0.5 + 40 + 12, 3);
  });
});

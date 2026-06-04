import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => { root = createRoot(container); root.render(<App />); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const click = (el: Element | null | undefined) =>
  act(() => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const keydown = (key: string, init: KeyboardEventInit = {}) =>
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init })); });

const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
const titleBtn = (sub: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("title")?.includes(sub));
const setMode = (m: "design" | "animate") =>
  click(Array.from(container.querySelectorAll(".mode-btn")).find((b) => b.textContent?.includes(m === "animate" ? "Animate" : "Design")));
const newLayer = () => click(container.querySelector('[title="New layer"]'));
const selectAll = () => keydown("a", { metaKey: true });

const rows = () => container.querySelectorAll(".layer-row");
const canvas = () => container.querySelector("svg.canvas-svg")!;
const canvasLayerIds = () =>
  Array.from(canvas().querySelectorAll("[data-layer-id]")).map((e) => e.getAttribute("data-layer-id"));
const gizmos = () => canvas().querySelectorAll(".gizmo");
const resizeHandles = () => canvas().querySelectorAll(".gizmo-handle");
const instances = () => canvas().querySelectorAll("use.instance:not(.alt)");
const sliderByLabel = (label: string) => {
  const ctl = Array.from(container.querySelectorAll(".inspector .ctl")).find(
    (c) => c.querySelector(".ctl-label")?.textContent === label
  );
  return ctl?.querySelector("input[type=range]") as HTMLInputElement;
};
const valByLabel = (label: string) => {
  const ctl = Array.from(container.querySelectorAll(".inspector .ctl")).find(
    (c) => c.querySelector(".ctl-label")?.textContent === label
  );
  return ctl?.querySelector(".ctl-val")?.textContent;
};

function setRange(input: Element, value: number) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, String(value)); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("App layer interactions", () => {
  it("starts with one layer, selected and rendered on canvas", () => {
    expect(rows()).toHaveLength(1);
    expect(rows()[0].className).toContain("selected");
    expect(canvasLayerIds()).toHaveLength(1);
  });

  it("New Layer adds a second layer and selects it", () => {
    newLayer();
    expect(rows()).toHaveLength(2);
    expect(canvasLayerIds()).toHaveLength(2);
    expect(rows()[0].className).toContain("selected");
  });

  it("Duplicate adds a copy and selects the new layer", () => {
    click(button("Duplicate"));
    expect(rows()).toHaveLength(2);
    expect(container.textContent).toContain("Radial Repeat 1 copy");
    expect(rows()[0].textContent).toContain("Radial Repeat 1 copy");
    expect(rows()[0].className).toContain("selected");
    expect(rows()[1].className).not.toContain("selected");
  });

  it("Duplicate acts on the whole selection when multiple are selected", () => {
    newLayer();
    selectAll();
    click(button("Duplicate"));
    expect(rows()).toHaveLength(4);
    expect(Array.from(rows()).filter((r) => r.className.includes("selected"))).toHaveLength(2);
  });

  it("groups selected layers with the keyboard shortcut", () => {
    newLayer();
    selectAll();
    keydown("g", { metaKey: true });
    expect(container.textContent).toContain("group · 2 items");
    expect(rows()).toHaveLength(3); // group row + 2 members
    keydown("g", { metaKey: true, shiftKey: true });
    expect(container.textContent).not.toContain("group · 2 items");
    expect(rows()).toHaveLength(2);
  });

  it("Undo / Redo revert and restore document edits", () => {
    expect((titleBtn("Undo") as HTMLButtonElement).disabled).toBe(true);
    newLayer();
    expect(rows()).toHaveLength(2);
    expect((titleBtn("Undo") as HTMLButtonElement).disabled).toBe(false);
    click(titleBtn("Undo"));
    expect(rows()).toHaveLength(1);
    click(titleBtn("Redo"));
    expect(rows()).toHaveLength(2);
  });

  it("keyboard undo and redo shortcuts use the current document state", () => {
    newLayer();
    expect(rows()).toHaveLength(2);
    keydown("z", { metaKey: true });
    expect(rows()).toHaveLength(1);
    keydown("z", { metaKey: true, shiftKey: true });
    expect(rows()).toHaveLength(2);
    keydown("z", { ctrlKey: true });
    expect(rows()).toHaveLength(1);
    keydown("y", { ctrlKey: true });
    expect(rows()).toHaveLength(2);
  });

  it("creates a center-path animation and toggles playback", () => {
    setMode("animate");
    click(button("Add animation"));
    expect(canvas().querySelector(".motion-path-line")).toBeTruthy();
    expect(container.textContent).toContain("Duration");

    click(button("Preview"));
    const style = canvas().querySelector("style")?.textContent ?? "";
    expect(style).toContain("translate(var(--motion-start-dx), var(--motion-start-dy))");
    expect(style).toContain("animation-play-state: running");
    expect(canvas().querySelectorAll(".instance-motion-wrapper.motion-wrapper").length).toBeGreaterThan(0);

    click(button("Pause"));
    expect(canvas().querySelector("style")?.textContent ?? "").toContain("animation-play-state: paused");
  });

  it("adds an animation to every selected layer at once", () => {
    newLayer(); // 2 layers
    selectAll();
    setMode("animate");
    click(button("Add animation"));
    // both layers now report animation in the panel meta
    expect((container.textContent?.match(/· anim/g) ?? []).length).toBe(2);
    // and both have animated repeat wrappers on the canvas
    expect(canvas().querySelectorAll(".instance-motion-wrapper.motion-wrapper").length).toBe(48); // 2 layers × 12 × 2 passes
  });

  it("keeps the tucked still-frame ordering when entering animation edit mode", () => {
    setMode("animate");
    click(button("Add animation"));
    expect(canvas().querySelectorAll("clipPath[id^='seam-']")).toHaveLength(2);
    expect(instances()).toHaveLength(12);
    expect(canvas().querySelectorAll(".instance-motion-wrapper.motion-wrapper")).toHaveLength(24);
  });

  it("allows dragging the center-path start handle", () => {
    setMode("animate");
    click(button("Add animation"));
    const start = canvas().querySelector(".motion-path-start")!;
    const line = canvas().querySelector(".motion-path-line")!;
    act(() => start.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 20, button: 0 })));
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 30, clientY: 40 })));
    expect(line.getAttribute("x1")).toBe("30");
    expect(line.getAttribute("y1")).toBe("40");
  });

  it("keeps animated repeat instances synchronized when count changes during playback", () => {
    setMode("animate");
    click(button("Add animation"));
    click(button("Preview"));
    setRange(sliderByLabel("Count"), 24);
    expect(instances()).toHaveLength(24);
    const wrappers = Array.from(canvas().querySelectorAll<SVGGElement>(".instance-motion-wrapper.motion-wrapper"));
    expect(wrappers.length).toBeGreaterThanOrEqual(24);
    expect(wrappers.every((w) => w.style.getPropertyValue("--motion-dx"))).toBe(true);
  });

  it("hiding a layer removes it from the canvas but keeps the panel row", () => {
    const beforeId = canvasLayerIds()[0];
    // layer-row icon toggles fire on pointerdown (matches the design)
    act(() => container.querySelector('.layer-row [title="Hide"]')!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(rows()).toHaveLength(1);
    expect(canvasLayerIds()).not.toContain(beforeId);
  });

  it("deleting the only layer leaves an empty document", () => {
    click(button("Delete"));
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain("Select a layer to edit its settings.");
    expect(canvasLayerIds()).toHaveLength(0);
  });

  it("Select All highlights every row and draws one union gizmo", () => {
    newLayer();
    selectAll();
    expect(Array.from(rows()).every((r) => r.className.includes("selected"))).toBe(true);
    expect(gizmos()).toHaveLength(1);
    expect(resizeHandles()).toHaveLength(4);
    expect(container.textContent).toContain("All layers (2)");
  });

  it("count edits a single layer, and is disabled (blank) for a multi-selection", () => {
    expect(instances()).toHaveLength(12);
    expect(sliderByLabel("Count").disabled).toBe(false);
    setRange(sliderByLabel("Count"), 6);
    expect(instances()).toHaveLength(6);
    newLayer();
    selectAll();
    expect(sliderByLabel("Count").disabled).toBe(true);
    expect(valByLabel("Count")).toBe("—");
  });

  it("the color swatch recolors the selected layer's fill", () => {
    const swatch = container.querySelector(".tool-swatch input[type=color]")! as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(swatch, "#ff0000");
      swatch.dispatchEvent(new Event("input", { bubbles: true }));
      swatch.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // the selected layer's motif now renders with the new fill
    expect(canvas().querySelector('.layer [fill="#ff0000"]')).not.toBeNull();
  });

  it("grabbing a layer's artwork and dragging moves its center", () => {
    const centerRoot = () => canvas().querySelector(".layer .layer-center-root")!;
    expect(centerRoot().getAttribute("transform")).toBe("translate(0,0)");
    const art = canvas().querySelector(".layer use.instance")!;
    act(() => art.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, button: 0 })));
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 130, clientY: 150 })));
    expect(centerRoot().getAttribute("transform")).toBe("translate(30,50)");
  });

  it("Option + dragging a resize handle duplicates and resizes the copy", () => {
    expect(rows()).toHaveLength(1);
    const handle = canvas().querySelector(".gizmo-handle")!;
    act(() => handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, button: 0, altKey: true })));
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 250, clientY: 0 })));
    expect(rows()).toHaveLength(2);
    const scales = Array.from(canvas().querySelectorAll(".repeat-scale")).map((e) => e.getAttribute("transform"));
    expect(scales).toContain("scale(1)");
    expect(scales).toContain("scale(2.5)");
  });

  const pe = (type: string, x: number, y: number) =>
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  const drawStroke = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => {
    const svg = canvas();
    act(() => svg.dispatchEvent(pe("pointerdown", a[0], a[1])));
    act(() => { svg.dispatchEvent(pe("pointermove", b[0], b[1])); svg.dispatchEvent(pe("pointermove", c[0], c[1])); svg.dispatchEvent(pe("pointermove", d[0], d[1])); });
    act(() => svg.dispatchEvent(pe("pointerup", d[0], d[1])));
  };
  const instancesIn = (layerIndex: number) =>
    canvas().querySelectorAll(`[data-layer-id]`)[layerIndex]?.querySelectorAll("use.instance:not(.alt)").length;

  it("Pencil draws a single-instance drawn layer; extra strokes append to it", () => {
    click(titleBtn("Pencil"));
    drawStroke([200, 200], [260, 210], [300, 260], [210, 300]);
    expect(rows()).toHaveLength(2);
    expect(container.textContent).toContain("Drawn Shape 1");
    expect(rows()[0].textContent).toContain("Drawn Shape 1");
    expect(rows()[0].className).toContain("selected");
    const drawnG = canvas().querySelector(".layer[data-layer-id]:last-of-type")!;
    expect(drawnG.querySelectorAll("use.instance:not(.alt)")).toHaveLength(1);
    expect(canvas().querySelector(".layer path[fill]")).not.toBeNull();
    drawStroke([400, 400], [460, 410], [500, 460], [410, 500]);
    expect(rows()).toHaveLength(2);
    expect(drawnG.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
  });

  it("Radialize turns the selected drawn shape into a repeat", () => {
    click(titleBtn("Pencil"));
    drawStroke([200, 200], [260, 210], [300, 260], [210, 300]);
    click(button("Done"));
    expect(instancesIn(1)).toBe(1);
    click(button("Radialize"));
    expect(instancesIn(1)!).toBeGreaterThan(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";

// Exercise the real handlers/effects in jsdom (SSR can't). Covers PRD §18
// acceptance flows: duplicate, selection, visibility hides from canvas.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<App />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const click = (el: Element | null | undefined) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

const keydown = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });

const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text
  );

const rows = () => container.querySelectorAll(".layer-row");
const canvas = () => container.querySelector("svg.canvas")!;
const canvasLayerIds = () =>
  Array.from(canvas().querySelectorAll("[data-layer-id]")).map((e) =>
    e.getAttribute("data-layer-id")
  );
const gizmos = () => canvas().querySelectorAll(".gizmo");
const resizeHandles = () => canvas().querySelectorAll(".gizmo-handle");
// one pass only (the tuck renders the ring as two half-disk passes; the second
// carries .alt) so this counts logical copies per layer.
const instances = () => canvas().querySelectorAll("use.instance:not(.alt)");

function setRange(input: Element, value: number) {
  // React tracks the input value, so set it via the native prototype setter
  // before dispatching, or onChange won't fire.
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("App layer interactions", () => {
  it("starts with one layer, selected and rendered on canvas", () => {
    expect(rows()).toHaveLength(1);
    expect(rows()[0].className).toContain("selected");
    expect(canvasLayerIds()).toHaveLength(1);
  });

  it("New Layer adds a second layer and selects it", () => {
    click(button("New Layer"));
    expect(rows()).toHaveLength(2);
    expect(canvasLayerIds()).toHaveLength(2);
    // newest (front) is top row and selected
    expect(rows()[0].className).toContain("selected");
  });

  it("Duplicate adds a copy named '<name> copy' and selects the new layer", () => {
    click(button("Duplicate"));
    expect(rows()).toHaveLength(2);
    expect(container.textContent).toContain("Radial Repeat 1 copy");
    // top row = front = the copy; it is selected, the original is not
    expect(rows()[0].textContent).toContain("Radial Repeat 1 copy");
    expect(rows()[0].className).toContain("selected");
    expect(rows()[1].className).not.toContain("selected");
  });

  it("Duplicate acts on the whole selection when multiple are selected", () => {
    click(button("New Layer")); // 2 layers
    click(button("Select All"));
    click(button("Duplicate 2")); // button reflects the selection count
    expect(rows()).toHaveLength(4);
    // the two copies are now selected
    const selected = Array.from(rows()).filter((r) => r.className.includes("selected"));
    expect(selected).toHaveLength(2);
  });

  it("Undo and Redo buttons revert and restore document edits", () => {
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Redo") as HTMLButtonElement).disabled).toBe(true);

    click(button("New Layer"));
    expect(rows()).toHaveLength(2);
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(false);

    click(button("Undo"));
    expect(rows()).toHaveLength(1);
    expect((button("Redo") as HTMLButtonElement).disabled).toBe(false);

    click(button("Redo"));
    expect(rows()).toHaveLength(2);
  });

  it("keyboard undo and redo shortcuts use the current document state", () => {
    click(button("New Layer"));
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
    click(button("Animate Center"));
    expect(canvas().querySelector(".motion-path-line")).toBeTruthy();
    expect(container.textContent).toContain("Duration");

    click(button("Play"));
    const style = canvas().querySelector("style")?.textContent ?? "";
    expect(style).toContain("translate(var(--motion-dx), var(--motion-dy))");
    expect(style).toContain("animation-play-state: running");
    expect(canvas().querySelectorAll(".instance-motion-wrapper.motion-wrapper").length).toBeGreaterThan(0);
    expect(canvas().querySelector(".layer-center-root.motion-wrapper")).toBeNull();

    click(button("Pause"));
    expect(canvas().querySelector("style")?.textContent ?? "").toContain("animation-play-state: paused");
  });

  it("keeps the tucked still-frame ordering when entering animation edit mode", () => {
    click(button("Animate Center"));

    expect(canvas().querySelectorAll("clipPath[id^='seam-']")).toHaveLength(2);
    expect(instances()).toHaveLength(12);
    expect(canvas().querySelectorAll(".instance-motion-wrapper.motion-wrapper")).toHaveLength(24);
  });

  it("keeps animated repeat instances synchronized when count changes during playback", () => {
    const countInput = () => container.querySelector(".controls-body input[type=range]") as HTMLInputElement;

    click(button("Animate Center"));
    click(button("Play"));
    setRange(countInput(), 24);

    expect(instances()).toHaveLength(24);
    const wrappers = Array.from(canvas().querySelectorAll<SVGGElement>(".instance-motion-wrapper.motion-wrapper"));
    expect(wrappers.length).toBeGreaterThanOrEqual(24);
    expect(wrappers.every((w) => w.style.getPropertyValue("--motion-dx"))).toBe(true);
    expect(wrappers.every((w) => w.style.getPropertyValue("--motion-dy"))).toBe(true);
  });

  it("hiding a layer removes it from the canvas but keeps the panel row", () => {
    const beforeId = canvasLayerIds()[0];
    const eye = container.querySelector('.layer-row .mini[title="Hide"]');
    click(eye);
    expect(rows()).toHaveLength(1); // still in the panel
    expect(canvasLayerIds()).not.toContain(beforeId); // gone from canvas
  });

  it("deleting the only layer leaves an empty document (empty state allowed)", () => {
    click(button("Delete"));
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain("No layer selected.");
    expect(canvasLayerIds()).toHaveLength(0);
  });

  it("Select All highlights every row and draws a box per layer with one handle", () => {
    click(button("New Layer")); // now 2 layers
    click(button("Select All"));
    // both rows selected
    expect(Array.from(rows()).every((r) => r.className.includes("selected"))).toBe(true);
    // one union gizmo wraps the whole selection, with four resize handles
    expect(gizmos()).toHaveLength(1);
    expect(resizeHandles()).toHaveLength(4);
    expect(container.textContent).toContain("All layers (2)");
  });

  it("count edits a single layer, and is disabled (blank) for a multi-selection", () => {
    const countInput = () => container.querySelector(".controls-body input[type=range]") as HTMLInputElement;
    // single selection: count works
    expect(instances()).toHaveLength(12);
    expect(countInput().disabled).toBe(false);
    setRange(countInput(), 6);
    expect(instances()).toHaveLength(6);

    // select two -> count is disabled and shows no value
    click(button("New Layer"));
    click(button("Select All"));
    expect(countInput().disabled).toBe(true);
    const countVal = container.querySelector(".controls-body .ctrl-val")!;
    expect(countVal.textContent).toBe("—");
  });

  it("grabbing a layer's artwork and dragging moves its center", () => {
    const centerRoot = () => canvas().querySelector(".layer .layer-center-root")!;
    expect(centerRoot().getAttribute("transform")).toBe("translate(0,0)");

    const art = canvas().querySelector(".layer use.instance")!;
    // jsdom has no PointerEvent; MouseEvent with a pointer type name still drives
    // the handlers (they only read clientX/clientY). No CTM => world == client.
    const pd = new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, button: 0 });
    act(() => art.dispatchEvent(pd));
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 130, clientY: 150 })));

    // commit applies delta (30,50) to the layer center
    expect(centerRoot().getAttribute("transform")).toBe("translate(30,50)");
  });

  it("Option + dragging a resize handle duplicates and resizes the copy", () => {
    expect(rows()).toHaveLength(1);
    const handle = canvas().querySelector(".gizmo-handle")!;
    // anchor = union center (0,0); startDist=100, end dist=250 => factor 2.5
    act(() =>
      handle.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, button: 0, altKey: true })
      )
    );
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 250, clientY: 0 })));

    expect(rows()).toHaveLength(2); // duplicated
    const scales = Array.from(canvas().querySelectorAll(".repeat-scale")).map((e) =>
      e.getAttribute("transform")
    );
    expect(scales).toContain("scale(1)"); // original untouched
    expect(scales).toContain("scale(2.5)"); // copy resized
  });
});

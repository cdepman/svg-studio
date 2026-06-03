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
const selBoxes = () => canvas().querySelectorAll(".sel-box");
const handles = () => canvas().querySelectorAll(".center-handle");
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

  it("Duplicate adds a copy named '<name> copy'", () => {
    click(button("Duplicate"));
    expect(rows()).toHaveLength(2);
    expect(container.textContent).toContain("Radial Repeat 1 copy");
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
    // a dashed box per layer, one combined handle
    expect(selBoxes()).toHaveLength(2);
    expect(handles()).toHaveLength(1);
    expect(container.textContent).toContain("All layers (2)");
  });

  it("a discrete param edit while All-selected applies to every layer in synchrony", () => {
    click(button("New Layer")); // 2 layers, default count 12 each
    click(button("Select All"));
    expect(instances()).toHaveLength(24); // 2 * 12
    // first range in the controls body is Count
    const countInput = container.querySelector(".controls-body input[type=range]")!;
    setRange(countInput, 6);
    expect(instances()).toHaveLength(12); // 2 * 6 -> applied to both
  });
});

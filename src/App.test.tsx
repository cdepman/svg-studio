import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import App from "./App";

// Mount smoke test: the whole tree (default layer, layers panel, Canvas,
// Controls) renders without throwing, with the default layer selected.
describe("App", () => {
  it("renders the panel, canvas, default layer instances, and the gizmo", () => {
    const html = renderToString(<App />);
    expect(html).toContain("canvas-svg");
    expect(html).toContain("mode-switch");
    expect(html).toContain("Radial Repeat 1");
    // default mode is Design: the panel shows the motif Composition + the canvas
    // focuses the active motif (no gizmo)
    expect(html).toContain("Composition");
    expect(html).toContain("design-mode view-context");
    // default count 12 -> 12 instances, motif def is per-layer
    expect((html.match(/class="instance"/g) ?? []).length).toBe(12);
    expect(html).toContain('id="motif-');
    // inspector mode pill
    expect(html).toContain("insp-mode-pill");
  });
});

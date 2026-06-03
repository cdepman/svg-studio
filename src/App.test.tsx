import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import App from "./App";

// Mount smoke test: the whole tree (default motif import, Canvas, Controls)
// renders without throwing, and the default mandala produces instances.
describe("App", () => {
  it("renders the canvas, the center handle, and the default instances", () => {
    const html = renderToString(<App />);
    expect(html).toContain('class="canvas"');
    expect(html).toContain("center-handle");
    expect(html).toContain("center-hit");
    // default count is 12 -> 12 <use class="instance">
    const instances = html.match(/class="instance"/g) ?? [];
    expect(instances).toHaveLength(12);
    expect(html).toContain('id="motif"');
  });
});

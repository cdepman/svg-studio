# Radial Repeat Studio — Spike MVP

A deliberately narrow spike answering one question: **does dragging the radial
repeat center feel immediate and satisfying with a native-SVG renderer?**

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + mount tests
npm run build      # typecheck + production build
```

The app loads a bundled mandala motif on first run — no input required.
Scroll = zoom (anchored at cursor), space-drag / middle-drag = pan, and drag the
pink center handle to move the repeat center.

## The three non-negotiables (and where they live)

1. **DOM ownership boundary** (`src/canvas/useScene.ts`, `Canvas.tsx`,
   `useCenterDrag.ts`, `controls/Controls.tsx`). React owns structure + committed
   values; imperative code owns continuous in-gesture deltas. No React state is
   written on `pointermove` or slider `input` — only on `pointerup` / slider
   `change`. The center drag is two `setAttribute` calls per frame (`repeat-root`
   and `center-ui-root`, both `translate(cx,cy)`), O(1) regardless of count.
   Sliders are uncontrolled and use native `input`/`change` listeners so a drag
   triggers zero React renders.

2. **Coordinate + anchoring spec** (`src/canvas/useScene.ts` `screenToWorld`,
   `src/motif/importSvg.ts`). Pointer→world mapping uses the live `getScreenCTM`
   of the pan/zoom group — no hand-rolled inverse matrix. The motif is
   anchor-normalized to local origin on import (the only `getBBox`, once).

3. **Drag-time fidelity fallback** (`src/config.ts`, `Canvas.tsx`). When
   `count * motifWeight > 8000` and a drag is active, only a representative subset
   (≤24, evenly spaced) renders. A clean swap on `pointerup`, not a per-frame
   decision.

## Seam handling

Copies paint `0..N-1` and later = on top, so the overlap is consistent the whole
way around **except** the wrap, where the last-painted copy sits over the first.
That single inconsistent adjacency is the seam — the card-loop paradox. It is
**conserved**: you can move it or hide it, never delete it.

- **Seam position** (`paintOffset`) — relocates the seam by rotating the *paint
  order* (z-order), not the geometry. One control; drop the seam at the back or
  in a dense region where the eye doesn't track individual copies.
- **Tuck** + **Seam blend (k)** — the real fix. After painting all copies,
  redraw the first `k` clipped to a wedge straddling the seam, so copy 0 sits
  *over* the last copy there and the overlap reads continuous. `k` ≈ how many
  neighbors a petal laps; tune by eye.

The wedge lives in `repeat-root` local coords (`repeatMath.seamWedgePath`),
depends only on count/angle/radius/scale/paint-order — **never the center** — so
it travels with `translate(cx,cy)` for free during a center drag and is
recomputed imperatively in `applyInstances` on the same param drags that already
move the instances. Caveat: with `opacityStep < 1` the redraw double-blends
inside the wedge (slightly darker); keep `k` small or relocate instead.

## Module layout

```
src/
  App.tsx              shell, committed state
  canvas/
    Canvas.tsx         <svg>, pan/zoom group, motif def, instances, handle
    useViewport.ts     pan/zoom + screen<->world
    useScene.ts        refs + imperative applyCenter / applyInstances
    useCenterDrag.ts   pointer + rAF loop (one frame, one pending event)
    repeatMath.ts      pure, unit-tested transform strings
  motif/
    importSvg.ts       read, sanitize, anchor-normalize, weight
    sanitize.ts        DOMPurify config + "simplified" detection
    exportSvg.ts       resolve repeat into a portable SVG (stretch)
  controls/Controls.tsx
  defaultMotif.ts  config.ts  types.ts
```

## What's intentionally NOT here

No layers, undo, inspector for arbitrary objects, independent object transforms,
transform repeat, multiple repeats, project save. See the PRD; those are deferred
until the center-drag feel is proven.

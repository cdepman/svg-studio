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

## Layers & selection

A flat layer document (no nesting): each layer is one radial-repeat composition.
Add / duplicate (`⌘D`) / delete (`Del`) / rename (double-click) / reorder (drag a
row, or `⌘[` / `⌘]`, `⌘⇧[` / `⌘⇧]`), toggle visibility and lock. `layers[0]` is the
back; the panel renders reversed (top row = front). Export walks visible layers
back-to-front. See `src/document/layers.ts` (pure, unit-tested).

**Selection gizmo (the on-canvas meta tool):** a dashed accent frame wraps the
*union* of the selected, editable layers, with four corner **resize handles** and
a **duplicate button** ("+", top-right). Resize is a uniform scale about the
selection's union center — stored per layer as `scale` and applied via a
`repeat-scale` group *inside* `repeat-root`, so the center-drag path is untouched
and the whole composition (ring + petals) scales. The gizmo updates imperatively
during center drags (translate), param drags (re-fit), and resizes (scale), with
zero React commits on `pointermove`. A locked/hidden selected layer shows in the
panel only.

**Marquee multi-select:** drag on empty canvas to rubber-band a rectangle;
every visible, unlocked layer whose artwork box it touches is selected (shift to
add). Click a layer to select it (shift/⌘-click toggles), or `⌘A` for all.

**Select all & synchronized manipulation** (`⌘A`, or the Select All button):
dragging the one combined handle, or moving any continuous slider, applies a
**relative delta** to every selected layer — preserving the differences between
them. Discrete controls (count, orientation, mirror, seam) set an absolute value
on all selected. The imperative path is unchanged in spirit: a synchronized drag
mutates each selected layer's `repeat-root` + box transform directly (one
`setAttribute` per moved node per frame), with zero React commits on
`pointermove`. The combined handle sits at the centroid of the selected centers.

## Seam handling

Copies paint `0..N-1` and later = on top, so the overlap is consistent the whole
way around **except** the wrap, where the last-painted copy sits over the first.
That single inconsistent adjacency is the seam — the card-loop paradox. It is
**conserved**: you can move it or hide it, never delete it.

- **Seam position** (`paintOffset`) — relocates the seam by rotating the *paint
  order* (z-order), not the geometry. One control; drop the seam at the back or
  in a dense region where the eye doesn't track individual copies.
- **Hide seam** (on by default) — automatic, no depth knob.

The single global paint order is what forces the seam (the card-loop paradox), so
we don't use one. `repeatMath.seamHalves` splits the ring into **two
complementary half-disks**: the half *opposite* the chosen seam is drawn in the
normal order (its discontinuity sits at the seam angle, outside this half), and
the half *containing* the seam is drawn in an order rotated 180° (its
discontinuity lands on the far side, outside this half). Because the two clips
are complementary, every pixel is painted exactly once — **no double-blend** (the
old dark blob) — and the two boundaries sit 90° from either discontinuity, where
the orders agree on every overlap, so the joins are invisible. There is **no
depth/blend parameter**: the only knob is *Seam position* (where the hidden split
sits). Works identically for radial and heavily-overlapping tangential petals.
The clips are in `repeat-root` local coords (never the center) and are rotated/
scaled imperatively in `applyParamDelta` during param drags.

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

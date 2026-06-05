# Radial Repeat Studio

A browser-based studio for **radial-repeat vector art**: design a motif, repeat it
*N* times around a center, arrange the ring, and animate the whole thing — all on a
native-SVG canvas with buttery, zero-render-per-frame gestures.

What began as a spike to prove that dragging the repeat center feels immediate with
a native-SVG renderer has grown into a small but complete editor: layers and groups,
a motif library, a draw-and-radialize pencil, sub-part editing, concurrent
CSS-driven animation effects, a timeline, and portable (static **and** animated)
SVG export.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + mount tests (Vitest, jsdom)
npm run build      # typecheck + production build
npm run preview    # serve the production build
```

The app loads a bundled motif on first run — no input required.

---

## Concepts

A **motif** is the atomic unit of art (an imported/sanitized SVG, a library motif,
or a freehand drawing). It is flattened into addressable **parts** so each piece can
be moved, scaled, recolored, and reordered non-destructively.

A **layer** is one radial-repeat composition: a motif + `RepeatParams` (count,
radius, angle, orientation, seam) + a `center` + a uniform `scale` + optional
per-copy color overrides + optional animation + optional looping effects. The
document is a **flat array of layers** (no nesting) plus a list of **groups** that
reference layers by id. `layers[0]` is the back; the panel renders reversed so the
top row is the front; export walks visible layers back-to-front.

### The three editor modes

The top bar switches between three modes, each with its own accent color and
inspector:

| Mode | Accent | The canvas focuses… | The inspector holds… |
|------|--------|---------------------|----------------------|
| **Design** | pink | the active motif (the rest of the ring fades to a locked preview) | Canvas view (Context / Isolated / Full repeat), Motif help, the **Motif Library** |
| **Arrange** | violet | the whole repeat | **Repeat** (count, radius, angle), **Orientation**, **Seam**, secondary steps |
| **Animate** | teal | the ring, with the timeline docked below | **Motion recipes** (presets), **Fine tune** (effect cards), the **Motion path**, and playback |

Switching modes tidies mode-specific edit state and re-frames the view (Design
centers the active motif; the others fit the whole ring).

---

## Features

### Motifs & the library

- **Import SVG** (menu or drag-and-drop onto the canvas). On import the SVG is
  sanitized with DOMPurify (`script`/`foreignObject`/`animate` forbidden), measured
  once via `getBBox`, anchor-normalized to its box center, flattened into parts, and
  weighed (paintable-element count). If sanitizing changed the render, a "simplified
  on import" notice is shown.
- **Motif library** — a browser of bundled motifs (`motif-seed-library/svg/*.svg`),
  glob-imported at build time (`src/motifLibrary.ts`). **Use** replaces the selected
  layer's motif; **Add** drops it as a new layer.
- **Pencil → radialize.** Draw freehand (smoothed via `perfect-freehand`); strokes
  are **closed and filled** (the region you draw, not just the pen ribbon). A start
  anchor lets you snap the loop closed. Multiple strokes accumulate into one drawn
  layer; **Radialize** turns it into a repeat. A drawn shape is *not* a special
  case — `motif/drawnPath.ts` produces the same `Motif` abstraction as an import, so
  repeat / reorder / resize / animate / export all treat it identically.
- **Eyedropper & swatch** — pick a screen color or set the fill for the selected
  layer / new shapes.

### Composition (sub-part editing — Design mode)

The motif's parts are directly editable on the canvas and listed in the left
**Composition** panel (reorder to change paint order, toggle per-part visibility).

- A bounding-box **gizmo** (move + corner-resize + rotate knob) edits the part under
  the representative copy; edits sync live to every copy in the ring.
- **Marquee** a box anywhere around the motif to select several parts at once; the
  union gets a group frame. Inside a multi-selection, a plain **click drills in** to
  the single part under the cursor (drag still moves the whole group); shift-click
  toggles one part.
- **Alt-drag** duplicates a part, showing a live ghost of the copy under the cursor
  (Illustrator-style) and committing on release.

### Layers, groups & selection

- Add / **duplicate** (`⌘D`) / **delete** (`Del`/`⌫`) / rename (double-click) /
  reorder (drag a row, or `⌘[` `⌘]`, `⌘⇧[` `⌘⇧]`) / toggle visibility & lock.
- **Group** (`⌘G`) / **ungroup** (`⌘⇧G`) — groups are editor-level sets shown as
  folder rows with indented members.
- **Selection gizmo** — a dashed accent frame wraps the *union* of the selected
  editable layers with four corner resize handles, a rotate knob, and a contextual
  toolbar (Duplicate · Center · Radialize · Delete). Resize is a uniform scale about
  the union center, stored per layer as `scale` (applied via a `repeat-scale` group
  *inside* `repeat-root`, so the center-drag path is untouched). Alt-resize
  duplicates and continues on the copies.
- **Marquee** on empty canvas rubber-bands layers (shift adds). Click selects;
  shift/⌘-click toggles; `⌘A` selects all.
- **Synchronized manipulation** — with several layers selected, dragging the one
  combined handle or any continuous slider applies a **relative delta** to every
  selected layer (preserving their differences); discrete controls set an absolute
  value on all. Each gesture mutates the DOM directly — zero React commits on
  `pointermove`.

### Repeat parameters (Arrange mode)

`count` (1–128), `radiusOffset`, `angleOffset`, `orientationMode`
(`rotateWithCircle` | `keepUpright`), and progressive `scaleStep` / `opacityStep`
across copies.

### Seam handling

Copies paint `0..N-1`, so the overlap is consistent the whole way around **except**
the wrap, where the last-painted copy sits over the first. That single inconsistent
adjacency is the seam — the card-loop paradox. It is **conserved**: you can move it
or hide it, never delete it.

- **Seam position** (`paintOffset`) relocates the seam by rotating the *paint order*
  (z-order), not the geometry.
- **Hide seam** (`tuck`, on by default) splits the ring into **two complementary
  half-disks** (`repeatMath.seamHalves`): the half opposite the chosen seam draws in
  the normal order, the half containing it draws in an order rotated 180°. The clips
  are complementary, so every pixel is painted exactly once (no double-blend) and the
  two boundaries sit 90° from either discontinuity, where the orders agree — so the
  joins are invisible. There is no depth/blend knob.
- Tuck automatically falls back to a single normal pass when the motif is large
  enough to **reach across the center** (`motifCrossesCenter`) — the half-disk clip
  would otherwise bite a wedge out of a tightly-packed ring.

### Animation (Animate mode)

Two independent, composable systems — both realized as injected CSS `@keyframes`
(`animation-play-state: running|paused`), so live preview and exported SVG share one
code path:

- **Center-path motion** (`motion/centerPath.ts`) — draw a freehand path; every copy
  follows it relative to the center (the drawn shape is shared, anchored at each
  copy's own reference point). Tunables: duration, delay, easing, direction
  (out / out-and-back / loop), and orientation (fixed / follow-path). Implemented as
  per-copy `translate` keyframes (0% = rest, so adding a path never shifts the art).
- **Concurrent looping effects** (`motion/effects.ts`), each a self-contained card:
  - **Individual spin** — each copy turns on its own center.
  - **Composite rotation** — the whole design turns around its center.
  - **Grow & shrink** — each copy scales up and down in place.
  - **Radiate from center** — each copy eases outward along its spoke and back.
  - **Ripple around ring** — a travelling wave (width · waves · direction).
  - Each has a period and an optional **Stagger** so the effect travels around the
    ring (per-copy negative `animation-delay` carried by CSS variables).
- **Motion recipes** — one-click presets (`motion/presets.ts`) that set an effect
  combo (and sometimes repeat params).
- **Timeline dock** — collapsible transport (play / pause / to-start / loop), a time
  ruler, and one lane per animated composite. **Each composite plays/pauses
  independently** (per-lane buttons; the inspector's Play controls the selected one);
  the transport toggles them all. The timeline is a synced visual clock — playback
  itself is pure CSS.

### Export & import

- **Import SVG…** (menu / drag-drop).
- **Export → Expanded SVG** — resolves the visible layers into one portable static
  SVG (reads the live DOM when available, else rebuilds from state).
- **Export → Animated SVG** — bakes the center-path + effect keyframes into a
  self-playing SVG.

### History & shortcuts

Linear undo/redo (`past` / `present` / `future`, capped at 100). Commits are atomic
and no-ops are elided; selection changes are **not** undoable.

| | |
|---|---|
| `⌘Z` / `⌘⇧Z` / `⌘Y` | undo / redo / redo |
| `⌘A` | select all |
| `⌘D` | duplicate selection |
| `Del` / `⌫` | delete selection |
| `⌘G` / `⌘⇧G` | group / ungroup |
| `⌘]` `⌘[` / `⌘⇧]` `⌘⇧[` | move forward/back / to front/back |
| `Esc` | exit pencil / part / component edit, or collapse a multi-selection |
| scroll / space-drag / middle-drag | zoom (anchored at cursor) / pan |

---

## Architecture

### The DOM ownership boundary (the core idea)

React owns **structure and committed values**; imperative code owns **continuous
in-gesture deltas**. No React state is written on `pointermove` or slider `input` —
only on `pointerup` / slider `change`.

- A center drag is two `setAttribute` calls per frame (`repeat-root` and
  `center-ui-root`, both `translate(cx,cy)`), O(1) regardless of count.
- Sliders are uncontrolled with native `input`/`change` listeners, so a drag triggers
  zero React renders.
- `LayerArt` is `React.memo` over a stable `layer` reference, so a commit that changes
  one layer re-renders only that layer.
- Gestures live in small pointer + `rAF` hooks (`useCenterDrag`, `useMoveDrag`,
  `useResizeDrag`, `useRotateDrag`, `useComponentDrag`) that resolve their targets at
  grab time and commit once on release. `useScene` is the imperative seam: it holds
  the SVG/group refs, `screenToWorld` (via the live `getScreenCTM` — no hand-rolled
  inverse), and the appliers that rewrite instance transforms, seam clips, and the
  gizmo per frame.

### Heavy-scene fidelity fallback

When `count * motifWeight > 8000` (`config.HEAVY_THRESHOLD`) and a drag is active,
only a representative subset (≤24, evenly spaced) renders. It's a clean swap on
`pointerup`, not a per-frame decision.

### Data model (`src/types.ts`)

- **`RepeatParams`** — `count`, `angleOffset`, `radiusOffset`, `sourceRotation`,
  `sourceScale`, `orientationMode`, `scaleStep`, `opacityStep`, and seam fields
  `paintOffset` / `tuck` / `seamBlend`.
- **`Motif`** — `innerHtml` (derived), optional `parts`, optional `defs` preamble,
  `anchorX/anchorY` (box center), `box`, `weight`, `simplified`.
- **`MotifPart`** — `id`, `name`, immutable `baseMarkup`, intrinsic `cx/cy/w/h`, a
  non-destructive `transform: PartTransform {tx,ty,rotation,scale}`, optional `fill`,
  `visible`.
- **`Layer`** — `id`, `name`, `visible`, `locked`, `motif`, `params`, `center`
  (kept off `RepeatParams` so the repeat math stays center-independent), `scale`,
  `components` (sparse per-index color overrides), optional `animation` & `effects`,
  timestamps.
- **`LayerAnimation` = `CenterPathAnimation`** (`enabled`, `path`, `durationSeconds`,
  `delaySeconds`, `easing`, `direction`, `orientationMode`, `closed`).
- **`LayerEffects`** — `individualSpin`, `compositeSpin`, `scalePulse`,
  `radialPulse`, `wave`, each its own small interface with `enabled`, a period, and
  effect-specific `amount`/`direction`/`stagger`/`frequency`.
- Editor enums: `EditorMode` (`design|arrange|animate`), `DesignView`
  (`context|isolated|full`).

The document and history are App-level state:
`{ layers, groups, selectedIds }` wrapped in `{ past, present, future }`.
`commitDocument` pushes the previous present onto `past` (capped, no-ops elided) and
clears `future`; `updateLayers` is the layer-array-shaped commit; `updateSelection`
changes selection without touching history.

### The instance transform chain

Each layer renders a motif `<defs>` (with optional seam clip paths) and a stack of
instances. From the layer root down to each `<use>`:

```
layer-center-root      translate(center)
└ repeat-root          (+ composite-spin class when that effect is on)
  └ repeat-scale       scale(layer.scale)
    └ [seam-half clip]  (two complementary half-disk passes when tuck is on)
      └ instance-placement      instanceSpokeTransform | instanceTransform, opacity
        └ instance-motion-wrapper   center-path translate keyframes (motion-{id})
          └ instance-radial-wrapper radial-pulse translateX; carries per-copy effect vars
            └ instance-wave-wrapper   ripple translateY (tangent)
              └ instance-local-transform  rotation/scale of the copy (when animated)
                └ instance-spin-wrapper     individual spin
                  └ instance-pulse-wrapper    grow & shrink
                    └ instance-follow-wrapper   follow-path orientation
                      └ <use> + <rect.instance-hit>
```

Effect CSS uses **descendant selectors** (`.motion-{id} .instance-X-wrapper`), so the
effect wrappers must be descendants of the element carrying the `motion-{id}` class.
`repeatMath.ts` produces all the static transform strings as pure, unit-tested
functions.

---

## Module layout

```
src/
  App.tsx                 shell: document + history, mode/selection state,
                          gesture orchestration, file I/O, keyboard
  main.tsx                mount
  types.ts                all data-model types
  config.ts               HEAVY_THRESHOLD, PROXY_CAP, handle sizes, isHeavy()
  defaultMotif.ts         bundled first-run SVG
  motifLibrary.ts         import.meta.glob of the seed library → MOTIF_LIBRARY

  canvas/
    Canvas.tsx            <svg> root, pan/zoom group, layer stack, gizmo,
                          edit overlays, pencil & motion-path preview, events
    LayerArt.tsx          one layer's defs + instances (memoized); tuck; effect vars
    useScene.ts           imperative DOM boundary: refs, screenToWorld, appliers
    useViewport.ts        pan/zoom state + cursor-anchored zoom
    repeatMath.ts         pure transform/geometry/seam math (unit-tested)
    selectionBounds.ts    union + per-layer bounding boxes for the gizmo
    PartEditLayer.tsx     on-canvas motif sub-part gizmo + marquee (Design)
    ComponentEditLayer.tsx single-copy (component) gizmo (Arrange)
    useMoveDrag / useResizeDrag / useRotateDrag / useComponentDrag / useCenterDrag
                          pointer + rAF gesture loops (commit once on release)

  motif/
    importSvg.ts          read → sanitize → measure → flatten → anchor-normalize
    sanitize.ts           DOMPurify config + "simplified" detection
    parts.ts              flatten to addressable parts; serialize/reorder/edit
    drawnPath.ts          pencil stroke → filled closed Motif
    recolor.ts            non-destructive single-color recolor of markup
    exportSvg.ts          static + animated portable SVG; download helper

  motion/
    centerPath.ts         center-path animation: math + CSS keyframe generation
    effects.ts            concurrent looping effects: vars + CSS keyframe generation
    presets.ts            one-click "motion recipe" effect/param combos

  document/
    layers.ts             pure layer & group operations (create/dup/move/group…)

  controls/Controls.tsx   right inspector (mode-responsive) + effect cards
  layers/LayersPanel.tsx  left panel: layer stack OR motif Composition (Design)
  ui/Timeline.tsx         Animate-mode transport + ruler + per-composite lanes
  ui/icons.tsx            inline SVG icon set

motif-seed-library/       bundled motif SVGs + an offline build pipeline
  svg/                    the motifs the library browser loads
  drop-ai/ split-source/  staging for the conversion scripts
scripts/
  convert-ai-to-svg.mjs   Illustrator/AI → SVG sheets (via Inkscape)
  split-svg-motifs.mjs    grouped sheets → individual motif SVGs (via JSDOM)
```

## Motif-library pipeline (offline)

The library SVGs in `motif-seed-library/svg/` are produced by two Node scripts and
then glob-imported at build time:

```bash
# 1. drop .ai / grouped .svg sheets into motif-seed-library/drop-ai/
npm run convert:motifs   # → split-source/  (needs Inkscape; INKSCAPE_BIN to override)
npm run split:motifs     # → svg/           (splits sheets into one file per motif)
```

## Testing

Vitest (jsdom) with twelve suites. The pure cores are heavily covered —
`repeatMath`, `centerPath`, `effects`, `parts`, `recolor`, `drawnPath`, `importSvg`,
`exportSvg`, `layers` — alongside `Canvas`/`App` mount-and-interaction tests
(`App.test.tsx`, `App.client.test.tsx`).

```bash
npm test            # single run
npm run test:watch  # watch mode
```

## Tech

React 18 · TypeScript (strict) · Vite 5 · Vitest 2 · `perfect-freehand` (pencil) ·
`dompurify` (import sanitizing). No global state library — just React state plus the
imperative `useScene` refs.

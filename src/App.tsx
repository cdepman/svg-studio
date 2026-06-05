// App shell. Holds the DOCUMENT: a flat layer array, a primary selectedLayerId,
// and an allSelected flag for synchronized manipulation. The imperative drag
// code owns continuous in-gesture deltas for the selected layer(s) and never
// writes state mid-gesture. PRD §12, §15.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "./canvas/Canvas";
import { useMoveDrag } from "./canvas/useMoveDrag";
import { useResizeDrag } from "./canvas/useResizeDrag";
import { useScene, type DragTargetSpec, type NumericParamKey } from "./canvas/useScene";
import { useViewport } from "./canvas/useViewport";
import { layerReach, perLayerBounds, unionBounds } from "./canvas/selectionBounds";
import { Controls } from "./controls/Controls";
import { LayersPanel, type MoveDir } from "./layers/LayersPanel";
import { Icon } from "./ui/icons";
import { Timeline } from "./ui/Timeline";
import { DEFAULT_MOTIF_SVG } from "./defaultMotif";
import { importSvgFromFile, importSvgFromText } from "./motif/importSvg";
import { MOTIF_LIBRARY, type MotifLibraryItem } from "./motifLibrary";
import { boxCenter, DEFAULT_FILL, DEFAULT_PENCIL, strokeToFilledPath, unionBox, type PencilSettings } from "./motif/drawnPath";
import { motifFillColor } from "./motif/recolor";
import {
  appendPart,
  duplicatePart,
  newPartId,
  partColor,
  recolorMotif,
  reorderParts,
  setPartFill,
  setPartTransform,
  setPartVisible,
  singlePart,
} from "./motif/parts";
import { useRotateDrag } from "./canvas/useRotateDrag";
import {
  buildAnimatedExportSvg,
  buildExportSvg,
  buildExportSvgFromRenderedLayers,
  downloadSvg,
} from "./motif/exportSvg";
import {
  centerPathStyles,
  createCenterPathAnimation,
  normalizedAnimation,
  referenceInstancePoint,
  translateCenterPathAnimation,
} from "./motion/centerPath";
import { anyEffectEnabled, effectsStyles } from "./motion/effects";
import {
  createLayer,
  createLayerGroup,
  duplicateLayer,
  duplicateLayers,
  groupForLayer,
  insertAbove,
  moveBackward,
  moveForward,
  moveToBack,
  moveToFront,
  pruneGroups,
  removeLayer,
  removeGroupsForLayerIds,
  reorderByDisplay,
  updateLayer,
} from "./document/layers";
import type { Center, DesignView, EditorMode, Layer, LayerEffects, LayerGroup, Motif, PartTransform, RepeatParams } from "./types";
import type { CenterPathAnimation } from "./types";

type StateAction<T> = T | ((prev: T) => T);

interface DocumentState {
  layers: Layer[];
  groups: LayerGroup[];
  selectedIds: string[];
}

interface HistoryState {
  past: DocumentState[];
  present: DocumentState;
  future: DocumentState[];
}

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** AABB intersection between a marquee rect and a layer's square artwork box. */
function boxIntersects(r: WorldRect, c: Center, reach: number): boolean {
  return (
    c.x - reach <= r.maxX &&
    c.x + reach >= r.minX &&
    c.y - reach <= r.maxY &&
    c.y + reach >= r.minY
  );
}

const DEFAULT_PARAMS: RepeatParams = {
  count: 12,
  angleOffset: 0,
  radiusOffset: 140,
  sourceRotation: 0,
  sourceScale: 1,
  orientationMode: "rotateWithCircle",
  scaleStep: 0,
  opacityStep: 0,
  paintOffset: 0,
  tuck: true, // on by default
  seamBlend: 2, // tuck depth: how many copies a petal laps. Small + explicit.
};

// A drawn shape starts as a single, un-repeated instance sitting where it was
// drawn (count 1, radius 0). "Create Radial Repeat" turns it into a repeat. PRD §15A.
// tuck stays ON (like imported layers) so raising the count via the slider —
// not just the radialize button — hides the wrap seam. (At count 1 the two-half
// render just draws the single shape, so it's harmless.)
const DRAWN_PARAMS: RepeatParams = { ...DEFAULT_PARAMS, count: 1, radiusOffset: 0 };
const IMPORT_REPEAT_COUNT = 8;
const IMPORT_TARGET_MOTIF_SIZE = 150;

/** Evenly thin a dense freehand point list down to at most `max` points (keeps
 *  first + last) so a drawn motion path stays a compact, smooth curve. */
function downsamplePath(points: Center[], max: number): Center[] {
  if (points.length <= max) return points;
  const out: Center[] = [];
  for (let k = 0; k < max - 1; k++) out.push(points[Math.round((k * (points.length - 1)) / (max - 1))]);
  out.push(points[points.length - 1]);
  return out;
}

const HISTORY_LIMIT = 100;

function resolveAction<T>(action: StateAction<T>, prev: T): T {
  return typeof action === "function" ? (action as (prev: T) => T)(prev) : action;
}

function createInitialDocument(): DocumentState {
  const layer = createLayer({
    name: "Radial Repeat 1",
    motif: importSvgFromText(DEFAULT_MOTIF_SVG),
    params: DEFAULT_PARAMS,
    center: { x: 0, y: 0 },
  });
  return {
    layers: [layer],
    groups: [],
    selectedIds: [layer.id],
  };
}

export default function App() {
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [],
    present: createInitialDocument(),
    future: [],
  }));
  const { layers, groups, selectedIds } = history.present;
  // Selection is a SET of layer ids (single click, shift-click, marquee drag,
  // or select-all all funnel into this). The last entry is the "primary".
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawingMotionPath, setDrawingMotionPath] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  // Which composites (layers) are currently playing — each plays independently.
  const [playingIds, setPlayingIds] = useState<Set<string>>(new Set());
  const anyPlaying = playingIds.size > 0;
  const toggleLayerPlaying = (id: string) =>
    setPlayingIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [tool, setTool] = useState<"select" | "pencil">("select");
  const [pencil, setPencil] = useState<PencilSettings>(DEFAULT_PENCIL);
  // Current fill: the default for new shapes (no selection), or the selected
  // layer's color when one is selected. Always available via the swatch.
  const [fillColor, setFillColor] = useState(DEFAULT_FILL);
  // The individual component being edited (double-click a copy). Its layer is
  // the sole selection while editing.
  const [componentEdit, setComponentEdit] = useState<{ layerId: string; index: number } | null>(null);
  // The motif sub-part being edited (select a row in the layer tree). Edits the
  // shared motif, so it changes that piece across every copy in the ring.
  // partId null = the layer is in part-edit mode (parts are clickable) but none
  // is selected yet; set = that specific sub-part is selected for move/rotate.
  // index = which copy the overlay is shown on (edits sync to all copies).
  const [partEdit, setPartEdit] = useState<{ layerId: string; partId: string | null; index: number } | null>(null);
  const [mode, setMode] = useState<EditorMode>("design");
  const [designView, setDesignView] = useState<DesignView>("context");
  const [openMenu, setOpenMenu] = useState<"file" | "export" | null>(null);
  const [loop, setLoop] = useState(true);
  const [playTime, setPlayTime] = useState(0);
  const newLayerCount = useRef(1);
  const drawnCount = useRef(0);
  // The drawn layer that pencil strokes currently append to (multi-stroke shape).
  // Reset by "New Shape", switching tools, or radializing. PRD §8 (multi-line).
  const currentDrawingRef = useRef<string | null>(null);

  const scene = useScene();
  const { viewport, setViewport, zoomAt, panBy } = useViewport({ tx: 0, ty: 0, s: 1 });

  // --- Derived selection ---
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const primaryId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  const allSelected = layers.length > 0 && selectedIds.length === layers.length;

  // Layers that can actually be manipulated geometrically.
  const editableSelected = useMemo(
    () => layers.filter((l) => selectedSet.has(l.id) && l.visible && !l.locked),
    [layers, selectedSet]
  );

  const primary = useMemo<Layer | null>(() => {
    const p = layers.find((l) => l.id === primaryId);
    if (p && p.visible && !p.locked) return p;
    return editableSelected[0] ?? p ?? null;
  }, [layers, primaryId, editableSelected]);

  const gizmo = useMemo(() => unionBounds(editableSelected), [editableSelected]);
  // When several layers are selected, outline each one (the gizmo itself is just
  // the union frame + handles). Single selection needs no extra box.
  const selectionBoxes = useMemo(
    () => (editableSelected.length > 1 ? perLayerBounds(editableSelected) : []),
    [editableSelected]
  );
  // Animation can be added/edited whenever ≥1 editable layer is selected; it
  // applies to the whole selection in synchrony (like the repeat params).
  const animationEditable = editableSelected.length > 0;
  const canGroupSelection = selectedIds.length >= 2;
  const canUngroupSelection = groups.some((g) => g.layerIds.some((id) => selectedSet.has(id)));
  const motionCss = useMemo(
    () => {
      const isPlaying = (l: Layer) => playingIds.has(l.id) && !dragging;
      const visible = layers.filter((l) => l.visible);
      return [centerPathStyles(visible, isPlaying), effectsStyles(visible, isPlaying)].filter(Boolean).join("\n");
    },
    [layers, playingIds, dragging]
  );
  const primaryMotionPath = useMemo(() => {
    if (!primary?.animation || primary.animation.type !== "centerPath") return null;
    const animation = normalizedAnimation(primary.animation);
    return { points: animation.path.points, closed: animation.closed || animation.path.closed };
  }, [primary]);
  // While drawing a motion path, the stroke is anchored to the primary petal's
  // center (its copy-0 rest position) so the path always "starts from the petal".
  const motionAnchor = useMemo(
    () => (drawingMotionPath && primary ? referenceInstancePoint(primary) : null),
    [drawingMotionPath, primary]
  );

  // Specs for EVERY editable layer, so grabbing any layer's artwork can move it.
  const allEditable = useMemo(() => layers.filter((l) => l.visible && !l.locked), [layers]);

  // --- Keep the imperative side current (read at gesture start) ---
  scene.selectedLayerIdRef.current = primaryId;
  scene.invSRef.current = 1 / viewport.s;
  scene.dragTargetsRef.current = useMemo<DragTargetSpec[]>(
    () =>
      editableSelected.map((l) => ({
        id: l.id,
        params: l.params,
        center: l.center,
        scale: l.scale,
        motifBox: l.motif.box,
        animation: l.animation,
        effects: l.effects,
      })),
    [editableSelected]
  );
  scene.allSpecsRef.current = useMemo(
    () =>
      new Map<string, DragTargetSpec>(
        allEditable.map((l) => [
          l.id,
          {
            id: l.id,
            params: l.params,
            center: l.center,
            scale: l.scale,
            motifBox: l.motif.box,
            animation: l.animation,
            effects: l.effects,
          },
        ])
      ),
    [allEditable]
  );
  const primaryParamsRef = useRef<RepeatParams | null>(primary?.params ?? null);
  primaryParamsRef.current = primary?.params ?? null;

  const editableIdsRef = useRef<Set<string>>(new Set());
  editableIdsRef.current = new Set(editableSelected.map((l) => l.id));

  const docRef = useRef({ layers, groups, selectedIds, primaryId, dragging, tool, componentEdit, partEdit });
  docRef.current = { layers, groups, selectedIds, primaryId, dragging, tool, componentEdit, partEdit };

  const commitDocument = (update: (doc: DocumentState) => DocumentState) => {
    setHistory((h) => {
      const next = update(h.present);
      if (
        next.layers === h.present.layers &&
        next.groups === h.present.groups &&
        next.selectedIds === h.present.selectedIds
      ) {
        return h;
      }
      return {
        past: [...h.past, h.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
      };
    });
  };

  const updateLayers = (action: StateAction<Layer[]>) => {
    commitDocument((doc) => {
      const nextLayers = resolveAction(action, doc.layers);
      return nextLayers === doc.layers ? doc : { ...doc, layers: nextLayers };
    });
  };

  const updateSelection = (action: StateAction<string[]>) => {
    setHistory((h) => {
      const nextSelectedIds = resolveAction(action, h.present.selectedIds);
      return nextSelectedIds === h.present.selectedIds
        ? h
        : { ...h, present: { ...h.present, selectedIds: nextSelectedIds } };
    });
  };

  function expandGroupedIds(ids: string[], sourceGroups = docRef.current.groups) {
    const out = new Set(ids);
    for (const id of ids) {
      const group = groupForLayer(sourceGroups, id);
      if (group) group.layerIds.forEach((memberId) => out.add(memberId));
    }
    return Array.from(out);
  }

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const undo = () => {
    setHistory((h) => {
      const previous = h.past[h.past.length - 1];
      if (!previous) return h;
      return {
        past: h.past.slice(0, -1),
        present: previous,
        future: [h.present, ...h.future],
      };
    });
  };
  const redo = () => {
    setHistory((h) => {
      const next = h.future[0];
      if (!next) return h;
      return {
        past: [...h.past, h.present].slice(-HISTORY_LIMIT),
        present: next,
        future: h.future.slice(1),
      };
    });
  };

  // Frame the view once on mount: in Design (the default) center the active motif
  // (copy 0); otherwise just center the world origin.
  useEffect(() => {
    const svg = scene.svgRef.current;
    if (!svg) return;
    if (mode === "design" && primary) {
      frameMotif(primary);
    } else {
      const r = svg.getBoundingClientRect();
      setViewport((v) => ({ ...v, tx: r.width / 2, ty: r.height / 2 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop the browser from page-zooming on a trackpad pinch (ctrl+wheel) or
  // Safari gesture events, app-wide. Non-ctrl wheel (e.g. inspector scroll) is
  // left alone; the canvas's own wheel listener handles canvas zoom.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    const onGesture = (e: Event) => e.preventDefault();
    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("gesturestart", onGesture);
    document.addEventListener("gesturechange", onGesture);
    document.addEventListener("gestureend", onGesture);
    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("gesturestart", onGesture);
      document.removeEventListener("gesturechange", onGesture);
      document.removeEventListener("gestureend", onGesture);
    };
  }, []);

  function viewportCenterWorld(): Center {
    const svg = scene.svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return scene.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  // Frame a layer: center it and pick a zoom so it fills ~80% of the canvas.
  // (Imported SVGs live in their own large unit space; without this they show
  //  blown-up at 100%.)
  function fitLayerToView(layer: Layer) {
    fitBoundsToView(layer.center, layerReach(layer.params, layer.motif.box, layer.scale));
  }

  // Frame just the active motif (copy 0) for the Design motif editor, so the
  // unit you're editing sits centered instead of jammed at its radial offset.
  function frameMotif(layer: Layer) {
    const center = referenceInstancePoint(layer);
    const half = 0.5 * Math.hypot(layer.motif.box.width, layer.motif.box.height) * layer.scale * layer.params.sourceScale;
    fitBoundsToView(center, Math.max(half * 1.5, 1));
  }

  function fitBoundsToView(center: Center, reach: number) {
    const svg = scene.svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return; // canvas not laid out yet
    const span = Math.max(2 * reach, 1);
    const s = Math.max(0.05, Math.min(4, (0.8 * Math.min(r.width, r.height)) / span));
    setViewport({ s, tx: r.width / 2 - center.x * s, ty: r.height / 2 - center.y * s });
  }

  function fittedMotifParams(motif: Motif): RepeatParams {
    const maxDim = Math.max(motif.box.width, motif.box.height, 1);
    const diag = Math.max(Math.hypot(motif.box.width, motif.box.height), 1);
    const sourceScale = Math.min(1, IMPORT_TARGET_MOTIF_SIZE / maxDim);
    const scaledDiag = diag * sourceScale;
    const spacingRadius = (scaledDiag * 0.72) / (2 * Math.sin(Math.PI / IMPORT_REPEAT_COUNT));
    return {
      ...DEFAULT_PARAMS,
      count: IMPORT_REPEAT_COUNT,
      sourceScale,
      radiusOffset: Math.max(180, Math.round(spacingRadius)),
      scaleStep: 0,
      opacityStep: 0,
      paintOffset: 0,
      tuck: true,
    };
  }

  function moveLayerWithAnimation(layer: Layer, delta: Center): Layer {
    return {
      ...layer,
      center: { x: layer.center.x + delta.x, y: layer.center.y + delta.y },
      animation:
        layer.animation?.type === "centerPath"
          ? translateCenterPathAnimation(layer.animation, delta)
          : layer.animation,
      updatedAt: Date.now(),
    };
  }

  // --- Editing: absolute (discrete) and delta (continuous) over the selection ---
  const onCommitAbsolute = (partial: Partial<RepeatParams>) => {
    const ids = editableIdsRef.current;
    updateLayers((ls) =>
      ls.map((l) =>
        ids.has(l.id)
          ? { ...l, params: { ...l.params, ...partial }, updatedAt: Date.now() }
          : l
      )
    );
  };
  const onCommitDelta = (key: NumericParamKey, delta: number) => {
    const ids = editableIdsRef.current;
    updateLayers((ls) =>
      ls.map((l) =>
        ids.has(l.id)
          ? { ...l, params: { ...l.params, [key]: l.params[key] + delta }, updatedAt: Date.now() }
          : l
      )
    );
  };

  // Remembers the layer grabbed for a move and whether it was part of a
  // multi-selection, so a click (no drag) on it can isolate it.
  const lastGrab = useRef<{ id: string; multi: boolean } | null>(null);
  const moveBegin = useMoveDrag(scene, {
    onStart: () => setDragging(true),
    onCommit: (ids, delta) => {
      const moved = Math.hypot(delta.x, delta.y) >= 1;
      if (moved) {
        // Single React commit applying the gesture delta to every grabbed layer.
        const idset = new Set(ids);
        updateLayers((ls) => ls.map((l) => (idset.has(l.id) ? moveLayerWithAnimation(l, delta) : l)));
      } else if (lastGrab.current?.multi) {
        // A click (no drag) on a layer inside a multi-selection isolates it.
        selectSingle(lastGrab.current.id);
      }
      lastGrab.current = null;
      setDragging(false);
    },
  });

  const onResizePointerDown = useResizeDrag(scene, {
    onStart: () => setDragging(true),
    onCommit: (factor) => {
      // After an Option-duplicate the selection is the copies, so this scales the
      // new layers; otherwise it scales the originals.
      const ids = editableIdsRef.current;
      if (factor !== 1) {
        updateLayers((ls) =>
          ls.map((l) =>
            ids.has(l.id) ? { ...l, scale: l.scale * factor, updatedAt: Date.now() } : l
          )
        );
      }
      setDragging(false);
    },
    // Option/Alt at grab: duplicate the selected layers in place and select the
    // copies, so the resize then continues on the new layers. PRD alt-drag.
    onDuplicate: () => {
      const ids = editableIdsRef.current;
      if (ids.size === 0) return;
      commitDocument((doc) => {
        const { layers: next, newIds } = duplicateLayers(doc.layers, new Set(ids));
        return { ...doc, layers: next, selectedIds: newIds };
      });
    },
  });

  // Composite rotation: the gizmo's rotate knob spins the whole selection around
  // its union center by changing each layer's angle offset.
  const gizmoCenterRef = useRef<Center>({ x: 0, y: 0 });
  gizmoCenterRef.current = gizmo ? { x: gizmo.cx, y: gizmo.cy } : { x: 0, y: 0 };
  const onRotatePointerDown = useRotateDrag(scene, {
    getPivot: () => gizmoCenterRef.current,
    key: "angleOffset",
    onStart: () => setDragging(true),
    onCommit: (key, delta) => {
      onCommitDelta(key, delta);
      setDragging(false);
    },
  });

  // --- Individual component edit (move/resize/rotate/color one copy) ---
  // The on-canvas gizmo (ComponentEditLayer) owns all three gestures; here we
  // just track which copy is being edited and commit symmetric param changes.
  const componentLayer = componentEdit ? layers.find((l) => l.id === componentEdit.layerId) ?? null : null;
  function enterComponentEdit(layerId: string, index: number) {
    const l = docRef.current.layers.find((x) => x.id === layerId);
    if (!l || l.locked || !l.visible) return;
    updateSelection([layerId]);
    setComponentEdit({ layerId, index });
  }
  const exitComponentEdit = () => setComponentEdit(null);

  // --- Motif sub-part edit ---
  const partLayer = partEdit ? layers.find((l) => l.id === partEdit.layerId) ?? null : null;
  const editedPart = partLayer && partEdit?.partId ? partLayer.motif.parts?.find((p) => p.id === partEdit.partId) ?? null : null;

  // --- Color ---
  // The swatch reflects the edited part, else the edited component, else the
  // selected layer, else the default. Changing it sets the matching override.
  const swatchColor = editedPart
    ? partColor(editedPart) ?? fillColor
    : componentEdit && componentLayer
    ? componentLayer.components[componentEdit.index]?.fill ?? motifFillColor(componentLayer.motif) ?? fillColor
    : primary && primary.visible && !primary.locked
    ? motifFillColor(primary.motif) ?? fillColor
    : fillColor;
  function applyColor(color: string) {
    // Whatever color you pick also becomes the working default that new pencil
    // shapes inherit — so it carries forward even when it was applied to an
    // existing part, component or layer.
    setFillColor(color);
    if (partEdit?.partId) {
      const pid = partEdit.partId;
      updateLayers((ls) =>
        ls.map((l) => (l.id === partEdit.layerId ? { ...l, motif: setPartFill(l.motif, pid, color), updatedAt: Date.now() } : l))
      );
      return;
    }
    if (componentEdit) {
      updateLayers((ls) =>
        ls.map((l) =>
          l.id === componentEdit.layerId
            ? { ...l, components: { ...l.components, [componentEdit.index]: { ...l.components[componentEdit.index], fill: color } }, updatedAt: Date.now() }
            : l
        )
      );
      return;
    }
    const ids = editableIdsRef.current;
    if (ids.size > 0) {
      updateLayers((ls) =>
        ls.map((l) => (ids.has(l.id) ? { ...l, motif: recolorMotif(l.motif, color), updatedAt: Date.now() } : l))
      );
    }
  }
  async function pickColor() {
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!ED) {
      setNotice("Eyedropper isn’t supported in this browser.");
      return;
    }
    try {
      const res = await new ED().open();
      applyColor(res.sRGBHex);
    } catch {
      /* user cancelled */
    }
  }

  // --- Selection actions ---
  const selectSingle = (id: string, additive = false) => {
    // Selecting a layer (panel row or canvas grab) ends any sub-part edit.
    if (docRef.current.partEdit) setPartEdit(null);
    const group = groupForLayer(docRef.current.groups, id);
    const ids = group?.layerIds ?? [id];
    updateSelection((prev) => {
      if (!additive) return ids;
      const next = new Set(prev);
      const allIn = ids.every((x) => next.has(x));
      ids.forEach((x) => {
        if (allIn) next.delete(x);
        else next.add(x);
      });
      return Array.from(next);
    });
  };
  const selectAll = () => updateSelection(docRef.current.layers.map((l) => l.id));
  const collapseToPrimary = () =>
    updateSelection((prev) => (prev.length ? [prev[prev.length - 1]] : []));

  function groupSelectedLayers() {
    commitDocument((doc) => {
      const selected = new Set(expandGroupedIds(doc.selectedIds, doc.groups));
      const { groups: nextGroups, group } = createLayerGroup(doc.layers, doc.groups, selected);
      if (!group) return doc;
      return { ...doc, groups: nextGroups, selectedIds: group.layerIds };
    });
  }

  function ungroupSelectedLayers() {
    commitDocument((doc) => {
      const selected = new Set(expandGroupedIds(doc.selectedIds, doc.groups));
      const nextGroups = removeGroupsForLayerIds(doc.groups, selected);
      return nextGroups === doc.groups ? doc : { ...doc, groups: nextGroups };
    });
  }

  function ungroupGroup(groupId: string) {
    commitDocument((doc) => {
      const group = doc.groups.find((g) => g.id === groupId);
      if (!group) return doc;
      return {
        ...doc,
        groups: doc.groups.filter((g) => g.id !== groupId),
        selectedIds: group.layerIds,
      };
    });
  }

  // Marquee (click-drag) selection: select every visible, unlocked layer whose
  // artwork box intersects the dragged rectangle. Shift adds to the selection.
  const onMarqueeSelect = (rect: WorldRect, additive: boolean) => {
    const hit = layers
      .filter(
        (l) =>
          l.visible &&
          !l.locked &&
          boxIntersects(rect, l.center, layerReach(l.params, l.motif.box, l.scale))
      )
      .map((l) => l.id);
    updateSelection((prev) =>
      expandGroupedIds(additive ? Array.from(new Set([...prev, ...hit])) : hit)
    );
  };

  // Grab a layer's artwork: shift toggles selection (no move); otherwise select
  // it if needed and start moving the (whole) selection.
  const onLayerPointerDown = (e: React.PointerEvent, id: string, additive: boolean) => {
    if (additive) {
      selectSingle(id, true);
      return;
    }
    const groupIds = groupForLayer(docRef.current.groups, id)?.layerIds ?? [id];
    const alreadySelected = selectedSet.has(id);
    const moveIds = alreadySelected
      ? [...editableIdsRef.current]
      : groupIds.filter((memberId) => docRef.current.layers.some((l) => l.id === memberId && l.visible && !l.locked));
    lastGrab.current = { id, multi: alreadySelected && editableIdsRef.current.size > 1 };
    if (!alreadySelected) selectSingle(id);
    moveBegin(e, moveIds);
  };

  // Apply a patch to every editable-selected layer that has an animation.
  function updatePrimaryAnimation(patch: (animation: CenterPathAnimation) => CenterPathAnimation) {
    const ids = editableIdsRef.current;
    updateLayers((ls) =>
      ls.map((l) =>
        ids.has(l.id) && l.animation?.type === "centerPath"
          ? { ...l, animation: patch(l.animation), updatedAt: Date.now() }
          : l
      )
    );
  }

  // Default (all-off) effect set; first toggle in the inspector materializes it.
  function createEffects(): LayerEffects {
    return {
      individualSpin: { enabled: false, periodSeconds: 6, direction: "cw", stagger: false },
      compositeSpin: { enabled: false, periodSeconds: 12, direction: "cw" },
      scalePulse: { enabled: false, periodSeconds: 3, amount: 0.2, stagger: false },
      radialPulse: { enabled: false, periodSeconds: 3, amount: 40, stagger: false },
      wave: { enabled: false, periodSeconds: 4, amount: 40, frequency: 3, direction: "cw", stagger: false },
    };
  }
  // Apply a patch to every editable-selected layer's effects (seeding defaults).
  function updateEffects(patch: (e: LayerEffects) => LayerEffects) {
    const ids = editableIdsRef.current;
    updateLayers((ls) =>
      ls.map((l) =>
        ids.has(l.id)
          ? { ...l, effects: patch({ ...createEffects(), ...(l.effects ?? {}) }), updatedAt: Date.now() }
          : l
      )
    );
  }

  // Switch editor mode, tidying up mode-specific edit state. Component edit
  // belongs to Arrange, part edit to Design; neither should leak across.
  const switchMode = (m: EditorMode) => {
    if (m !== "animate") {
      setPlayingIds(new Set());
      setDrawingMotionPath(false);
    }
    setComponentEdit(null);
    setPartEdit(null);
    // Re-frame on the design↔(arrange/animate) transition: Design centers the
    // active motif (copy 0) for editing; the others fit the whole repeat.
    if (primary) {
      if (m === "design" && mode !== "design") frameMotif(primary);
      else if (m !== "design" && mode === "design") fitLayerToView(primary);
    }
    setMode(m);
  };

  // Enter (or cancel) pencil draw mode for the motion path. The animation itself
  // is only created once a path is actually drawn (onMotionPathDrawn) — so
  // clicking the button never alters the artwork or drops a confusing default.
  function beginAnimateCenter() {
    if (editableIdsRef.current.size === 0) return;
    setDrawingMotionPath((d) => !d);
  }

  // Commit a freehand-drawn motion path. The drawn SHAPE (points relative to the
  // first point) is shared by every selected layer, anchored at each layer's own
  // reference point — so a multi-selection animates with one path shape.
  function onMotionPathDrawn(rawPoints: Center[]) {
    if (rawPoints.length < 2) return;
    const pts = downsamplePath(rawPoints, 48);
    const p0 = pts[0];
    const rel = pts.map((p) => ({ x: p.x - p0.x, y: p.y - p0.y }));
    const ids = editableIdsRef.current;
    updateLayers((ls) =>
      ls.map((l) => {
        if (!ids.has(l.id)) return l;
        const ref = referenceInstancePoint(l);
        const points = rel.map((r) => ({ x: ref.x + r.x, y: ref.y + r.y }));
        const current = l.animation?.type === "centerPath" ? l.animation : createCenterPathAnimation(l);
        return { ...l, animation: { ...current, path: { ...current.path, points } }, updatedAt: Date.now() };
      })
    );
    setDrawingMotionPath(false);
  }

  function deletePrimaryAnimation() {
    const ids = editableIdsRef.current;
    updateLayers((ls) =>
      ls.map((l) => (ids.has(l.id) ? { ...l, animation: undefined, updatedAt: Date.now() } : l))
    );
    setDrawingMotionPath(false);
  }

  // --- Layer operations ---
  function addLayerFromMotif(motif: Motif, name: string, params = DEFAULT_PARAMS) {
    const layer = createLayer({ name, motif, params, center: viewportCenterWorld() });
    commitDocument((doc) => ({
      ...doc,
      layers: [...doc.layers, layer],
      selectedIds: [layer.id],
    }));
    return layer;
  }
  function onNewLayer() {
    const motif = primary?.motif ?? importSvgFromText(DEFAULT_MOTIF_SVG);
    newLayerCount.current += 1;
    addLayerFromMotif(motif, `Radial Repeat ${newLayerCount.current}`);
  }

  async function motifFromLibraryItem(item: MotifLibraryItem): Promise<Motif> {
    return importSvgFromText(await item.loadSvg());
  }

  async function applyLibraryMotif(item: MotifLibraryItem) {
    try {
      const motif = await motifFromLibraryItem(item);
      const params = fittedMotifParams(motif);
      const ids = editableIdsRef.current;
      if (ids.size === 0) {
        newLayerCount.current += 1;
        const layer = addLayerFromMotif(motif, item.name, params);
        fitLayerToView(layer);
        setNotice(motif.simplified ? "This library SVG was simplified on import." : null);
        return;
      }
      const primaryForFit = docRef.current.layers.find((l) => l.id === docRef.current.primaryId);
      updateLayers((ls) =>
        ls.map((l) =>
          ids.has(l.id)
            ? { ...l, motif, params, components: {}, updatedAt: Date.now() }
            : l
        )
      );
      if (primaryForFit) {
        fitBoundsToView(primaryForFit.center, layerReach(params, motif.box, primaryForFit.scale));
      }
      setComponentEdit(null);
      setPartEdit(null);
      setNotice(motif.simplified ? "This library SVG was simplified on import." : null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load that library motif.");
    }
  }

  async function addLibraryMotif(item: MotifLibraryItem) {
    try {
      const motif = await motifFromLibraryItem(item);
      newLayerCount.current += 1;
      const layer = addLayerFromMotif(motif, item.name, fittedMotifParams(motif));
      fitLayerToView(layer);
      setNotice(motif.simplified ? "This library SVG was simplified on import." : null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load that library motif.");
    }
  }

  // Pencil commit: a finished stroke becomes a filled path. The first stroke
  // creates a plain single-instance drawn layer (no repeat yet); subsequent
  // strokes APPEND to it so you can compose a shape from several lines. PRD §8,§15A.
  function onDrawCommit(points: Center[]) {
    const sp = strokeToFilledPath(points, pencil.size / viewport.s, pencil.smoothing, fillColor);
    if (!sp) return; // tiny stroke / stray click — silently ignored. PRD §18.

    const curId = currentDrawingRef.current;
    const cur = curId ? docRef.current.layers.find((l) => l.id === curId) : null;
    if (cur) {
      const box = unionBox(cur.motif.box, sp.box);
      const c = boxCenter(box);
      updateLayers((ls) =>
        ls.map((l) =>
          l.id === curId
            ? {
                ...l,
                // append the new path; re-anchor + re-center on the union bbox so
                // every stroke stays where it was drawn. PRD §13.
                motif: {
                  ...appendPart(l.motif, singlePart(sp.pathHtml, `Shape ${l.motif.weight + 1}`, sp.box)),
                  box,
                  anchorX: c.x,
                  anchorY: c.y,
                  weight: l.motif.weight + 1,
                },
                center: c,
                updatedAt: Date.now(),
              }
            : l
        )
      );
      return;
    }

    drawnCount.current += 1;
    const c = boxCenter(sp.box);
    const layer = createLayer({
      name: `Drawn Shape ${drawnCount.current}`,
      motif: {
        innerHtml: sp.pathHtml,
        parts: [singlePart(sp.pathHtml, "Shape 1", sp.box)],
        anchorX: c.x,
        anchorY: c.y,
        box: sp.box,
        weight: 1,
        simplified: false,
      },
      params: DRAWN_PARAMS,
      center: c,
    });
    currentDrawingRef.current = layer.id;
    commitDocument((doc) => ({ ...doc, layers: [...doc.layers, layer], selectedIds: [layer.id] }));
  }

  /** End the current drawing so the next stroke starts a fresh shape. */
  function finishDrawing() {
    currentDrawingRef.current = null;
  }
  /** Switch tools, always ending any in-progress drawing. */
  function switchTool(next: "select" | "pencil") {
    currentDrawingRef.current = null;
    setTool(next);
  }

  // "Create Radial Repeat": turn a single-instance layer (e.g. a fresh drawing)
  // into a repeat using the default count/radius. PRD §15A.
  const canRadialize = !!primary && primary.params.count === 1;
  function radializePrimary() {
    if (!primaryId) return;
    finishDrawing();
    updateLayers((ls) =>
      ls.map((l) =>
        l.id === primaryId
          ? {
              ...l,
              params: {
                ...l.params,
                count: DEFAULT_PARAMS.count,
                radiusOffset: DEFAULT_PARAMS.radiusOffset,
                tuck: DEFAULT_PARAMS.tuck,
              },
              updatedAt: Date.now(),
            }
          : l
      )
    );
  }
  function onDuplicate(id: string) {
    commitDocument((doc) => {
      const original = doc.layers.find((l) => l.id === id);
      if (!original) return doc;
      const copy = duplicateLayer(original);
      return {
        ...doc,
        layers: insertAbove(doc.layers, copy, id),
        selectedIds: [copy.id],
      };
    });
  }
  // Duplicate every selected layer at once (the toolbar action + ⌘D). Each copy
  // lands directly above its original; the copies become the new selection.
  function onDuplicateSelected() {
    commitDocument((doc) => {
      if (doc.selectedIds.length === 0) return doc;
      const { layers: next, newIds } = duplicateLayers(doc.layers, new Set(doc.selectedIds));
      return { ...doc, layers: next, selectedIds: newIds };
    });
  }
  function onDelete(id: string) {
    commitDocument((doc) => {
      const idx = doc.layers.findIndex((l) => l.id === id);
      if (idx < 0) return doc;
      const next = removeLayer(doc.layers, id);
      const kept = doc.selectedIds.filter((x) => x !== id);
      const fallback = next[Math.min(idx, next.length - 1)];
      return {
        ...doc,
        layers: next,
        groups: pruneGroups(removeGroupsForLayerIds(doc.groups, new Set([id])), next),
        selectedIds: kept.length ? kept : fallback ? [fallback.id] : [],
      };
    });
  }
  function onDeleteSelected() {
    commitDocument((doc) => {
      if (doc.selectedIds.length === 0) return doc;
      const ids = new Set(expandGroupedIds(doc.selectedIds, doc.groups));
      const next = doc.layers.filter((l) => !ids.has(l.id));
      const fallback = next[next.length - 1];
      return {
        ...doc,
        layers: next,
        groups: pruneGroups(removeGroupsForLayerIds(doc.groups, ids), next),
        selectedIds: fallback ? [fallback.id] : [],
      };
    });
  }
  const onRename = (id: string, name: string) =>
    updateLayers((ls) => updateLayer(ls, id, (l) => ({ ...l, name, updatedAt: Date.now() })));
  const onToggleVisible = (id: string) => {
    if (docRef.current.dragging) return; // no visibility changes mid-gesture. PRD §17.
    updateLayers((ls) => updateLayer(ls, id, (l) => ({ ...l, visible: !l.visible, updatedAt: Date.now() })));
  };
  const onToggleLocked = (id: string) => {
    if (docRef.current.dragging) return;
    updateLayers((ls) => updateLayer(ls, id, (l) => ({ ...l, locked: !l.locked, updatedAt: Date.now() })));
  };
  // Toggle one motif sub-part's visibility (affects every copy in the ring).
  const onTogglePart = (layerId: string, partId: string) => {
    if (docRef.current.dragging) return;
    updateLayers((ls) =>
      updateLayer(ls, layerId, (l) => {
        const part = l.motif.parts?.find((p) => p.id === partId);
        return part ? { ...l, motif: setPartVisible(l.motif, partId, !part.visible), updatedAt: Date.now() } : l;
      })
    );
  };
  // Double-click a layer's artwork to drill into its parts: they become clickable
  // on the canvas. Only worth it for multi-part motifs.
  const enterPartMode = (layerId: string, index = 0) => {
    const l = docRef.current.layers.find((x) => x.id === layerId);
    // Even a single-shape motif is part-editable (move/resize/recolor the shape).
    if (!l || l.locked || (l.motif.parts?.length ?? 0) < 1) return;
    setComponentEdit(null);
    updateSelection([layerId]);
    setPartEdit({ layerId, partId: null, index });
  };
  // Select a motif sub-part for editing (color/move/rotate). Selects its layer
  // and clears any component edit so the two edit modes stay exclusive.
  const onSelectPart = (layerId: string, partId: string) => {
    const l = docRef.current.layers.find((x) => x.id === layerId);
    if (!l || l.locked) return;
    setComponentEdit(null);
    updateSelection([layerId]);
    setPartEdit((prev) => ({ layerId, partId, index: prev && prev.layerId === layerId ? prev.index : 0 }));
  };
  const onReorderPart = (layerId: string, draggedId: string, targetId: string) => {
    updateLayers((ls) =>
      updateLayer(ls, layerId, (l) => ({ ...l, motif: reorderParts(l.motif, draggedId, targetId), updatedAt: Date.now() }))
    );
  };
  const onSetPartTransform = (layerId: string, partId: string, transform: PartTransform) => {
    updateLayers((ls) =>
      updateLayer(ls, layerId, (l) => ({ ...l, motif: setPartTransform(l.motif, partId, transform), updatedAt: Date.now() }))
    );
  };
  // Alt-drag a part to copy it: the copy takes the gesture's transform; select it.
  const onDuplicatePart = (layerId: string, partId: string, transform: PartTransform) => {
    const newId = newPartId();
    updateLayers((ls) =>
      updateLayer(ls, layerId, (l) => ({ ...l, motif: duplicatePart(l.motif, partId, newId, transform), updatedAt: Date.now() }))
    );
    setPartEdit((prev) => ({ layerId, partId: newId, index: prev?.layerId === layerId ? prev.index : 0 }));
  };
  const onMove = (id: string, dir: MoveDir) => {
    updateLayers((ls) => {
      switch (dir) {
        case "front": return moveToFront(ls, id);
        case "forward": return moveForward(ls, id);
        case "backward": return moveBackward(ls, id);
        case "back": return moveToBack(ls, id);
      }
    });
  };
  const onReorder = (draggedId: string, targetId: string) =>
    updateLayers((ls) => reorderByDisplay(ls, draggedId, targetId));

  function resetCenter() {
    const ids = editableIdsRef.current;
    const w = viewportCenterWorld();
    updateLayers((ls) =>
      ls.map((l) =>
        ids.has(l.id)
          ? moveLayerWithAnimation(l, { x: w.x - l.center.x, y: w.y - l.center.y })
          : l
      )
    );
  }

  async function loadFile(file: File) {
    try {
      const m = await importSvgFromFile(file);
      newLayerCount.current += 1;
      const layer = addLayerFromMotif(m, `Imported ${newLayerCount.current}`, fittedMotifParams(m));
      fitLayerToView(layer);
      setNotice(m.simplified ? "This SVG was simplified on import." : null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not import that file.");
    }
  }
  function onExport() {
    downloadSvg(buildExportSvgFromRenderedLayers(scene.layersRootRef.current) ?? buildExportSvg(layers));
  }
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Keyboard shortcuts (PRD §16). Skip when typing in a field. ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const { primaryId: id } = docRef.current;
      const mod = e.metaKey || e.ctrlKey;

      if (typing) return;
      if (e.key === "Escape" && docRef.current.partEdit) {
        setPartEdit(null);
        return;
      }
      if (e.key === "Escape" && docRef.current.componentEdit) {
        setComponentEdit(null);
        return;
      }
      if (e.key === "Escape" && docRef.current.tool === "pencil") {
        currentDrawingRef.current = null;
        setTool("select");
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === "Escape" && docRef.current.selectedIds.length > 1) {
        collapseToPrimary();
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelectedLayers();
        else groupSelectedLayers();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        onDuplicateSelected();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDeleteSelected();
        return;
      }
      if (mod && e.key === "]") {
        e.preventDefault();
        if (id) onMove(id, e.shiftKey ? "front" : "forward");
        return;
      }
      if (mod && e.key === "[") {
        e.preventDefault();
        if (id) onMove(id, e.shiftKey ? "back" : "backward");
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editableForControls = editableSelected.length > 0;

  // --- Timeline clock (visual; playback itself is CSS-driven) ---
  const animTotal = useMemo(() => {
    const t = layers
      .filter((l) => l.animation?.enabled)
      .map((l) => l.animation!.delaySeconds + l.animation!.durationSeconds);
    return t.length ? Math.max(...t) : 4;
  }, [layers]);

  useEffect(() => {
    if (!anyPlaying) return;
    let raf = 0;
    let start = performance.now() - playTime * 1000;
    const tick = (now: number) => {
      let t = (now - start) / 1000;
      if (t >= animTotal) {
        if (loop) { start = now; t = 0; } else { t = animTotal; }
      }
      setPlayTime(t);
      if (t < animTotal || loop) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyPlaying, animTotal, loop]);

  function zoomBy(factor: number) {
    const svg = scene.svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    setViewport((v) => {
      const s = Math.max(0.1, Math.min(8, v.s * factor));
      const wx = (cx - v.tx) / v.s;
      const wy = (cy - v.ty) / v.s;
      return { s, tx: cx - wx * s, ty: cy - wy * s };
    });
  }

  const fileItems = [
    { label: "Import SVG…", icon: Icon.upload, onClick: () => fileInputRef.current?.click() },
    { label: "New layer", icon: Icon.add, onClick: onNewLayer },
    { sep: true as const },
    { label: "Export SVG", icon: Icon.download, onClick: onExport },
    { label: "Export animated SVG", icon: Icon.sparkle, onClick: () => downloadSvg(buildAnimatedExportSvg(layers), "radial-repeat-animated.svg") },
  ];
  const exportItems = [
    { label: "Expanded SVG", icon: Icon.download, onClick: onExport },
    { label: "Animated SVG", icon: Icon.sparkle, onClick: () => downloadSvg(buildAnimatedExportSvg(layers), "radial-repeat-animated.svg") },
  ];

  return (
    <div className="app" data-mode={mode}>
      <header className="topbar">
        <div className="tb-left">
          <div className="brand">
            <span className="brand-mark" />
            <span className="brand-name">Radial Repeat<span className="brand-dim"> Studio</span></span>
          </div>
          <div className="tb-divider" />
          <input
            ref={fileInputRef}
            type="file"
            accept=".svg,image/svg+xml"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }}
          />
          <div className="menu-wrap">
            <button className="btn btn-ghost" onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}>
              {Icon.file({ size: 15 })} File {Icon.chevron({ size: 13, style: { opacity: 0.6 } })}
            </button>
            {openMenu === "file" && (
              <>
                <div className="scrim" onPointerDown={() => setOpenMenu(null)} />
                <div className="menu left">
                  {fileItems.map((it, i) => it.sep ? <div key={i} className="menu-sep" /> : (
                    <button key={i} className="menu-item" onClick={() => { setOpenMenu(null); it.onClick!(); }}>
                      {it.icon!({ size: 15 })}<span>{it.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="tb-center">
          <div className="mode-switch">
            <button className={`mode-btn${mode === "design" ? " is-active" : ""}`} data-m="design" onClick={() => switchMode("design")}>
              <span className="dot" /> Design
            </button>
            <button className={`mode-btn${mode === "arrange" ? " is-active" : ""}`} data-m="arrange" onClick={() => switchMode("arrange")}>
              <span className="dot" /> Arrange
            </button>
            <button className={`mode-btn${mode === "animate" ? " is-active" : ""}`} data-m="animate" onClick={() => switchMode("animate")}>
              <span className="dot" /> Animate
            </button>
          </div>
        </div>

        <div className="tb-right">
          <button className="iconbtn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">{Icon.undo()}</button>
          <button className="iconbtn" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)">{Icon.redo()}</button>
          <div className="tb-divider" />
          <div className="menu-wrap">
            <button className="btn btn-accent" onClick={() => setOpenMenu(openMenu === "export" ? null : "export")}>
              {Icon.download({ size: 15 })} Export {Icon.chevron({ size: 13 })}
            </button>
            {openMenu === "export" && (
              <>
                <div className="scrim" onPointerDown={() => setOpenMenu(null)} />
                <div className="menu right">
                  {exportItems.map((it, i) => (
                    <button key={i} className="menu-item" onClick={() => { setOpenMenu(null); it.onClick(); }}>
                      {it.icon({ size: 15 })}<span>{it.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="middle">
        <LayersPanel
          mode={mode}
          primaryId={primaryId}
          layers={layers}
          groups={groups}
          selectedIds={selectedSet}
          dragging={dragging}
          onSelect={selectSingle}
          onGroupSelection={groupSelectedLayers}
          onUngroupSelection={ungroupSelectedLayers}
          onUngroupGroup={ungroupGroup}
          canGroupSelection={canGroupSelection}
          canUngroupSelection={canUngroupSelection}
          onRename={onRename}
          onToggleVisible={onToggleVisible}
          onToggleLocked={onToggleLocked}
          onTogglePart={onTogglePart}
          onSelectPart={onSelectPart}
          onReorderPart={onReorderPart}
          selectedPart={partEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onMove={onMove}
          onReorder={onReorder}
          onNewLayer={onNewLayer}
        />

        <div
          className={`canvas-area${mode === "animate" ? " mode-animate" : ""}${tool === "pencil" ? " tool-pencil" : ""}${dragging ? " is-moving" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); }}
        >
          {/* tool rail (select / pencil / eyedropper + always-on color swatch).
              Hidden in Animate mode — those tools only apply to design editing. */}
          {mode === "design" && (
          <div className="tool-rail">
            <button className={`tool-btn${tool === "select" ? " is-active" : ""}`} onClick={() => switchTool("select")} title="Select / move (V)">{Icon.cursor()}</button>
            <button className={`tool-btn${tool === "pencil" ? " is-active" : ""}`} onClick={() => switchTool(tool === "pencil" ? "select" : "pencil")} title="Pencil — draw a shape (P)">{Icon.pen()}</button>
            <button className="tool-btn" onClick={pickColor} title="Eyedropper — pick a color from screen">{Icon.eyedropper({ size: 18 })}</button>
            <div className="tool-rail-sep" />
            <label className="tool-swatch" title={primary && tool === "select" ? "Layer fill" : "Default fill for new shapes"} style={{ background: swatchColor }}>
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(swatchColor) ? swatchColor : "#000000"}
                onChange={(e) => applyColor(e.target.value)} />
            </label>
          </div>
          )}

          {tool === "pencil" && (
            <div className="pencil-panel">
              <div className="pp-title">Pencil</div>
              <label>Size<span className="ctl-val">{pencil.size}</span>
                <input type="range" min={2} max={80} step={1} value={pencil.size}
                  onChange={(e) => setPencil((p) => ({ ...p, size: parseInt(e.target.value, 10) }))} />
              </label>
              <label>Smoothing<span className="ctl-val">{pencil.smoothing}</span>
                <input type="range" min={0} max={100} step={1} value={pencil.smoothing}
                  onChange={(e) => setPencil((p) => ({ ...p, smoothing: parseInt(e.target.value, 10) }))} />
              </label>
              <div className="pp-actions">
                <button className="btn" onClick={finishDrawing} title="Start a separate shape">New Shape</button>
                <button className="btn btn-accent" onClick={() => switchTool("select")}>Done</button>
              </div>
            </div>
          )}

          {/* floating contextual toolbar */}
          {primary && tool === "select" && !componentEdit && !partEdit && (
            <div className="ctx-toolbar">
              <span className="ctx-label">
                <span className="ctx-swatch" /> <b>{selectedIds.length > 1 ? `${selectedIds.length} layers` : primary.name}</b>
                {selectedIds.length <= 1 && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)" }}>{primary.params.count}×</span>}
              </span>
              <button className="ctx-btn" onClick={onDuplicateSelected}>{Icon.duplicate({ size: 15 })} Duplicate</button>
              <button className="ctx-btn" onClick={resetCenter} disabled={!editableForControls}>{Icon.target({ size: 15 })} Center</button>
              {canRadialize && <button className="ctx-btn" onClick={radializePrimary}>{Icon.sparkle({ size: 15 })} Radialize</button>}
              <button className="ctx-btn danger" onClick={onDeleteSelected}>{Icon.trash({ size: 15 })} Delete</button>
            </div>
          )}

          <Canvas
            layers={layers}
            selectedIds={selectedSet}
            gizmo={componentEdit || partEdit || mode === "design" ? null : gizmo}
            selectionBoxes={componentEdit || partEdit || mode === "design" ? [] : selectionBoxes}
            designView={mode === "design" ? designView : null}
            dblClickTarget={mode === "design" ? "part" : mode === "arrange" ? "component" : null}
            componentEdit={componentEdit}
            onComponentSelect={enterComponentEdit}
            onComponentExit={exitComponentEdit}
            onCommitComponent={onCommitAbsolute}
            partEdit={partEdit}
            onEnterPartMode={enterPartMode}
            onSelectPart={onSelectPart}
            onCommitPartTransform={onSetPartTransform}
            onDuplicatePart={onDuplicatePart}
            onExitPart={() => setPartEdit(null)}
            motionCss={motionCss}
            motionPath={mode === "animate" ? primaryMotionPath : null}
            drawingMotionPath={mode === "animate" && drawingMotionPath}
            motionAnchor={mode === "animate" ? motionAnchor : null}
            animationsMoving={anyPlaying && mode === "animate" && !dragging && tool !== "pencil"}
            tool={tool}
            pencil={pencil}
            fillColor={fillColor}
            onDrawCommit={onDrawCommit}
            viewport={viewport}
            dragging={dragging}
            setDragging={setDragging}
            scene={scene}
            onLayerPointerDown={onLayerPointerDown}
            onMarqueeSelect={onMarqueeSelect}
            onMotionPathDrawn={onMotionPathDrawn}
            onResizePointerDown={onResizePointerDown}
            onRotatePointerDown={onRotatePointerDown}
            onZoom={zoomAt}
            panBy={panBy}
          />

          {/* zoom cluster */}
          <div className="zoom-cluster">
            <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out">{Icon.minus({ size: 16 })}</button>
            <span className="zoom-val">{Math.round(viewport.s * 100)}%</span>
            <button onClick={() => zoomBy(1.2)} title="Zoom in">{Icon.plus({ size: 16 })}</button>
          </div>

          {/* hint chip */}
          <div className="canvas-hint">
            {mode === "animate" && drawingMotionPath
              ? <>{Icon.pen({ size: 14 })} Draw the path each copy follows · relative to the center</>
              : tool === "pencil"
              ? <>{Icon.pen({ size: 14 })} Draw a shape · multiple strokes compose one motif</>
              : partEdit
              ? <>{Icon.cursor({ size: 14 })} Editing parts · click a piece · drag to move · knob to rotate · Esc to back out</>
              : componentEdit
              ? <>{Icon.cursor({ size: 14 })} Editing one copy · drag to move · corners resize · knob rotates · double-click for its parts · Esc to exit</>
              : <>{Icon.cursor({ size: 14 })} Grab artwork to move · double-click to edit a single copy · drag empty canvas to marquee</>}
          </div>

          {notice && <div className="toast toast-warn">{notice}</div>}
        </div>

        <Controls
          mode={mode}
          designView={designView}
          onSetDesignView={setDesignView}
          primary={primary}
          selectionCount={editableSelected.length}
          allSelected={allSelected}
          editable={editableForControls}
          primaryParamsRef={primaryParamsRef}
          applyParamDelta={scene.applyParamDelta}
          onCommitDelta={onCommitDelta}
          onCommitAbsolute={onCommitAbsolute}
          setDragging={setDragging}
          onToggleVisible={() => primaryId && onToggleVisible(primaryId)}
          onToggleLocked={() => primaryId && onToggleLocked(primaryId)}
          animationEditable={animationEditable}
          drawingMotionPath={drawingMotionPath}
          animationPlaying={primaryId ? playingIds.has(primaryId) : false}
          onBeginAnimateCenter={beginAnimateCenter}
          onTogglePlayback={() => { if (primaryId) toggleLayerPlaying(primaryId); }}
          onDeleteAnimation={deletePrimaryAnimation}
          onUpdateAnimation={updatePrimaryAnimation}
          onUpdateEffects={updateEffects}
          motifLibrary={MOTIF_LIBRARY}
          onApplyLibraryMotif={applyLibraryMotif}
          onAddLibraryMotif={addLibraryMotif}
        />
      </div>

      {mode === "animate" && (
        <Timeline
          layers={layers}
          total={animTotal}
          playTime={playTime}
          playing={anyPlaying}
          playingIds={playingIds}
          loop={loop}
          collapsed={timelineCollapsed}
          selectedId={primaryId}
          onTogglePlay={() => {
            // Transport plays/pauses every composite at once.
            const animated = layers.filter((l) => l.animation?.enabled || anyEffectEnabled(l.effects)).map((l) => l.id);
            setPlayingIds(anyPlaying ? new Set() : new Set(animated));
          }}
          onToggleLayerPlay={toggleLayerPlaying}
          onToStart={() => { setPlayingIds(new Set()); setPlayTime(0); }}
          onToggleLoop={() => setLoop((l) => !l)}
          onToggleCollapse={() => setTimelineCollapsed((c) => !c)}
          onScrub={(t) => setPlayTime(t)}
          onSelect={(id) => selectSingle(id)}
        />
      )}

      <div className="statusbar">
        <span><span className="stat-k">zoom</span>{Math.round(viewport.s * 100)}%</span>
        <span className="stat-sep" />
        <span><span className="stat-k">layers</span>{layers.length}</span>
        <span className="stat-sep" />
        <span><span className="stat-k">mode</span>{mode}</span>
        <span className="status-flex" />
        <span className="status-hints">⌘Z undo · ⌘A all · drag empty = marquee · space/middle = pan · scroll = zoom</span>
      </div>
    </div>
  );
}

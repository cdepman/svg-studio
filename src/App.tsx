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
import { layerReach, unionBounds } from "./canvas/selectionBounds";
import { Controls } from "./controls/Controls";
import { LayersPanel, type MoveDir } from "./layers/LayersPanel";
import { Icon } from "./ui/icons";
import { Timeline } from "./ui/Timeline";
import { DEFAULT_MOTIF_SVG } from "./defaultMotif";
import { importSvgFromFile, importSvgFromText } from "./motif/importSvg";
import { boxCenter, DEFAULT_PENCIL, strokeToFilledPath, unionBox, type PencilSettings } from "./motif/drawnPath";
import {
  buildAnimatedExportSvg,
  buildExportSvg,
  buildExportSvgFromRenderedLayers,
  downloadSvg,
} from "./motif/exportSvg";
import {
  animationPoints,
  centerPathStyles,
  createCenterPathAnimation,
  normalizedAnimation,
  referenceInstancePoint,
  translateCenterPathAnimation,
} from "./motion/centerPath";
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
import type { Center, Layer, LayerGroup, Motif, RepeatParams } from "./types";
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
  orientationMode: "rotateWithCircle",
  mirrorAlternates: false,
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
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [tool, setTool] = useState<"select" | "pencil">("select");
  const [pencil, setPencil] = useState<PencilSettings>(DEFAULT_PENCIL);
  const [mode, setMode] = useState<"design" | "animate">("design");
  const [openMenu, setOpenMenu] = useState<"file" | "export" | null>(null);
  const [loop, setLoop] = useState(true);
  const [playTime, setPlayTime] = useState(0);
  const newLayerCount = useRef(1);
  const drawnCount = useRef(0);
  // The drawn layer that pencil strokes currently append to (multi-stroke shape).
  // Reset by "New Shape", switching tools, or radializing. PRD §8 (multi-line).
  const currentDrawingRef = useRef<string | null>(null);

  const scene = useScene();
  const { viewport, setViewport, onWheel, panBy } = useViewport({ tx: 0, ty: 0, s: 1 });

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
  const animationEditable = !!primary && selectedIds.length === 1 && primary.visible && !primary.locked;
  const canGroupSelection = selectedIds.length >= 2;
  const canUngroupSelection = groups.some((g) => g.layerIds.some((id) => selectedSet.has(id)));
  const motionCss = useMemo(
    () => centerPathStyles(layers.filter((l) => l.visible), animationPlaying && !dragging),
    [layers, animationPlaying, dragging]
  );
  const primaryMotionPath = useMemo(() => {
    if (!primary?.animation || primary.animation.type !== "centerPath") {
      return drawingMotionPath && primary
        ? { start: referenceInstancePoint(primary), end: referenceInstancePoint(primary), closed: false }
        : null;
    }
    const animation = normalizedAnimation(primary.animation);
    const { start, end } = animationPoints(animation, referenceInstancePoint(primary));
    return { start, end, closed: animation.closed || animation.path.closed };
  }, [primary, drawingMotionPath]);

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
          },
        ])
      ),
    [allEditable]
  );
  const primaryParamsRef = useRef<RepeatParams | null>(primary?.params ?? null);
  primaryParamsRef.current = primary?.params ?? null;

  const editableIdsRef = useRef<Set<string>>(new Set());
  editableIdsRef.current = new Set(editableSelected.map((l) => l.id));

  const docRef = useRef({ layers, groups, selectedIds, primaryId, dragging, tool });
  docRef.current = { layers, groups, selectedIds, primaryId, dragging, tool };

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

  // Center the world origin in the viewport once on mount.
  useEffect(() => {
    const svg = scene.svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setViewport((v) => ({ ...v, tx: r.width / 2, ty: r.height / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function viewportCenterWorld(): Center {
    const svg = scene.svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return scene.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
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

  const moveBegin = useMoveDrag(scene, {
    onStart: () => setDragging(true),
    onCommit: (ids, delta) => {
      // Single React commit applying the gesture delta to every grabbed layer.
      if (delta.x !== 0 || delta.y !== 0) {
        const idset = new Set(ids);
        updateLayers((ls) =>
          ls.map((l) =>
            idset.has(l.id)
              ? moveLayerWithAnimation(l, delta)
              : l
          )
        );
      }
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

  // --- Selection actions ---
  const selectSingle = (id: string, additive = false) => {
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
    const moveIds = selectedSet.has(id)
      ? [...editableIdsRef.current]
      : groupIds.filter((memberId) => docRef.current.layers.some((l) => l.id === memberId && l.visible && !l.locked));
    if (!selectedSet.has(id)) selectSingle(id);
    moveBegin(e, moveIds);
  };

  function updatePrimaryAnimation(patch: (animation: CenterPathAnimation) => CenterPathAnimation) {
    if (!primaryId) return;
    updateLayers((ls) =>
      ls.map((l) => {
        if (l.id !== primaryId) return l;
        const current =
          l.animation?.type === "centerPath" ? l.animation : createCenterPathAnimation(l);
        return { ...l, animation: patch(current), updatedAt: Date.now() };
      })
    );
  }

  function beginAnimateCenter() {
    if (!primary || !animationEditable) return;
    updateLayers((ls) =>
      ls.map((l) =>
        l.id === primary.id && !l.animation
          ? { ...l, animation: createCenterPathAnimation(l), updatedAt: Date.now() }
          : l
      )
    );
    setDrawingMotionPath(true);
  }

  function commitMotionPathPoint(handle: "start" | "end", point: Center) {
    if (!primaryId) return;
    updateLayers((ls) =>
      ls.map((l) => {
        if (l.id !== primaryId) return l;
        const current = l.animation?.type === "centerPath" ? l.animation : createCenterPathAnimation(l, point);
        const closed = current.direction === "loop" ? true : current.closed;
        const { start, end } = animationPoints(current, referenceInstancePoint(l));
        const nextStart = handle === "start" ? point : start;
        const nextEnd = handle === "end" ? point : end;
        return {
          ...l,
          animation: {
            ...current,
            closed,
            path: { ...current.path, points: [nextStart, nextEnd], closed },
          },
          updatedAt: Date.now(),
        };
      })
    );
    setDrawingMotionPath(false);
  }

  function deletePrimaryAnimation() {
    if (!primaryId) return;
    updateLayers((ls) =>
      ls.map((l) =>
        l.id === primaryId ? { ...l, animation: undefined, updatedAt: Date.now() } : l
      )
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

  // Pencil commit: a finished stroke becomes a filled path. The first stroke
  // creates a plain single-instance drawn layer (no repeat yet); subsequent
  // strokes APPEND to it so you can compose a shape from several lines. PRD §8,§15A.
  function onDrawCommit(points: Center[]) {
    const sp = strokeToFilledPath(points, pencil.size / viewport.s, pencil.smoothing, pencil.fillColor);
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
                  ...l.motif,
                  innerHtml: l.motif.innerHtml + sp.pathHtml,
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
      motif: { innerHtml: sp.pathHtml, anchorX: c.x, anchorY: c.y, box: sp.box, weight: 1, simplified: false },
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
      addLayerFromMotif(m, `Radial Repeat ${newLayerCount.current}`);
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
    if (!animationPlaying) return;
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
  }, [animationPlaying, animTotal, loop]);

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
            <button className={`mode-btn${mode === "design" ? " is-active" : ""}`} data-m="design" onClick={() => setMode("design")}>
              <span className="dot" /> Design
            </button>
            <button className={`mode-btn${mode === "animate" ? " is-active" : ""}`} data-m="animate" onClick={() => setMode("animate")}>
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
          {/* tool rail */}
          <div className="tool-rail">
            <button className={`tool-btn${tool === "select" ? " is-active" : ""}`} onClick={() => switchTool("select")} title="Select / move (V)">{Icon.cursor()}</button>
            <button className={`tool-btn${tool === "pencil" ? " is-active" : ""}`} onClick={() => switchTool(tool === "pencil" ? "select" : "pencil")} title="Pencil — draw a shape (P)">{Icon.pen()}</button>
          </div>

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
              <label className="pencil-fill">Fill
                <input type="color" value={pencil.fillColor}
                  onChange={(e) => setPencil((p) => ({ ...p, fillColor: e.target.value }))} />
              </label>
              <div className="pp-actions">
                <button className="btn" onClick={finishDrawing} title="Start a separate shape">New Shape</button>
                <button className="btn btn-accent" onClick={() => switchTool("select")}>Done</button>
              </div>
            </div>
          )}

          {/* floating contextual toolbar */}
          {primary && tool === "select" && (
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
            gizmo={gizmo}
            motionCss={motionCss}
            motionPath={primaryMotionPath}
            drawingMotionPath={drawingMotionPath}
            animationsMoving={animationPlaying && !dragging && tool !== "pencil"}
            tool={tool}
            pencil={pencil}
            onDrawCommit={onDrawCommit}
            viewport={viewport}
            dragging={dragging}
            scene={scene}
            onLayerPointerDown={onLayerPointerDown}
            onMarqueeSelect={onMarqueeSelect}
            onMotionPathCommit={commitMotionPathPoint}
            onResizePointerDown={onResizePointerDown}
            onDuplicateSelected={onDuplicateSelected}
            onGroupSelection={groupSelectedLayers}
            onUngroupSelection={ungroupSelectedLayers}
            canGroupSelection={canGroupSelection}
            canUngroupSelection={canUngroupSelection}
            onWheel={onWheel}
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
              ? <>{Icon.pen({ size: 14 })} Drag the path handles to shape the motion</>
              : tool === "pencil"
              ? <>{Icon.pen({ size: 14 })} Draw a shape · multiple strokes compose one motif</>
              : <>{Icon.cursor({ size: 14 })} Grab artwork to move · drag empty canvas to marquee-select</>}
          </div>

          {notice && <div className="toast toast-warn">{notice}</div>}
        </div>

        <Controls
          mode={mode}
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
          animationPlaying={animationPlaying}
          onBeginAnimateCenter={beginAnimateCenter}
          onTogglePlayback={() => setAnimationPlaying((p) => !p)}
          onDeleteAnimation={deletePrimaryAnimation}
          onUpdateAnimation={updatePrimaryAnimation}
        />
      </div>

      {mode === "animate" && (
        <Timeline
          layers={layers}
          total={animTotal}
          playTime={playTime}
          playing={animationPlaying}
          loop={loop}
          selectedId={primaryId}
          onTogglePlay={() => setAnimationPlaying((p) => !p)}
          onToStart={() => { setAnimationPlaying(false); setPlayTime(0); }}
          onToggleLoop={() => setLoop((l) => !l)}
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

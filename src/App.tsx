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
import { DEFAULT_MOTIF_SVG } from "./defaultMotif";
import { importSvgFromFile, importSvgFromText } from "./motif/importSvg";
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
  const newLayerCount = useRef(1);

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

  const docRef = useRef({ layers, groups, selectedIds, primaryId, dragging });
  docRef.current = { layers, groups, selectedIds, primaryId, dragging };

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

  const visibleCount = useMemo(() => layers.filter((l) => l.visible).length, [layers]);
  const editableForControls = editableSelected.length > 0;

  return (
    <div className="app">
      <div className="topbar">
        <strong className="brand">Radial Repeat Studio</strong>
        <button onClick={() => fileInputRef.current?.click()}>Load SVG</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = "";
          }}
        />
        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)">
          Redo
        </button>
        <button
          className={drawingMotionPath ? "active" : ""}
          onClick={beginAnimateCenter}
          disabled={!animationEditable}
        >
          Animate Center
        </button>
        <button onClick={onNewLayer}>New Layer</button>
        <button
          className={allSelected ? "active" : ""}
          onClick={() => (allSelected ? collapseToPrimary() : selectAll())}
          disabled={layers.length === 0}
        >
          {allSelected ? "Selected: All" : "Select All"}
        </button>
        <button onClick={onDuplicateSelected} disabled={selectedIds.length === 0}>
          {selectedIds.length > 1 ? `Duplicate ${selectedIds.length}` : "Duplicate"}
        </button>
        <button onClick={onDeleteSelected} disabled={selectedIds.length === 0}>
          Delete
        </button>
        <button onClick={resetCenter} disabled={!editableForControls}>
          Reset center
        </button>
        <button onClick={onExport}>Export SVG</button>
        <button onClick={() => downloadSvg(buildAnimatedExportSvg(layers), "radial-repeat-animated.svg")}>
          Export Animated SVG
        </button>
        {notice && <span className="notice">{notice}</span>}
      </div>

      <div className="stage">
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
          className="canvas-wrap"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) loadFile(f);
          }}
        >
          <Canvas
            layers={layers}
            selectedIds={selectedSet}
            gizmo={gizmo}
            motionCss={motionCss}
            motionPath={primaryMotionPath}
            drawingMotionPath={drawingMotionPath}
            animationsMoving={animationPlaying && !dragging}
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
        </div>

        <aside className="sidebar">
          <Controls
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
        </aside>
      </div>

      <div className="bottombar">
        <span>Zoom {Math.round(viewport.s * 100)}%</span>
        <span>{layers.length} layers · {visibleCount} visible · {groups.length} groups</span>
        {selectedIds.length > 1 ? (
          <span>{selectedIds.length} selected ({editableSelected.length} editable)</span>
        ) : (
          primary && <span>Sel: {primary.name}</span>
        )}
        <span className="hint">⌘Z undo · ⌘⇧Z redo · ⌘A all · drag empty canvas = marquee select · space/middle = pan</span>
      </div>
    </div>
  );
}

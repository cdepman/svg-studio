// Pure operations on the flat layer array. PRD §4, §9, §10.
//
// Rendering order: layers[0] = back/bottom, layers[N-1] = front/top.
// The panel renders this reversed (top row = front). Keep this module pure and
// unit-tested; it is the source of truth for ordering correctness.
import type { Center, Layer, LayerAnimation, LayerEffects, LayerGroup, Motif, RepeatParams } from "../types";

let idCounter = 0;
export function newLayerId(): string {
  idCounter += 1;
  return `layer-${Date.now().toString(36)}-${idCounter}`;
}

let groupIdCounter = 0;
export function newGroupId(): string {
  groupIdCounter += 1;
  return `group-${Date.now().toString(36)}-${groupIdCounter}`;
}

export function createLayer(opts: {
  name: string;
  motif: Motif;
  params: RepeatParams;
  center: Center;
  scale?: number;
  visible?: boolean;
  locked?: boolean;
}): Layer {
  const now = Date.now();
  return {
    id: newLayerId(),
    name: opts.name,
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    motif: opts.motif, // motif markup is immutable, safe to share
    params: { ...opts.params },
    center: { ...opts.center },
    scale: opts.scale ?? 1,
    components: {},
    createdAt: now,
    updatedAt: now,
  };
}

function cloneAnimation(animation: LayerAnimation | undefined): LayerAnimation | undefined {
  if (!animation) return undefined;
  return {
    ...animation,
    path: {
      ...animation.path,
      points: animation.path.points.map((p) => ({ ...p })),
    },
  };
}

function cloneEffects(effects: LayerEffects | undefined): LayerEffects | undefined {
  if (!effects) return undefined;
  return {
    individualSpin: { ...effects.individualSpin },
    compositeSpin: { ...effects.compositeSpin },
    scalePulse: { ...effects.scalePulse },
    radialPulse: { ...effects.radialPulse },
    wave: effects.wave
      ? { ...effects.wave }
      : { enabled: false, periodSeconds: 4, amount: 40, frequency: 3, direction: "cw", stagger: false },
  };
}

/**
 * Deep-copy a layer for duplication: new id, "{name} copy", independent params
 * and center so edits to the copy never touch the original. Keeps visibility and
 * lock state. PRD §9, §17.
 */
export function duplicateLayer(layer: Layer): Layer {
  const now = Date.now();
  return {
    ...layer,
    id: newLayerId(),
    name: `${layer.name} copy`,
    params: { ...layer.params },
    center: { ...layer.center },
    components: Object.fromEntries(Object.entries(layer.components).map(([k, v]) => [k, { ...v }])),
    animation: cloneAnimation(layer.animation),
    effects: cloneEffects(layer.effects),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Duplicate every layer in `ids` in one pass, inserting each copy directly above
 * its original and preserving relative order. Returns the new array and the ids
 * of the copies (to select them). PRD §9.
 */
export function duplicateLayers(
  layers: Layer[],
  ids: Set<string>
): { layers: Layer[]; newIds: string[] } {
  const out: Layer[] = [];
  const newIds: string[] = [];
  for (const l of layers) {
    out.push(l);
    if (ids.has(l.id)) {
      const copy = duplicateLayer(l);
      out.push(copy);
      newIds.push(copy.id);
    }
  }
  return { layers: out, newIds };
}

export function createLayerGroup(
  layers: Layer[],
  groups: LayerGroup[],
  ids: Set<string>,
  name = `Group ${groups.length + 1}`
): { groups: LayerGroup[]; group: LayerGroup | null } {
  const layerIds = layers.map((l) => l.id).filter((id) => ids.has(id));
  if (layerIds.length < 2) return { groups, group: null };
  const idSet = new Set(layerIds);
  const now = Date.now();
  const group: LayerGroup = {
    id: newGroupId(),
    name,
    layerIds,
    createdAt: now,
    updatedAt: now,
  };
  return {
    groups: [...groups.filter((g) => !g.layerIds.some((id) => idSet.has(id))), group],
    group,
  };
}

export function removeGroupsForLayerIds(groups: LayerGroup[], ids: Set<string>): LayerGroup[] {
  return groups.filter((g) => !g.layerIds.some((id) => ids.has(id)));
}

export function pruneGroups(groups: LayerGroup[], layers: Layer[]): LayerGroup[] {
  const existing = new Set(layers.map((l) => l.id));
  return groups
    .map((g) => ({ ...g, layerIds: g.layerIds.filter((id) => existing.has(id)) }))
    .filter((g) => g.layerIds.length >= 2);
}

export function groupForLayer(groups: LayerGroup[], layerId: string): LayerGroup | undefined {
  return groups.find((g) => g.layerIds.includes(layerId));
}

const indexOfId = (layers: Layer[], id: string) =>
  layers.findIndex((l) => l.id === id);

/** Insert `layer` directly above (in front of) the layer with id `aboveId`. */
export function insertAbove(layers: Layer[], layer: Layer, aboveId: string): Layer[] {
  const i = indexOfId(layers, aboveId);
  if (i < 0) return [...layers, layer];
  const next = layers.slice();
  next.splice(i + 1, 0, layer);
  return next;
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id);
}

export function updateLayer(
  layers: Layer[],
  id: string,
  patch: (l: Layer) => Layer
): Layer[] {
  return layers.map((l) => (l.id === id ? patch(l) : l));
}

// --- Reordering. Remember: array end = visual front. PRD §10. ---

export function moveForward(layers: Layer[], id: string): Layer[] {
  const i = indexOfId(layers, id);
  if (i < 0 || i >= layers.length - 1) return layers;
  const n = layers.slice();
  [n[i], n[i + 1]] = [n[i + 1], n[i]];
  return n;
}

export function moveBackward(layers: Layer[], id: string): Layer[] {
  const i = indexOfId(layers, id);
  if (i <= 0) return layers;
  const n = layers.slice();
  [n[i], n[i - 1]] = [n[i - 1], n[i]];
  return n;
}

export function moveToFront(layers: Layer[], id: string): Layer[] {
  const i = indexOfId(layers, id);
  if (i < 0 || i === layers.length - 1) return layers;
  const n = layers.slice();
  const [item] = n.splice(i, 1);
  n.push(item);
  return n;
}

export function moveToBack(layers: Layer[], id: string): Layer[] {
  const i = indexOfId(layers, id);
  if (i <= 0) return layers;
  const n = layers.slice();
  const [item] = n.splice(i, 1);
  n.unshift(item);
  return n;
}

/**
 * Drag-and-drop reorder expressed in DISPLAY space (top row = front). Moves the
 * dragged layer to sit where the drop-target layer is in the visible panel
 * order, then maps back to internal (back-to-front) order. PRD §10.
 */
export function reorderByDisplay(
  layers: Layer[],
  draggedId: string,
  targetId: string
): Layer[] {
  if (draggedId === targetId) return layers;
  const display = layers.slice().reverse();
  const from = display.findIndex((l) => l.id === draggedId);
  const to = display.findIndex((l) => l.id === targetId);
  if (from < 0 || to < 0) return layers;
  const [item] = display.splice(from, 1);
  display.splice(to, 0, item);
  return display.reverse();
}

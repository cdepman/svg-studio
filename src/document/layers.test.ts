import { describe, expect, it } from "vitest";
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
} from "./layers";
import type { Layer, Motif, RepeatParams } from "../types";

const motif: Motif = {
  innerHtml: "<rect/>",
  anchorX: 0,
  anchorY: 0,
  box: { x: 0, y: 0, width: 10, height: 10 },
  weight: 1,
  simplified: false,
};

const params: RepeatParams = {
  count: 8,
  angleOffset: 0,
  radiusOffset: 100,
  sourceRotation: 0,
  sourceScale: 1,
  orientationMode: "rotateWithCircle",
  mirrorAlternates: false,
  scaleStep: 0,
  opacityStep: 0,
  paintOffset: 0,
  tuck: false,
  seamBlend: 2,
};

const mk = (name: string) => createLayer({ name, motif, params, center: { x: 0, y: 0 } });

const ids = (ls: Layer[]) => ls.map((l) => l.name);

describe("duplicateLayer", () => {
  it("makes an independent copy with a new id and '<name> copy'", () => {
    const a = mk("A");
    a.params.count = 16;
    const dup = duplicateLayer(a);
    expect(dup.id).not.toBe(a.id);
    expect(dup.name).toBe("A copy");
    // independent params: mutating the copy does not touch the original
    dup.params.count = 999;
    expect(a.params.count).toBe(16);
    expect(dup.center).not.toBe(a.center);
    expect(dup.visible).toBe(a.visible);
    expect(dup.locked).toBe(a.locked);
  });
});

describe("duplicateLayers (multi-select duplicate)", () => {
  it("inserts each copy above its original, preserving order, and reports new ids", () => {
    const [a, b, c] = [mk("A"), mk("B"), mk("C")];
    const { layers: next, newIds } = duplicateLayers([a, b, c], new Set([a.id, c.id]));
    expect(ids(next)).toEqual(["A", "A copy", "B", "C", "C copy"]);
    expect(newIds).toHaveLength(2);
    // the new ids are exactly the copies
    const copyIds = next.filter((l) => l.name.endsWith("copy")).map((l) => l.id);
    expect(newIds).toEqual(copyIds);
  });

  it("copies are independent of originals", () => {
    const a = mk("A");
    a.params.count = 10;
    const { layers: next } = duplicateLayers([a], new Set([a.id]));
    const copy = next[1];
    copy.params.count = 99;
    expect(a.params.count).toBe(10);
  });

  it("no-op set leaves the array unchanged", () => {
    const [a, b] = [mk("A"), mk("B")];
    const { layers: next, newIds } = duplicateLayers([a, b], new Set());
    expect(ids(next)).toEqual(["A", "B"]);
    expect(newIds).toEqual([]);
  });
});

describe("insertAbove", () => {
  it("inserts directly in front of (after) the target", () => {
    const a = mk("A");
    const b = mk("B");
    const x = mk("X");
    expect(ids(insertAbove([a, b], x, a.id))).toEqual(["A", "X", "B"]);
  });
});

describe("layer groups", () => {
  it("creates a group from selected ids in layer order", () => {
    const [a, b, c] = [mk("A"), mk("B"), mk("C")];
    const { groups, group } = createLayerGroup([a, b, c], [], new Set([c.id, a.id]));
    expect(group?.layerIds).toEqual([a.id, c.id]);
    expect(groups).toHaveLength(1);
    expect(groupForLayer(groups, c.id)?.id).toBe(group?.id);
  });

  it("replaces overlapping groups and prunes deleted members", () => {
    const [a, b, c] = [mk("A"), mk("B"), mk("C")];
    const first = createLayerGroup([a, b, c], [], new Set([a.id, b.id])).groups;
    const second = createLayerGroup([a, b, c], first, new Set([b.id, c.id])).groups;
    expect(second).toHaveLength(1);
    expect(second[0].layerIds).toEqual([b.id, c.id]);

    expect(removeGroupsForLayerIds(second, new Set([b.id]))).toEqual([]);
    expect(pruneGroups(second, [c])).toEqual([]);
  });
});

describe("ordering (array end = front)", () => {
  it("moveForward / moveBackward swap with the neighbour", () => {
    const [a, b, c] = [mk("A"), mk("B"), mk("C")];
    expect(ids(moveForward([a, b, c], a.id))).toEqual(["B", "A", "C"]);
    expect(ids(moveBackward([a, b, c], c.id))).toEqual(["A", "C", "B"]);
  });
  it("moveForward at front and moveBackward at back are no-ops", () => {
    const [a, b] = [mk("A"), mk("B")];
    expect(ids(moveForward([a, b], b.id))).toEqual(["A", "B"]);
    expect(ids(moveBackward([a, b], a.id))).toEqual(["A", "B"]);
  });
  it("moveToFront / moveToBack relocate to the ends", () => {
    const [a, b, c] = [mk("A"), mk("B"), mk("C")];
    expect(ids(moveToFront([a, b, c], a.id))).toEqual(["B", "C", "A"]);
    expect(ids(moveToBack([a, b, c], c.id))).toEqual(["C", "A", "B"]);
  });
});

describe("reorderByDisplay (panel drag; top row = front)", () => {
  it("dropping the front layer onto the back row sends it to the back", () => {
    // internal [A,B,C] -> display (front first) [C,B,A]. Drag C onto A.
    const [a, b, c] = [mk("A"), mk("B"), mk("C")];
    const next = reorderByDisplay([a, b, c], c.id, a.id);
    // display becomes [B,A,C] -> internal reversed [C,A,B]
    expect(ids(next)).toEqual(["C", "A", "B"]);
  });
});

describe("removeLayer / updateLayer", () => {
  it("removes by id", () => {
    const [a, b] = [mk("A"), mk("B")];
    expect(ids(removeLayer([a, b], a.id))).toEqual(["B"]);
  });
  it("patches only the matching layer", () => {
    const [a, b] = [mk("A"), mk("B")];
    const next = updateLayer([a, b], a.id, (l) => ({ ...l, name: "A2" }));
    expect(ids(next)).toEqual(["A2", "B"]);
    expect(next[1]).toBe(b); // untouched layer keeps reference (memo-friendly)
  });
});

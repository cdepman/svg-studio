// Tunable policy constants. PRD §9.

/** A scene is "heavy" when count * motifWeight exceeds this. Starting point, not
 *  gospel — tune against a real frame budget. PRD §9. */
export const HEAVY_THRESHOLD = 8000;

/** Max instances shown by the drag-time proxy (representative subset). PRD §9. */
export const PROXY_CAP = 24;

/** Visual radius of the center handle, in screen px (counter-scaled by 1/s). */
export const HANDLE_R = 10;
/** Generous hit radius of the center handle, in screen px. PRD §7. */
export const HANDLE_HIT_R = 16;

/** Resize-gizmo corner handle size, in screen px. */
export const GIZMO_HANDLE = 11;
/** Resize-gizmo corner handle size on touch-capable devices, in screen px. */
export const TOUCH_GIZMO_HANDLE = 22;
/** Gap from the gizmo's top-right corner to the duplicate button, screen px. */
export const GIZMO_DUP_GAP = 16;
/** Length of the rotate-knob stem above the gizmo / component box, screen px. */
export const ROTATE_GAP = 26;
/** Touch-capable rotate-knob stem length, screen px. */
export const TOUCH_ROTATE_GAP = 36;

export function isHeavy(count: number, motifWeight: number): boolean {
  return count * motifWeight > HEAVY_THRESHOLD;
}

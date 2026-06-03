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

export function isHeavy(count: number, motifWeight: number): boolean {
  return count * motifWeight > HEAVY_THRESHOLD;
}

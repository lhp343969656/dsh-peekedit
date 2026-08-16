/**
 * Expand the Web Client's details column to its maximum width.
 *
 * The official layout service exposes only openDetails/closeDetails, and
 * openDetails opens at the contract default (360px). To honor "expand at
 * maximum width", this performs ONE simulated drag pass over the frame's
 * details handle (`[data-side="details"]`, a stable attribute): a synthetic
 * pointerdown/move/up sequence with the pointer-capture methods stubbed for
 * the synthetic pointer id. The frame's drag math is `setDetails(base - dx)`,
 * so a move of -160px takes the default 360px to the 520px maximum.
 *
 * The simulation is best-effort: any failure (missing handle, thrown event)
 * leaves the column at the default width. No official behavior is patched —
 * the stubs are restored before the events' async effects run.
 * @module dsh-peekedit/client/layout
 */

/** The drag distance from the default details width to DETAILS_MAX. */
const DEFAULT_TO_MAX_DX = -160

/**
 * Run one simulated drag on the details handle. Returns immediately; the
 * width update lands on the next frame.
 * @returns whether a handle was found and the simulation dispatched.
 */
export function expandDetailsToMax(): boolean {
  const handle = document.querySelector<HTMLElement>('[data-side="details"]')
  if (handle === null) return false
  const proto = Element.prototype
  const setCapture = proto.setPointerCapture
  const hasCapture = proto.hasPointerCapture
  const releaseCapture = proto.releasePointerCapture
  // Synthetic pointers are not "active", so capture calls would throw and
  // hasPointerCapture would short-circuit the move handler.
  proto.setPointerCapture = () => {}
  proto.hasPointerCapture = () => true
  proto.releasePointerCapture = () => {}
  try {
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 300 }))
    handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 300 + DEFAULT_TO_MAX_DX }))
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    return true
  } catch {
    return false
  } finally {
    proto.setPointerCapture = setCapture
    proto.hasPointerCapture = hasCapture
    proto.releasePointerCapture = releaseCapture
  }
}

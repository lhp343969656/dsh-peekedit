/**
 * File-browser panel state. A module singleton so the details-column panel,
 * the header action, and the collapsed rail share one state without crossing
 * React trees. `useSyncExternalStore` subscribes components to it.
 * @module dsh-peekedit/client/store
 */

type Listener = () => void

const listeners = new Set<Listener>()
let open = false

/** Expand the panel (the details column opens and shows the browser). */
export function openPanel(): void {
  if (open) return
  open = true
  for (const listener of listeners) listener()
}

/** Collapse the panel (the details column closes; the rail remains). */
export function closePanel(): void {
  if (!open) return
  open = false
  for (const listener of listeners) listener()
}

/** Toggle panel visibility and notify subscribers. */
export function togglePanel(): void {
  open = !open
  for (const listener of listeners) listener()
}

/** Current visibility snapshot (the `useSyncExternalStore` snapshot). */
export function isPanelOpen(): boolean {
  return open
}

/** Subscribe to visibility changes; returns the unsubscribe function. */
export function subscribePanel(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

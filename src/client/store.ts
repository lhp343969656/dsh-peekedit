/**
 * File-browser panel visibility store. A module singleton so the header
 * action button and the portal-rendered panel share one state without
 * crossing React trees. `useSyncExternalStore` subscribes components to it.
 * @module dsh-peekedit/client/store
 */

type Listener = () => void

const listeners = new Set<Listener>()
let open = false

/** Toggle panel visibility and notify subscribers. */
export function toggleBrowser(): void {
  open = !open
  for (const listener of listeners) listener()
}

/** Close the panel. */
export function closeBrowser(): void {
  if (!open) return
  open = false
  for (const listener of listeners) listener()
}

/** Current visibility snapshot (the `useSyncExternalStore` snapshot). */
export function getBrowserOpen(): boolean {
  return open
}

/** Subscribe to visibility changes; returns the unsubscribe function. */
export function subscribeBrowser(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

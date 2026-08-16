/**
 * Right toolbar state and tool registry. A module singleton so the details
 * column host, the rail, and every tool page share one state without crossing
 * React trees. `useSyncExternalStore` subscribes components to it.
 *
 * Tools register through {@link registerTool}; the rail shows one icon per
 * tool, clicking one expands the toolbar and renders that tool's page.
 * @module dsh-peekedit/client/store
 */

import type { ReactNode } from 'react'

/** One tool page hosted by the right toolbar. */
export interface ToolbarTool {
  /** Stable tool id (also the rail icon key). */
  id: string
  /** Rail icon (emoji or short glyph). */
  icon: string
  /** Tool label (rail tooltip / panel title). */
  label: string
  /** Render the tool page for one session. */
  render(sessionId: string): ReactNode
}

type Listener = () => void

const listeners = new Set<Listener>()
const tools = new Map<string, ToolbarTool>()
let expanded = false
let activeTool = 'files'
let version = 0

function emit(): void {
  version += 1
  for (const listener of listeners) listener()
}

/** Register a toolbar tool; returns the disposer. */
export function registerTool(tool: ToolbarTool): () => void {
  tools.set(tool.id, tool)
  emit()
  return () => {
    if (tools.delete(tool.id) && activeTool === tool.id) {
      activeTool = 'files'
    }
    emit()
  }
}

/** All registered tools, in registration order. */
export function listTools(): ToolbarTool[] {
  return [...tools.values()]
}

/** The currently active tool, or the first registered tool as a fallback. */
export function activeToolOf(): ToolbarTool | undefined {
  return tools.get(activeTool) ?? [...tools.values()][0]
}

/** Expand the toolbar and switch to a tool. */
export function openToolbar(toolId: string): void {
  if (tools.has(toolId)) activeTool = toolId
  if (!expanded) {
    expanded = true
  }
  emit()
}

/** Collapse the toolbar (the rail remains). */
export function collapseToolbar(): void {
  if (!expanded) return
  expanded = false
  emit()
}

/** Whether the toolbar is expanded. */
export function isToolbarExpanded(): boolean {
  return expanded
}

/** Monotonic state version — the `useSyncExternalStore` snapshot. */
export function getToolbarVersion(): number {
  return version
}

/** Subscribe to toolbar/tool changes; returns the unsubscribe function. */
export function subscribeToolbar(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

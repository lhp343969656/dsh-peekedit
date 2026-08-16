/**
 * Client half of dsh-peekedit: hosts the right toolbar — a tool registry with
 * the file browser as its first tool, the details (right) column as the
 * expanded surface, and a collapsed icon rail on the right edge (mirroring
 * the left sidebar's collapsed rail). Value imports stay within the platform
 * word table (react); everything else is type-only and erased at build.
 * @module dsh-peekedit/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { FilePanel } from './FilePanel.tsx'
import { ToolbarHost, ToolbarRail } from './ToolbarHost.tsx'
import { collapseToolbar, openToolbar, registerTool } from './store.ts'

export const name = 'dsh-peekedit'
export const inject = ['slots', 'layout']

/** Placeholder page for the upcoming tools panel. */
function ToolsPlaceholder(): React.ReactNode {
  return (
    <div style={{ padding: 16, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, fontFamily: 'var(--dsw-font-family)' }}>
      🛠 工具面板开发中 — 后续将在这里展示模型工具与快捷操作。
    </div>
  )
}

/** Mount the toolbar host, its rail, and the built-in tools. */
export function apply(ctx: ClientContext): void {
  registerTool({
    id: 'files',
    icon: '📁',
    label: '文件',
    render: sessionId => <FilePanel sessionId={sessionId} />,
  })
  registerTool({
    id: 'tools',
    icon: '🛠',
    label: '工具',
    render: () => <ToolsPlaceholder />,
  })

  // The expanded surface: the details (right) column. Shadows the shipped
  // tool-details panel (priority 0): lowest priority renders, so -1 wins
  // while the official entry stays composed but inert.
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -1,
    inject: () => ({
      onClose: () => {
        collapseToolbar()
        ctx.layout.closeDetails()
      },
    }),
  }, ({ sessionId, onClose }: { sessionId: string; onClose: () => void }) => (
    <ToolbarHost sessionId={sessionId} onClose={onClose} />
  )))

  // The collapsed entry: a 52px icon rail on the right edge, one button per
  // tool, mirroring the left sidebar's collapsed rail. The shell overlay
  // layer is click-through; the rail opts back into pointer events.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'peekedit-toolbar-rail',
    order: 100,
    inject: () => ({
      openTool: (toolId: string) => {
        openToolbar(toolId)
        ctx.layout.openDetails()
      },
    }),
  }, ({ openTool }: { openTool: (toolId: string) => void }) => <ToolbarRail onOpen={openTool} />))
}

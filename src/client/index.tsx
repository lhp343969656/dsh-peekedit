/**
 * Client half of dsh-peekedit: mounts the file browser into the Web Client's
 * details (right) column, with the header action and the collapsed right-edge
 * rail as open/close handles. Value imports stay within the platform word
 * table (react); everything else is type-only and erased at build.
 * @module dsh-peekedit/client
 */

import { useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DetailsRail, FilePanel } from './FilePanel.tsx'
import { closePanel, isPanelOpen, openPanel, subscribePanel } from './store.ts'

export const name = 'dsh-peekedit'
export const inject = ['slots', 'layout']

/** The header action toggling the panel (opens/closes the details column). */
function HeaderAction({ openFilePanel, closeFilePanel }: { openFilePanel: () => void; closeFilePanel: () => void }): React.ReactNode {
  const open = useSyncExternalStore(subscribePanel, isPanelOpen)
  return (
    <button
      type="button"
      title="文件浏览器"
      onClick={() => (isPanelOpen() ? closeFilePanel() : openFilePanel())}
      style={{
        background: open ? '#3b6ea5' : 'none',
        border: '1px solid #44454e',
        color: open ? '#fff' : '#d0d0d6',
        borderRadius: 4,
        padding: '3px 8px',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      📁 文件
    </button>
  )
}

/** Mount the panel and its handles once their slots are declared. */
export function apply(ctx: ClientContext): void {
  // The details (right) column. Shadows the shipped tool-details panel
  // (priority 0): lowest priority renders, so -1 wins while the official
  // entry stays composed but inert.
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -1,
    inject: () => ({
      onClose: () => {
        closePanel()
        ctx.layout.closeDetails()
      },
    }),
  }, ({ sessionId, onClose }: { sessionId: string; onClose: () => void }) => (
    <FilePanel sessionId={sessionId} onClose={onClose} />
  )))

  // The collapsed rail on the right edge — the reopen handle while the panel
  // is closed (the shell overlay layer is click-through; the rail opts in).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'peekedit-details-rail',
    order: 100,
    inject: () => ({
      openFilePanel: () => {
        openPanel()
        ctx.layout.openDetails()
      },
    }),
  }, ({ openFilePanel }: { openFilePanel: () => void }) => <DetailsRail onOpen={openFilePanel} />))

  // The session header button, an always-visible open/close handle.
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'peekedit-file-browser',
    order: 100,
    inject: () => ({
      openFilePanel: () => {
        openPanel()
        ctx.layout.openDetails()
      },
      closeFilePanel: () => {
        closePanel()
        ctx.layout.closeDetails()
      },
    }),
  }, HeaderAction))
}

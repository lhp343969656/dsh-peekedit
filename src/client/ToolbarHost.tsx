/**
 * Right toolbar host: renders the active tool's page inside the details
 * column. The slim header is a tab strip — each tab shows its icon followed
 * by its label, and clicking switches tools directly (no separate title
 * line). The rail ({@link ToolbarRail}) is the collapsed-state entry point.
 * Styling rides the Web Client's `--dsw-alias-*` theme tokens.
 * @module dsh-peekedit/client/ToolbarHost
 */

import { useSyncExternalStore } from 'react'
import {
  activeToolOf, getToolbarVersion, isToolbarExpanded, listTools, openToolbar, subscribeToolbar,
} from './store.ts'

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'var(--dsw-font-family)',
    fontSize: 13,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '6px 8px',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-2)',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: 'none',
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 12,
    padding: '5px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
  },
  tabActive: { background: 'var(--dsw-alias-interactive-bg-active)', color: 'var(--dsw-alias-label-primary)' },
  close: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 15,
    cursor: 'pointer',
    padding: '2px 6px',
    lineHeight: 1,
  },
  body: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
}

/** The details-column host rendering the active toolbar tool. */
export function ToolbarHost({ sessionId, onClose }: { sessionId: string; onClose: () => void }): React.ReactNode {
  // Re-read on every subscription change: tools may register/unregister and
  // the active tool may switch from the rail.
  useSyncExternalStore(subscribeToolbar, getToolbarVersion)
  const tool = activeToolOf()
  return (
    <div style={styles.root}>
      <div style={styles.header}>
        {listTools().map(candidate => (
          <button
            key={candidate.id}
            type="button"
            title={candidate.label}
            style={candidate.id === tool?.id ? { ...styles.tab, ...styles.tabActive } : styles.tab}
            onClick={() => openToolbar(candidate.id)}
          >
            {candidate.icon}
            <span>{candidate.label}</span>
          </button>
        ))}
        <button type="button" title="收起" style={styles.close} onClick={onClose}>»</button>
      </div>
      <div style={styles.body}>
        {tool === undefined ? <div style={{ padding: 16, color: 'var(--dsw-alias-label-tertiary)' }}>暂无工具</div> : tool.render(sessionId)}
      </div>
    </div>
  )
}

/** The collapsed right-edge icon rail — one button per toolbar tool. */
export function ToolbarRail({ onOpen }: { onOpen: (toolId: string) => void }): React.ReactNode {
  // Re-render on state and tool-registration changes alike.
  useSyncExternalStore(subscribeToolbar, getToolbarVersion)
  const expanded = isToolbarExpanded()
  const active = activeToolOf()
  if (expanded) return null
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 52,
        background: 'var(--dsw-specific-sidebar-fill)',
        borderLeft: '1px solid var(--dsw-alias-border-l2)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 8,
        gap: 4,
        pointerEvents: 'auto',
        zIndex: 900,
        boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.08)',
      }}
    >
      {listTools().map(tool => (
        <button
          key={tool.id}
          type="button"
          title={tool.label}
          onClick={() => onOpen(tool.id)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            background: tool.id === active?.id
              ? 'var(--dsw-alias-interactive-bg-active)'
              : 'transparent',
            color: tool.id === active?.id
              ? 'var(--dsw-alias-label-primary)'
              : 'var(--dsw-alias-label-secondary)',
          }}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  )
}

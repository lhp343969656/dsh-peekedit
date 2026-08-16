/**
 * Right toolbar host: renders the active tool's page inside the details
 * column, with a slim header (tool title, collapse button). The rail
 * ({@link ToolbarRail}) is the collapsed-state entry point.
 * @module dsh-peekedit/client/ToolbarHost
 */

import { useSyncExternalStore } from 'react'
import {
  activeToolOf, collapseToolbar, getToolbarVersion, isToolbarExpanded, listTools, openToolbar, subscribeToolbar,
} from './store.ts'

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    background: '#1e1f24',
    color: '#e8e8ea',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 13,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid #33343b',
    background: '#26272d',
  },
  title: { fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' as const },
  tabs: { display: 'flex', gap: 2, marginLeft: 4 },
  tab: {
    background: 'none',
    border: 'none',
    color: '#9a9aa3',
    fontSize: 12,
    padding: '3px 6px',
    borderRadius: 4,
    cursor: 'pointer',
  },
  tabActive: { background: '#33343b', color: '#e8e8ea' },
  close: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: '#e8e8ea',
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
        <span style={styles.title}>{tool?.icon ?? ''} {tool?.label ?? '工具栏'}</span>
        {listTools().length > 1 && (
          <span style={styles.tabs}>
            {listTools().map(candidate => (
              <button
                key={candidate.id}
                type="button"
                title={candidate.label}
                style={candidate.id === tool?.id ? { ...styles.tab, ...styles.tabActive } : styles.tab}
                onClick={() => openToolbar(candidate.id)}
              >
                {candidate.icon}
              </button>
            ))}
          </span>
        )}
        <button type="button" title="收起" style={styles.close} onClick={onClose}>»</button>
      </div>
      <div style={styles.body}>
        {tool === undefined ? <div style={{ padding: 16, color: '#6f7078' }}>暂无工具</div> : tool.render(sessionId)}
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
        background: '#26272d',
        borderLeft: '1px solid #33343b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 8,
        gap: 4,
        pointerEvents: 'auto',
        zIndex: 900,
        boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.2)',
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
            fontSize: 18,
            cursor: 'pointer',
            background: tool.id === active?.id ? '#3b6ea5' : 'transparent',
            color: tool.id === active?.id ? '#fff' : '#d0d0d6',
          }}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  )
}

/** Convenience: collapse the toolbar (used by tool pages' close affordance). */
export { collapseToolbar }

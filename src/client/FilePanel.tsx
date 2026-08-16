/**
 * File browser tool page for the right toolbar: directory navigation, file
 * preview, and editing over the host `/api/peekedit/*` endpoints. The tree
 * and the content area are separated by a draggable divider (vertical
 * resize). Styling rides the Web Client's `--dsw-alias-*` theme tokens, so
 * the page follows the active light/dark theme.
 * @module dsh-peekedit/client/FilePanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { listDir, readFile, writeFile } from './api.ts'
import type { DirEntry } from './api.ts'
import { ArrowUpIcon, ChevronRightIcon, DocumentIcon, FileIcon } from './icons.tsx'

/** Combine a relative directory and an entry name into a child rel path. */
function childPath(dir: string, name: string): string {
  return dir.length === 0 ? name : `${dir}/${name}`
}

/** Split a rel path into breadcrumb segments. */
function segmentsOf(dir: string): string[] {
  return dir.length === 0 ? [] : dir.split('/')
}

/** The parent of a rel path ('' at the root). */
function parentOf(dir: string): string {
  const parts = segmentsOf(dir)
  return parts.slice(0, -1).join('/')
}

/** Whether a path is a Markdown file (rendered instead of raw text). */
function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/** The preview area may take any height; only negatives are rejected. */
function sanitizePreviewHeight(px: number): number {
  return Math.max(0, Math.round(px))
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
    background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'var(--dsw-font-family)',
    fontSize: 13,
  },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '7px 10px',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    flexWrap: 'wrap' as const,
    background: 'var(--dsw-alias-bg-layer-1)',
  },
  crumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    background: 'none',
    border: 'none',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    padding: '3px 5px',
    borderRadius: 5,
    fontSize: 12,
    fontFamily: 'inherit',
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  crumbCurrent: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
  crumbSep: { color: 'var(--dsw-alias-label-tertiary)', display: 'flex' },
  tree: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '6px 6px 10px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    borderLeft: '3px solid transparent',
    color: 'var(--dsw-alias-label-primary)',
    userSelect: 'none' as const,
  },
  rowHover: { background: 'var(--dsw-alias-interactive-bg-hover)' },
  rowSelected: {
    background: 'var(--dsw-alias-interactive-bg-active)',
    borderLeftColor: 'var(--dsw-alias-state-business-primary)',
  },
  rowIcon: { display: 'flex', flexShrink: 0, color: 'var(--dsw-alias-label-tertiary)' },
  rowIconDir: { color: 'var(--dsw-alias-state-business-primary)' },
  rowName: { overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
  rowSize: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, flexShrink: 0 },
  parentRow: { color: 'var(--dsw-alias-label-secondary)' },
  empty: { color: 'var(--dsw-alias-label-tertiary)', padding: 20, textAlign: 'center' as const },
  error: {
    margin: '6px 10px 0',
    padding: '8px 10px',
    borderRadius: 6,
    background: 'var(--dsw-static-red-50)',
    color: 'var(--dsw-alias-state-error-primary)',
    whiteSpace: 'pre-wrap' as const,
    fontSize: 12,
  },
  // Divider strip mirrors the frame's column drag handles: an 8px hot strip
  // with a centered pill that appears on hover/drag.
  divider: {
    height: 8,
    cursor: 'row-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    touchAction: 'none' as const,
    flexShrink: 0,
  },
  dividerPill: {
    width: 32,
    height: 12,
    borderRadius: 10,
    boxSizing: 'border-box' as const,
    background: 'var(--dsw-alias-button-floating-fill)',
    border: '1px solid var(--dsw-alias-border-l2-darkmode-thin)',
    opacity: 0,
    transition: 'opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out)',
  },
  dividerPillVisible: {
    opacity: 1,
    background: 'var(--dsw-alias-button-floating-hover)',
    borderColor: 'var(--dsw-alias-border-l3)',
  },
  preview: {
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    borderTop: '1px solid var(--dsw-alias-border-l2)',
    flexShrink: 0,
  },
  previewHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'var(--dsw-alias-bg-layer-2)',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
  },
  previewTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  previewPath: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 12,
  },
  previewBadge: {
    flexShrink: 0,
    padding: '1px 7px',
    borderRadius: 8,
    background: 'var(--dsw-alias-markdown-code-block)',
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  button: {
    background: 'var(--dsw-alias-state-business-primary)',
    border: 'none',
    color: '#fff',
    borderRadius: 5,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  buttonGhost: {
    background: 'none',
    border: '1px solid var(--dsw-alias-border-l3)',
    color: 'var(--dsw-alias-label-secondary)',
    borderRadius: 5,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  pre: {
    margin: 0,
    padding: '10px 12px',
    overflow: 'auto',
    whiteSpace: 'pre' as const,
    fontSize: 12,
    lineHeight: 1.6,
    fontFamily: 'var(--ds-font-family-code)',
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-markdown-code-block)',
  },
  markdown: {
    flex: 1,
    overflow: 'auto',
    padding: '4px 14px 14px',
    background: 'var(--dsw-alias-bg-base)',
    fontSize: 13,
    lineHeight: 1.6,
  },
  textarea: {
    margin: 0,
    padding: 10,
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    background: 'var(--dsw-specific-input-major)',
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'var(--ds-font-family-code)',
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: 'pre' as const,
    flex: 1,
  },
}

/** One tree row with hover state (inline styles have no :hover). */
function FileRow({
  entry, selected, onOpen,
}: {
  entry: DirEntry
  selected: boolean
  onOpen: () => void
}): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  const isDir = entry.type === 'directory'
  return (
    <div
      style={
        selected
          ? { ...styles.row, ...styles.rowSelected }
          : hovered
            ? { ...styles.row, ...styles.rowHover }
            : styles.row
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
      title={entry.name}
    >
      <span style={isDir ? { ...styles.rowIcon, ...styles.rowIconDir } : styles.rowIcon}>
        {isDir ? <FileIcon /> : <DocumentIcon />}
      </span>
      <span style={styles.rowName}>{entry.name}</span>
      {!isDir && entry.size !== undefined && <span style={styles.rowSize}>{entry.size} B</span>}
    </div>
  )
}

/** The file browser tool page. */
export function FilePanel({ sessionId }: { sessionId: string }): React.ReactNode {
  const [dir, setDir] = useState('')
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [selected, setSelected] = useState<string | undefined>()
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [previewHeight, setPreviewHeight] = useState(240)
  const [dividerActive, setDividerActive] = useState(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  // Monotonic request id: a stale listing/read response must not overwrite
  // the state a newer navigation produced.
  const requestSeq = useRef(0)

  const loadDir = useCallback(async (next: string): Promise<void> => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(undefined)
    // Select nothing immediately: the tree clears before the listing returns.
    setSelected(undefined)
    setEditing(false)
    try {
      const response = await listDir(sessionId, next)
      if (seq !== requestSeq.current) return
      setRoot(response.root)
      setDir(response.path === response.root ? '' : next)
      setEntries(response.entries)
    } catch (cause) {
      if (seq !== requestSeq.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setEntries([])
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [sessionId])

  const loadFile = useCallback(async (path: string): Promise<void> => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(undefined)
    setEditing(false)
    // Select the file immediately — the row highlights before the content
    // arrives, and a failed read still leaves the selection visible.
    setSelected(path)
    try {
      const response = await readFile(sessionId, path)
      if (seq !== requestSeq.current) return
      setContent(response.content)
    } catch (cause) {
      if (seq !== requestSeq.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void loadDir('') }, [loadDir])

  const openEntry = (entry: DirEntry): void => {
    const path = childPath(dir, entry.name)
    if (entry.type === 'directory') void loadDir(path)
    else if (entry.type === 'file') void loadFile(path)
  }

  const save = async (): Promise<void> => {
    if (selected === undefined) return
    setSaving(true)
    setError(undefined)
    try {
      await writeFile(sessionId, selected, draft)
      setContent(draft)
      setEditing(false)
      // The listing sizes are stale after an edit; refresh the current dir.
      await loadDir(dir)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  // Vertical drag between the tree and the content area (pointer capture on
  // the divider, mirroring the frame's column drag handles). No size limits:
  // either area may take the whole panel.
  const onDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startY: event.clientY, startHeight: previewHeight }
    setDividerActive(true)
  }
  const onDividerPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) return
    setPreviewHeight(sanitizePreviewHeight(dragRef.current.startHeight + (dragRef.current.startY - event.clientY)))
  }
  const onDividerPointerUp = (): void => {
    dragRef.current = null
    setDividerActive(false)
  }

  const sorted = [...entries].sort((left, right) =>
    left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === 'directory' ? -1 : 1)

  const segments = segmentsOf(dir)
  const extension = selected === undefined ? '' : selected.split('.').pop() ?? ''

  return (
    <div style={styles.root}>
      <div style={styles.breadcrumbs}>
        <button
          type="button"
          style={dir.length === 0 ? { ...styles.crumb, ...styles.crumbCurrent } : styles.crumb}
          onClick={() => void loadDir('')}
          title={root || '根目录'}
        >
          根目录
        </button>
        {segments.map((segment, index) => (
          <span key={`${index}-${segment}`} style={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <span style={styles.crumbSep}><ChevronRightIcon /></span>
            <button
              type="button"
              style={index === segments.length - 1 ? { ...styles.crumb, ...styles.crumbCurrent } : styles.crumb}
              onClick={() => void loadDir(segments.slice(0, index + 1).join('/'))}
              title={segments.slice(0, index + 1).join('/')}
            >
              {segment}
            </button>
          </span>
        ))}
      </div>
      {error !== undefined && <div style={styles.error}>{error}</div>}
      <div style={styles.tree}>
        {loading && entries.length === 0 ? <div style={styles.empty}>加载中…</div>
          : sorted.length === 0 ? <div style={styles.empty}>空目录</div>
            : (
              <>
                {dir.length > 0 && (
                  <div
                    style={{ ...styles.row, ...styles.parentRow }}
                    onMouseEnter={event => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' }}
                    onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
                    onClick={() => void loadDir(parentOf(dir))}
                  >
                    <span style={styles.rowIcon}><ArrowUpIcon /></span>
                    <span style={styles.rowName}>上级目录</span>
                  </div>
                )}
                {sorted.map(entry => (
                  <FileRow
                    key={entry.name}
                    entry={entry}
                    selected={selected === childPath(dir, entry.name)}
                    onOpen={() => openEntry(entry)}
                  />
                ))}
              </>
            )}
      </div>
      <div
        style={styles.divider}
        title="拖拽调整区域大小"
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerUp}
        onMouseEnter={() => setDividerActive(true)}
        onMouseLeave={() => { if (dragRef.current === null) setDividerActive(false) }}
      >
        <div style={dividerActive ? { ...styles.dividerPill, ...styles.dividerPillVisible } : styles.dividerPill} />
      </div>
      {selected !== undefined && (
        <div style={{ ...styles.preview, height: previewHeight }}>
          <div style={styles.previewHeader}>
            <span style={styles.previewTitle}>
              <span style={styles.rowIcon}><DocumentIcon /></span>
              <span style={styles.previewPath}>{selected}</span>
              {!isMarkdownFile(selected) && extension.length > 0 && <span style={styles.previewBadge}>{extension}</span>}
            </span>
            {!editing && (
              <button style={styles.buttonGhost} onClick={() => { setDraft(content); setEditing(true) }}>编辑</button>
            )}
            {editing && (
              <button style={styles.button} disabled={saving} onClick={() => void save()}>
                {saving ? '保存中…' : '保存'}
              </button>
            )}
            {editing && (
              <button style={styles.buttonGhost} onClick={() => setEditing(false)}>取消</button>
            )}
          </div>
          {editing
            ? <textarea style={styles.textarea} value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} />
            : isMarkdownFile(selected)
              ? <div style={styles.markdown}><MarkdownText text={content} /></div>
              : <pre style={styles.pre}>{content}</pre>}
        </div>
      )}
    </div>
  )
}

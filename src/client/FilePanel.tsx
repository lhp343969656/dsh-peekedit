/**
 * File browser tool page for the right toolbar: directory navigation, file
 * preview, and editing over the host `/api/peekedit/*` endpoints. The tree
 * and the content area are separated by a draggable divider (vertical
 * resize). Styling rides the Web Client's `--dsw-alias-*` theme tokens, so
 * the page follows the active light/dark theme.
 * @module dsh-peekedit/client/FilePanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { listDir, readFile, writeFile } from './api.ts'
import type { DirEntry } from './api.ts'

/** Combine a relative directory and an entry name into a child rel path. */
function childPath(dir: string, name: string): string {
  return dir.length === 0 ? name : `${dir}/${name}`
}

/** Split a rel path into breadcrumb segments. */
function segmentsOf(dir: string): string[] {
  return dir.length === 0 ? [] : dir.split('/')
}

/** Clamp the preview height into the draggable range. */
function clampPreviewHeight(px: number): number {
  return Math.min(560, Math.max(120, Math.round(px)))
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
    gap: 4,
    padding: '8px 12px',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    flexWrap: 'wrap' as const,
  },
  crumb: {
    background: 'none',
    border: 'none',
    color: 'var(--dsw-alias-state-business-primary)',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  crumbSep: { color: 'var(--dsw-alias-label-tertiary)' },
  tree: {
    flex: 1,
    minHeight: 80,
    overflow: 'auto',
    padding: 6,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  rowSelected: { background: 'var(--dsw-alias-interactive-bg-active)' },
  rowName: { overflow: 'hidden', textOverflow: 'ellipsis' },
  rowSize: { marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 },
  empty: { color: 'var(--dsw-alias-label-tertiary)', padding: 16, textAlign: 'center' as const },
  error: {
    margin: 8,
    padding: '8px 10px',
    borderRadius: 4,
    background: 'var(--dsw-static-red-50)',
    color: 'var(--dsw-alias-state-error-primary)',
    whiteSpace: 'pre-wrap' as const,
  },
  divider: {
    height: 7,
    cursor: 'row-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    touchAction: 'none' as const,
    flexShrink: 0,
  },
  dividerLine: {
    width: '100%',
    height: 1,
    background: 'var(--dsw-alias-border-l2)',
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
  previewPath: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--dsw-alias-label-secondary)' },
  button: {
    background: 'var(--dsw-alias-state-business-primary)',
    border: 'none',
    color: '#fff',
    borderRadius: 4,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  buttonGhost: {
    background: 'none',
    border: '1px solid var(--dsw-alias-border-l3)',
    color: 'var(--dsw-alias-label-secondary)',
    borderRadius: 4,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  pre: {
    margin: 0,
    padding: 10,
    overflow: 'auto',
    whiteSpace: 'pre' as const,
    fontSize: 12,
    fontFamily: 'var(--ds-font-family-code)',
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-markdown-code-block)',
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
    whiteSpace: 'pre' as const,
    flex: 1,
  },
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
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const loadDir = useCallback(async (next: string): Promise<void> => {
    setLoading(true)
    setError(undefined)
    setSelected(undefined)
    setEditing(false)
    try {
      const response = await listDir(sessionId, next)
      setRoot(response.root)
      setDir(response.path === response.root ? '' : next)
      setEntries(response.entries)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  const loadFile = useCallback(async (path: string): Promise<void> => {
    setLoading(true)
    setError(undefined)
    setEditing(false)
    try {
      const response = await readFile(sessionId, path)
      setSelected(path)
      setContent(response.content)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
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
  // the divider, mirroring the frame's column drag handles).
  const onDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startY: event.clientY, startHeight: previewHeight }
  }
  const onDividerPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) return
    setPreviewHeight(clampPreviewHeight(dragRef.current.startHeight + (dragRef.current.startY - event.clientY)))
  }
  const onDividerPointerUp = (): void => {
    dragRef.current = null
  }

  const sorted = [...entries].sort((left, right) =>
    left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === 'directory' ? -1 : 1)

  return (
    <div style={styles.root}>
      <div style={styles.breadcrumbs}>
        <button style={styles.crumb} onClick={() => void loadDir('')}>根目录</button>
        {segmentsOf(dir).map((segment, index) => (
          <span key={`${index}-${segment}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={styles.crumbSep}>/</span>
            <button style={styles.crumb} onClick={() => void loadDir(segmentsOf(dir).slice(0, index + 1).join('/'))}>
              {segment}
            </button>
          </span>
        ))}
      </div>
      {error !== undefined && <div style={styles.error}>{error}</div>}
      <div style={styles.tree}>
        {loading && entries.length === 0 ? <div style={styles.empty}>加载中…</div>
          : sorted.length === 0 ? <div style={styles.empty}>空目录</div>
            : sorted.map(entry => (
              <div
                key={entry.name}
                style={selected === childPath(dir, entry.name) ? { ...styles.row, ...styles.rowSelected } : styles.row}
                onClick={() => openEntry(entry)}
                title={entry.type === 'directory' ? '打开目录' : '预览文件'}
              >
                <span>{entry.type === 'directory' ? '📁' : '📄'}</span>
                <span style={styles.rowName}>{entry.name}</span>
                {entry.type === 'file' && entry.size !== undefined && (
                  <span style={styles.rowSize}>{entry.size} B</span>
                )}
              </div>
            ))}
      </div>
      <div
        style={styles.divider}
        title="拖拽调整区域大小"
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerUp}
      >
        <div style={styles.dividerLine} />
      </div>
      {selected !== undefined && (
        <div style={{ ...styles.preview, height: previewHeight }}>
          <div style={styles.previewHeader}>
            <span style={styles.previewPath}>{selected}</span>
            {!editing && (
              <button style={styles.button} onClick={() => { setDraft(content); setEditing(true) }}>编辑</button>
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
            : <pre style={styles.pre}>{content}</pre>}
        </div>
      )}
    </div>
  )
}

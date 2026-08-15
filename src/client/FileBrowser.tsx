/**
 * File browser drawer: directory navigation, file preview, and editing over
 * the host `/api/peekedit/*` endpoints. Rendered into `document.body` via a
 * portal so it overlays any session view.
 * @module dsh-peekedit/client/FileBrowser
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { listDir, readFile, writeFile } from './api.ts'
import type { DirEntry } from './api.ts'
import { closeBrowser, getBrowserOpen, subscribeBrowser, toggleBrowser } from './store.ts'

/** Combine a relative directory and an entry name into a child rel path. */
function childPath(dir: string, name: string): string {
  return dir.length === 0 ? name : `${dir}/${name}`
}

/** Split a rel path into breadcrumb segments. */
function segmentsOf(dir: string): string[] {
  return dir.length === 0 ? [] : dir.split('/')
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0, 0, 0, 0.35)',
    zIndex: 1000,
  },
  drawer: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: 480,
    maxWidth: '90vw',
    background: '#1e1f24',
    color: '#e8e8ea',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.4)',
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
  title: { fontWeight: 600, fontSize: 14 },
  rootPath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: '#9a9aa3',
    fontSize: 12,
  },
  close: {
    background: 'none',
    border: 'none',
    color: '#e8e8ea',
    fontSize: 16,
    cursor: 'pointer',
    padding: '2px 6px',
  },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '8px 12px',
    borderBottom: '1px solid #2c2d33',
    flexWrap: 'wrap' as const,
  },
  crumb: {
    background: 'none',
    border: 'none',
    color: '#7fb3e8',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: 12,
  },
  crumbSep: { color: '#55565e' },
  body: { flex: 1, overflow: 'auto', padding: 8 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  rowSelected: { background: '#2f3644' },
  rowName: { overflow: 'hidden', textOverflow: 'ellipsis' },
  rowSize: { marginLeft: 'auto', color: '#6f7078', fontSize: 11 },
  empty: { color: '#6f7078', padding: 16, textAlign: 'center' as const },
  error: {
    margin: 8,
    padding: '8px 10px',
    borderRadius: 4,
    background: '#3d2326',
    color: '#ff9d9d',
    whiteSpace: 'pre-wrap' as const,
  },
  preview: {
    margin: '0 8px 8px',
    border: '1px solid #33343b',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 200,
  },
  previewHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderBottom: '1px solid #2c2d33',
    background: '#26272d',
  },
  previewPath: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', color: '#b9bac0' },
  button: {
    background: '#3b6ea5',
    border: 'none',
    color: '#fff',
    borderRadius: 4,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  buttonGhost: {
    background: 'none',
    border: '1px solid #44454e',
    color: '#d0d0d6',
    borderRadius: 4,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  pre: {
    margin: 0,
    padding: 10,
    overflow: 'auto',
    maxHeight: 320,
    whiteSpace: 'pre' as const,
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#d6d6dc',
  },
  textarea: {
    margin: 0,
    padding: 10,
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    minHeight: 260,
    background: '#17181c',
    color: '#e8e8ea',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    whiteSpace: 'pre' as const,
  },
  footer: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    padding: '8px 10px',
    borderTop: '1px solid #2c2d33',
  },
}

/** The file-browser drawer; mounted by the header action when open. */
export function FileBrowser({ sessionId }: { sessionId: string }): React.ReactNode {
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

  const sorted = [...entries].sort((left, right) =>
    left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === 'directory' ? -1 : 1)

  return createPortal(
    <div style={styles.overlay} onClick={closeBrowser}>
      <div style={styles.drawer} onClick={event => event.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>📁 文件浏览器</span>
          <span style={styles.rootPath}>{root || '…'}</span>
          <button style={styles.close} onClick={closeBrowser} title="关闭">✕</button>
        </div>
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
        <div style={styles.body}>
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
        {selected !== undefined && (
          <div style={styles.preview}>
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
    </div>,
    document.body,
  )
}

/** The header action button toggling the browser drawer; renders the drawer when open. */
export function HeaderActionButton({ sessionId }: { sessionId: string }): React.ReactNode {
  const open = useSyncExternalStore(subscribeBrowser, getBrowserOpen)
  return (
    <>
      <button
        type="button"
        title="文件浏览器"
        onClick={toggleBrowser}
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
      {open && <FileBrowser sessionId={sessionId} />}
    </>
  )
}

/**
 * File browser tool page for the right toolbar: directory navigation, file
 * preview, and editing over the host `/api/peekedit/*` endpoints. Rendered
 * inside the toolbar host's body; the host owns the header/collapse chrome.
 * @module dsh-peekedit/client/FilePanel
 */

import { useCallback, useEffect, useState } from 'react'
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

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
    background: '#1e1f24',
    color: '#e8e8ea',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 13,
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
    maxHeight: '45%',
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
    minHeight: 240,
    background: '#17181c',
    color: '#e8e8ea',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
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
  )
}

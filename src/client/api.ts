/**
 * Fetch helpers for the file-browser API. All calls are same-origin; failures
 * surface as `PeekeditApiError` carrying the server's stable code.
 * @module dsh-peekedit/client/api
 */

/** One directory entry returned by the list endpoint. */
export interface DirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

export interface ListResponse {
  root: string
  path: string
  entries: DirEntry[]
}

export interface ReadResponse {
  root: string
  path: string
  content: string
}

export interface WriteResponse {
  path: string
  operation: 'create' | 'update'
}

/** A failed API call: HTTP status plus the server's stable error code. */
export class PeekeditApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON responses fall through to the generic error below.
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error
    throw new PeekeditApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `request failed with status ${response.status}`,
    )
  }
  return body as T
}

function withSession(session: string, path: string): string {
  return `/api/peekedit/list?session=${encodeURIComponent(session)}&path=${encodeURIComponent(path)}`
}

/** List one directory's children. */
export function listDir(session: string, path: string): Promise<ListResponse> {
  return request<ListResponse>(withSession(session, path))
}

/** Read a file's full text content. */
export function readFile(session: string, path: string): Promise<ReadResponse> {
  return request<ReadResponse>(`/api/peekedit/read?session=${encodeURIComponent(session)}&path=${encodeURIComponent(path)}`)
}

/** Replace a file's whole content. */
export function writeFile(session: string, path: string, content: string): Promise<WriteResponse> {
  return request<WriteResponse>('/api/peekedit/write', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session, path, content }),
  })
}

import { getAccessToken } from './auth'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

const REQUEST_TYPE = 'kings-track-bridge:request'
const RESPONSE_TYPE = 'kings-track-bridge:response'
const PROTOCOL = 'v1'

type AllowedEntry = { method: 'GET' | 'POST'; path: string }

const ALLOWED: ReadonlyArray<AllowedEntry> = [
  { method: 'POST', path: '/admin/gradeo/student-directory' },
  { method: 'POST', path: '/admin/gradeo/classes' },
  { method: 'POST', path: '/admin/gradeo/imports/preflight' },
  { method: 'POST', path: '/admin/gradeo/imports' },
  { method: 'GET', path: '/admin/gradeo/mappings' },
]

function isAllowed(method: string, path: string): boolean {
  return ALLOWED.some(entry => entry.method === method && entry.path === path)
}

export interface BridgeRequest {
  type: typeof REQUEST_TYPE
  bridgeProtocol: string
  requestId: string
  path: string
  method: 'GET' | 'POST'
  body?: unknown
}

export interface BridgeEvent {
  requestId: string
  method: string
  path: string
  status: number
  durationMs: number
  ok: boolean
  error?: string
  startedAt: string
}

type BridgeListener = (event: BridgeEvent) => void

function postResponse(payload: {
  requestId: string
  ok: boolean
  status: number
  data?: unknown
  error?: string
}) {
  window.postMessage({ type: RESPONSE_TYPE, ...payload }, window.location.origin)
}

export function installExtensionBridge(onEvent?: BridgeListener): () => void {
  async function handler(event: MessageEvent) {
    if (event.source !== window) return
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type !== REQUEST_TYPE) return
    if (data.bridgeProtocol !== PROTOCOL) return

    const requestId = String(data.requestId ?? '')
    const method = String(data.method ?? '').toUpperCase()
    const path = String(data.path ?? '')
    const startedAt = new Date().toISOString()
    const t0 = performance.now()

    if (!requestId) {
      // Without an id we can't correlate a response — drop silently.
      return
    }

    if (!isAllowed(method, path)) {
      const error = `Path/method not allowed: ${method} ${path}`
      postResponse({ requestId, ok: false, status: 0, error })
      onEvent?.({
        requestId,
        method,
        path,
        status: 0,
        durationMs: 0,
        ok: false,
        error,
        startedAt,
      })
      return
    }

    try {
      const token = await getAccessToken()
      const init: RequestInit = {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          'X-Bridge-Request-Id': requestId,
        },
      }
      if (method === 'POST' && data.body !== undefined) {
        init.body = JSON.stringify(data.body)
      }

      const res = await fetch(`${API_BASE}${path}`, init)
      const status = res.status
      let payload: unknown = undefined
      const contentType = res.headers.get('content-type') || ''
      if (status !== 204) {
        if (contentType.includes('application/json')) {
          const text = await res.text().catch(() => '')
          payload = text ? JSON.parse(text) : undefined
        } else {
          payload = await res.text().catch(() => '')
        }
      }
      const durationMs = Math.round(performance.now() - t0)

      if (!res.ok) {
        const errMsg =
          typeof payload === 'string'
            ? payload
            : payload && typeof payload === 'object' && 'detail' in (payload as Record<string, unknown>)
              ? String((payload as Record<string, unknown>).detail)
              : `HTTP ${status}`
        postResponse({ requestId, ok: false, status, data: payload, error: errMsg })
        onEvent?.({ requestId, method, path, status, durationMs, ok: false, error: errMsg, startedAt })
        return
      }

      postResponse({ requestId, ok: true, status, data: payload })
      onEvent?.({ requestId, method, path, status, durationMs, ok: true, startedAt })
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0)
      const message = err instanceof Error ? err.message : String(err)
      postResponse({ requestId, ok: false, status: 0, error: message })
      onEvent?.({ requestId, method, path, status: 0, durationMs, ok: false, error: message, startedAt })
    }
  }

  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}

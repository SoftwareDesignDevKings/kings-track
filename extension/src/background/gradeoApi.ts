const ext = self.KingsTrackExtension

const GRADEO_BASE_URL = 'https://platform.gradeo.com.au'
const GRADEO_FETCH_TIMEOUT_MS = 45000
const SLOW_REQUEST_LOG_MS = 2000

export function sanitizeApiHeaders(headers: Record<string, any>) {
  const blockedHeaders = new Set([
    'accept-encoding',
    'connection',
    'content-length',
    'cookie',
    'host',
    'origin',
    'referer',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'te',
    'user-agent',
  ])

  return Object.fromEntries(
    Object.entries(headers || {})
      .map(([key, value]) => [String(key || '').trim(), value])
      .filter(([key, value]) => key && value != null && String(value).trim() !== '')
      .filter(([key]) => !blockedHeaders.has(String(key).toLowerCase()))
  )
}

function parseRawHeaderBlock(raw: string) {
  const headers: Record<string, string> = {}
  let requestLine: string | null = null
  String(raw || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      if (index === 0 && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i.test(line)) {
        requestLine = line
        return
      }
      const separatorIndex = line.indexOf(':')
      if (separatorIndex <= 0) {
        return
      }
      const key = line.slice(0, separatorIndex).trim()
      const value = line.slice(separatorIndex + 1).trim()
      if (key && value) {
        headers[key] = value
      }
    })
  return { headers, requestLine }
}

function readCookieValue(cookieHeader: string, key: string) {
  if (!cookieHeader) {
    return null
  }
  const match = String(cookieHeader).match(new RegExp(`${key}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

function extractSchoolIdFromRaw(rawText: string, parsedHeaders: Record<string, any>, requestLine: string | null) {
  const fromCookie = readCookieValue(
    parsedHeaders.Cookie || parsedHeaders.cookie || '',
    'admin_user_schoolId',
  )
  if (fromCookie) {
    return fromCookie
  }

  const searchText = [requestLine, rawText, parsedHeaders['X-School-Id'], parsedHeaders['x-school-id']]
    .filter(Boolean)
    .join('\n')
  const routeMatch = searchText.match(/\/api\/(?:student-group\/v2|school\/v2\/list\/student)\/([0-9a-f-]{36})/i)
  return routeMatch ? routeMatch[1] : null
}

export async function getGradeoApiContext() {
  const config = await ext.getConfig()
  const raw = String(config?.gradeoApiHeadersJson || '{}').trim() || '{}'

  let parsedHeaders: Record<string, any> = {}
  let requestLine: string | null = null
  if (raw.startsWith('{')) {
    try {
      parsedHeaders = JSON.parse(raw)
    } catch (error) {
      throw new Error('Gradeo API headers are invalid JSON. Paste a valid JSON object or raw copied headers block.')
    }
  } else {
    const parsed = parseRawHeaderBlock(raw)
    parsedHeaders = parsed.headers
    requestLine = parsed.requestLine
  }

  if (!parsedHeaders || typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
    throw new Error('Gradeo API headers must be a JSON object or raw copied headers.')
  }

  const headers = sanitizeApiHeaders(parsedHeaders)
  const authorizationHeader = Object.keys(headers).find(key => key.toLowerCase() === 'authorization')
  if (!authorizationHeader || !String(headers[authorizationHeader]).trim()) {
    throw new Error('Gradeo API headers are missing Authorization. Save a fresh copied request from Gradeo first.')
  }

  const schoolId = extractSchoolIdFromRaw(raw, parsedHeaders, requestLine)

  await ext.logDebug('background', 'gradeo_api_context_loaded', {
    schoolId,
    keys: Object.keys(headers),
  })

  return {
    headers,
    schoolId,
    baseUrl: GRADEO_BASE_URL,
  }
}

export async function gradeoFetchJson(ctx: Record<string, any>, path: string, scope?: string) {
  const url = path.startsWith('http') ? path : `${ctx.baseUrl}${path}`
  const startedAt = Date.now()
  await ext.logDebug('background', 'gradeo_request_started', {
    scope: scope || 'gradeo',
    path,
    timeoutMs: GRADEO_FETCH_TIMEOUT_MS,
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Gradeo request timed out after ${GRADEO_FETCH_TIMEOUT_MS}ms`))
  }, GRADEO_FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...ctx.headers,
      },
    })
  } catch (error) {
    await ext.logDebug('background', 'gradeo_request_failed', {
      scope: scope || 'gradeo',
      path,
      durationMs: Date.now() - startedAt,
      error: String(error),
    })
    if (controller.signal.aborted) {
      throw new Error(`Gradeo request timed out after ${Math.round(GRADEO_FETCH_TIMEOUT_MS / 1000)}s for ${path}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 401) {
    throw new Error('Gradeo API returned 401. Refresh the saved Gradeo headers and make sure you are still signed in to Gradeo.')
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    await ext.logDebug('background', 'gradeo_api_request_failed', {
      scope: scope || 'gradeo',
      status: response.status,
      url,
      body: body.slice(0, 300),
    })
    throw new Error(`Gradeo API ${response.status} for ${path}`)
  }

  const durationMs = Date.now() - startedAt
  if (durationMs >= SLOW_REQUEST_LOG_MS) {
    await ext.logDebug('background', 'gradeo_request_slow', {
      scope: scope || 'gradeo',
      path,
      durationMs,
      status: response.status,
    })
  } else {
    await ext.logDebug('background', 'gradeo_request_succeeded', {
      scope: scope || 'gradeo',
      path,
      durationMs,
      status: response.status,
    })
  }

  return response.json()
}

(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension

  const SCHOOL_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const JWT_PATTERN = /(?:Bearer\s+)?([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g
  const SESSION_STALE_MS = 22 * 60 * 60 * 1000

  function decodeBase64Url(value: string) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    if (typeof atob === 'function') {
      return atob(padded)
    }
    const bufferCtor = (globalThis as any).Buffer
    if (bufferCtor) {
      return bufferCtor.from(padded, 'base64').toString('utf8')
    }
    return ''
  }

  function decodeJwtPayload(token: string) {
    const parts = String(token || '').split('.')
    if (parts.length < 2) {
      return null
    }
    try {
      return JSON.parse(decodeBase64Url(parts[1]))
    } catch (_error) {
      return null
    }
  }

  function textIncludesGradeo(value: any) {
    return /gradeo|auth0/i.test(
      Array.isArray(value) || (value && typeof value === 'object')
        ? JSON.stringify(value)
        : String(value || ''),
    )
  }

  function scoreToken(token: string) {
    const payload = decodeJwtPayload(token)
    if (!payload) {
      return 0
    }
    let score = 1
    if (textIncludesGradeo(payload.iss)) {
      score += 4
    }
    if (textIncludesGradeo(payload.aud)) {
      score += 4
    }
    if (payload.exp && Number(payload.exp) * 1000 > Date.now()) {
      score += 1
    }
    return score
  }

  function findTokensFromText(text: string) {
    const matches: string[] = []
    const input = String(text || '')
    for (const match of input.matchAll(JWT_PATTERN)) {
      if (match[1]) {
        matches.push(match[1])
      }
    }
    return matches
  }

  function findGradeoBearerTokenFromText(text: string) {
    const tokens = findTokensFromText(text)
      .map(token => ({ token, score: scoreToken(token) }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score)
    return tokens[0]?.token || null
  }

  function readCookieValue(cookieText: string, key: string) {
    const match = String(cookieText || '').match(new RegExp(`${key}=([^;\\s]+)`, 'i'))
    return match ? decodeURIComponent(match[1]) : null
  }

  function extractGradeoSchoolIdFromText(text: string) {
    const cookieValue = readCookieValue(text, 'admin_user_schoolId')
    if (cookieValue && SCHOOL_ID_PATTERN.test(cookieValue)) {
      return cookieValue
    }

    const routeMatch = String(text || '').match(
      /\/api\/(?:school\/v2\/list\/student|student-group\/v2)\/([0-9a-f-]{36})(?:[/?]|$)/i,
    )
    if (routeMatch?.[1] && SCHOOL_ID_PATTERN.test(routeMatch[1])) {
      return routeMatch[1]
    }

    const directMatch = String(text || '').match(SCHOOL_ID_PATTERN)
    return directMatch?.[0] || null
  }

  function normalizeAuthorization(value: any) {
    const text = String(value || '').trim()
    if (!text) {
      return null
    }
    if (/^Bearer\s+/i.test(text)) {
      const token = text.replace(/^Bearer\s+/i, '').trim()
      return token ? `Bearer ${token}` : null
    }
    const token = findGradeoBearerTokenFromText(text) || (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text) ? text : null)
    return token ? `Bearer ${token}` : null
  }

  function normalizeGradeoSession(candidate: Record<string, any>) {
    const headers = candidate?.headers || {}
    const headerKey = Object.keys(headers).find(key => key.toLowerCase() === 'authorization')
    const authorization = normalizeAuthorization(
      candidate?.authorization || candidate?.Authorization || (headerKey ? headers[headerKey] : ''),
    )
    const schoolId = String(candidate?.schoolId || candidate?.school_id || '').trim()
    if (!authorization) {
      return null
    }
    return {
      authorization,
      schoolId: SCHOOL_ID_PATTERN.test(schoolId) ? schoolId : null,
      capturedAt: candidate?.capturedAt || new Date().toISOString(),
      source: String(candidate?.source || 'unknown'),
    }
  }

  function sourceLabel(source: string | undefined, fallback: string) {
    const value = String(source || fallback || '').trim()
    return value || 'unknown'
  }

  function extractGradeoSessionFromSources(sources: Record<string, any>) {
    const storageItems = Array.isArray(sources?.storageItems) ? sources.storageItems : []
    const urls = Array.isArray(sources?.urls) ? sources.urls : []
    const headers = sources?.headers && typeof sources.headers === 'object' ? sources.headers : {}
    const textSources = [
      sources?.cookie,
      ...urls,
      ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
    ]
      .filter(Boolean)
      .map(value => String(value))

    let token: string | null = null
    let source = sourceLabel(sources?.source, 'unknown')
    for (const item of storageItems) {
      const text = `${item?.key || ''}\n${item?.value || ''}`
      token = findGradeoBearerTokenFromText(text)
      if (token) {
        source = sourceLabel(item?.source, 'localStorage')
        break
      }
    }

    if (!token) {
      const authorizationKey = Object.keys(headers).find(key => key.toLowerCase() === 'authorization')
      token = normalizeAuthorization(authorizationKey ? headers[authorizationKey] : '')?.replace(/^Bearer\s+/i, '') || null
      if (token) {
        source = sourceLabel(sources?.source, 'headers')
      }
    }

    const schoolId = textSources
      .map(extractGradeoSchoolIdFromText)
      .find(Boolean) || null

    return normalizeGradeoSession({
      authorization: token ? `Bearer ${token}` : null,
      schoolId,
      source,
      capturedAt: sources?.capturedAt,
    })
  }

  function describeGradeoSession(session: Record<string, any> | null | undefined) {
    const normalized = session ? normalizeGradeoSession(session) : null
    const capturedAt = normalized?.capturedAt || null
    const capturedMs = capturedAt ? Date.parse(capturedAt) : NaN
    const stale = !normalized || !Number.isFinite(capturedMs) || Date.now() - capturedMs > SESSION_STALE_MS
    return {
      hasAuthorization: Boolean(normalized?.authorization),
      schoolId: normalized?.schoolId || null,
      capturedAt,
      source: normalized?.source || null,
      stale,
    }
  }

  ext.findGradeoBearerTokenFromText = findGradeoBearerTokenFromText
  ext.extractGradeoSchoolIdFromText = extractGradeoSchoolIdFromText
  ext.extractGradeoSessionFromSources = extractGradeoSessionFromSources
  ext.normalizeGradeoSession = normalizeGradeoSession
  ext.describeGradeoSession = describeGradeoSession
})()

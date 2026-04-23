(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const AUTH_CACHE_KEY = 'kingsTrackAuthCache'
  const BACKEND_STATUS_KEY = 'kingsTrackBackendStatus'
  const DEFAULT_AUTH_CACHE_MS = 30 * 1000
  const DEFAULT_BACKEND_CACHE_MS = 30 * 1000
  let currentUserPromise = null
  let backendStatusPromise = null

  async function fetchWithTimeout(url, options, timeoutMs) {
    const requestOptions = options || {}
    const fetchOptions = { ...requestOptions }
    delete fetchOptions.timeoutMs
    const controller = new AbortController()
    const externalSignal = requestOptions.signal
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    let removeAbortListener = null
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason)
      } else {
        const handleAbort = () => controller.abort(externalSignal.reason)
        externalSignal.addEventListener('abort', handleAbort, { once: true })
        removeAbortListener = () => externalSignal.removeEventListener('abort', handleAbort)
      }
    }

    try {
      return await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted && !(externalSignal && externalSignal.aborted)) {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s while calling ${url}`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
      if (removeAbortListener) {
        removeAbortListener()
      }
    }
  }

  ext.getSession = async function getSession() {
    return null
  }

  ext.fetchApi = async function fetchApi(path, options) {
    const config = await ext.getConfig()
    const extensionApiKey = String(config.extensionApiKey || '').trim()
    const requestedTimeoutMs = options && Number.isFinite(Number(options.timeoutMs))
      ? Number(options.timeoutMs)
      : null
    const configuredTimeoutMs = Number.isFinite(Number(config.apiTimeoutMs))
      ? Number(config.apiTimeoutMs)
      : null
    const timeoutMs = requestedTimeoutMs != null
      ? Math.max(1000, requestedTimeoutMs)
      : configuredTimeoutMs != null
        ? Math.max(1000, configuredTimeoutMs)
        : null
    const authHeaders = extensionApiKey
      ? { 'X-Extension-Api-Key': extensionApiKey }
      : {}

    const url = `${config.apiBaseUrl.replace(/\/$/, '')}${path}`
    const requestOptions = {
      ...(options || {}),
      headers: {
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
        ...authHeaders,
      },
    }
    const response = timeoutMs != null
      ? await fetchWithTimeout(url, requestOptions, timeoutMs)
      : await fetch(url, requestOptions)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`API ${response.status}: ${text}`)
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return response.json()
    }
    return response.text()
  }

  ext.getCachedAuthStatus = async function getCachedAuthStatus(maxAgeMs) {
    const result = await browser.storage.local.get(AUTH_CACHE_KEY)
    const cache = result[AUTH_CACHE_KEY]
    if (!cache || !cache.checkedAt) {
      return null
    }
    const age = Date.now() - Number(cache.checkedAt)
    if (age > (typeof maxAgeMs === 'number' ? maxAgeMs : DEFAULT_AUTH_CACHE_MS)) {
      return null
    }
    return {
      ok: Boolean(cache.ok),
      checkedAt: Number(cache.checkedAt),
      error: cache.error || null,
    }
  }

  ext.getCachedBackendStatus = async function getCachedBackendStatus(maxAgeMs) {
    const result = await browser.storage.local.get(BACKEND_STATUS_KEY)
    const cache = result[BACKEND_STATUS_KEY]
    if (!cache || !cache.checkedAt) {
      return null
    }
    const age = Date.now() - Number(cache.checkedAt)
    if (age > (typeof maxAgeMs === 'number' ? maxAgeMs : DEFAULT_BACKEND_CACHE_MS)) {
      return null
    }
    return {
      ok: Boolean(cache.ok),
      checkedAt: Number(cache.checkedAt),
      error: cache.error || null,
    }
  }

  ext.getCachedCurrentUser = async function getCachedCurrentUser(maxAgeMs) {
    const result = await browser.storage.local.get(AUTH_CACHE_KEY)
    const cache = result[AUTH_CACHE_KEY]
    if (!cache || !cache.user || !cache.cachedAt) {
      return null
    }
    const age = Date.now() - Number(cache.cachedAt)
    if (age > (typeof maxAgeMs === 'number' ? maxAgeMs : DEFAULT_AUTH_CACHE_MS)) {
      return null
    }
    return cache.user
  }

  ext.invalidateCurrentUserCache = async function invalidateCurrentUserCache() {
    currentUserPromise = null
    await browser.storage.local.remove(AUTH_CACHE_KEY)
  }

  ext.invalidateBackendStatusCache = async function invalidateBackendStatusCache() {
    backendStatusPromise = null
    await browser.storage.local.remove(BACKEND_STATUS_KEY)
  }

  ext.refreshBackendStatus = async function refreshBackendStatus() {
    if (backendStatusPromise) {
      return backendStatusPromise
    }

    backendStatusPromise = ext.fetchApi('/health')
      .then(async () => {
        await browser.storage.local.set({
          [BACKEND_STATUS_KEY]: {
            ok: true,
            error: null,
            checkedAt: Date.now(),
          },
        })
        return { ok: true }
      })
      .catch(async (error) => {
        await browser.storage.local.set({
          [BACKEND_STATUS_KEY]: {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            checkedAt: Date.now(),
          },
        }).catch(() => undefined)
        throw error
      })
      .finally(() => {
        backendStatusPromise = null
      })

    return backendStatusPromise
  }

  ext.refreshCurrentUser = async function refreshCurrentUser() {
    if (currentUserPromise) {
      return currentUserPromise
    }

    currentUserPromise = ext.fetchApi('/auth/me')
      .then(async (user) => {
        await browser.storage.local.set({
          [AUTH_CACHE_KEY]: {
            ok: true,
            user,
            error: null,
            checkedAt: Date.now(),
            cachedAt: Date.now(),
          },
        })
        return user
      })
      .catch(async (error) => {
        await browser.storage.local.set({
          [AUTH_CACHE_KEY]: {
            ok: false,
            user: null,
            error: error instanceof Error ? error.message : String(error),
            checkedAt: Date.now(),
            cachedAt: Date.now(),
          },
        }).catch(() => undefined)
        throw error
      })
      .finally(() => {
        currentUserPromise = null
      })

    return currentUserPromise
  }

  ext.getCurrentUser = async function getCurrentUser(options) {
    const maxAgeMs = options?.maxAgeMs
    const cachedUser = await ext.getCachedCurrentUser(maxAgeMs)
    if (cachedUser) {
      return cachedUser
    }
    return ext.refreshCurrentUser()
  }
})()

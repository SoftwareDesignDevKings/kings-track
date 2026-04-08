(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const AUTH_CACHE_KEY = 'kingsTrackAuthCache'
  const DEFAULT_AUTH_CACHE_MS = 30 * 1000
  let currentUserPromise = null

  ext.getSession = async function getSession() {
    return null
  }

  ext.fetchApi = async function fetchApi(path, options) {
    const config = await ext.getConfig()
    const extensionApiKey = String(config.extensionApiKey || '').trim()
    const authHeaders = extensionApiKey
      ? { 'X-Extension-Api-Key': extensionApiKey }
      : {}

    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      ...(options || {}),
      headers: {
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
        ...authHeaders,
      },
    })
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

  ext.getCurrentUser = async function getCurrentUser() {
    return ext.fetchApi('/auth/me')
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

  ext.refreshCurrentUser = async function refreshCurrentUser() {
    if (currentUserPromise) {
      return currentUserPromise
    }

    currentUserPromise = ext.fetchApi('/auth/me')
      .then(async (user) => {
        await browser.storage.local.set({
          [AUTH_CACHE_KEY]: {
            user,
            cachedAt: Date.now(),
          },
        })
        return user
      })
      .catch(async (error) => {
        await browser.storage.local.remove(AUTH_CACHE_KEY).catch(() => undefined)
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

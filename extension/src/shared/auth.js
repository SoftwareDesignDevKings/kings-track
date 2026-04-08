(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension

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

  ext.getCurrentUser = async function getCurrentUser() {
    return ext.fetchApi('/auth/me')
  }
})()

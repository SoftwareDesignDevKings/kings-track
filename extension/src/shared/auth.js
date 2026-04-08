(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
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
})()

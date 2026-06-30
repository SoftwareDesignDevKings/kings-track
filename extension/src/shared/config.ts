(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const CONFIG_KEY = 'kingsTrackConfig'
  const GRADEO_SESSION_KEY = 'kingsTrackGradeoSession'

  ext.defaultConfig = {
    frontendUrl: 'http://localhost:5173',
    gradeoApiHeadersJson: '{}',
  }

  ext.getConfig = async function getConfig() {
    const result = await browser.storage.local.get(CONFIG_KEY)
    return { ...ext.defaultConfig, ...(result[CONFIG_KEY] || {}) }
  }

  ext.saveConfig = async function saveConfig(config) {
    await browser.storage.local.set({
      [CONFIG_KEY]: {
        frontendUrl: String(config.frontendUrl || '').trim().replace(/\/$/, ''),
        gradeoApiHeadersJson: String(config.gradeoApiHeadersJson || '{}').trim() || '{}',
      },
    })
    return ext.getConfig()
  }

  ext.getGradeoSession = async function getGradeoSession() {
    const result = await browser.storage.local.get(GRADEO_SESSION_KEY)
    const session = result[GRADEO_SESSION_KEY]
    return ext.normalizeGradeoSession ? ext.normalizeGradeoSession(session || {}) : null
  }

  ext.saveGradeoSession = async function saveGradeoSession(session) {
    const normalized = ext.normalizeGradeoSession ? ext.normalizeGradeoSession(session || {}) : null
    if (!normalized) {
      throw new Error('Could not detect a valid Gradeo bearer token.')
    }
    await browser.storage.local.set({ [GRADEO_SESSION_KEY]: normalized })
    return normalized
  }

  ext.clearGradeoSession = async function clearGradeoSession() {
    await browser.storage.local.set({ [GRADEO_SESSION_KEY]: null })
  }

  ext.getGradeoSessionStatus = async function getGradeoSessionStatus() {
    const session = await ext.getGradeoSession()
    return ext.describeGradeoSession ? ext.describeGradeoSession(session) : { hasAuthorization: false, stale: true }
  }
})()

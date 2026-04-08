(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const CONFIG_KEY = 'kingsTrackConfig'

  ext.defaultConfig = {
    apiBaseUrl: 'http://localhost:8000/api',
    extensionApiKey: '',
    gradeoApiHeadersJson: '{}',
  }

  ext.getConfig = async function getConfig() {
    const result = await browser.storage.local.get(CONFIG_KEY)
    return { ...ext.defaultConfig, ...(result[CONFIG_KEY] || {}) }
  }

  ext.saveConfig = async function saveConfig(config) {
    await browser.storage.local.set({
      [CONFIG_KEY]: {
        apiBaseUrl: String(config.apiBaseUrl || '').trim(),
        extensionApiKey: String(config.extensionApiKey || '').trim(),
        gradeoApiHeadersJson: String(config.gradeoApiHeadersJson || '{}').trim() || '{}',
      },
    })
    if (typeof ext.invalidateCurrentUserCache === 'function') {
      await ext.invalidateCurrentUserCache()
    }
    if (typeof ext.invalidateBackendStatusCache === 'function') {
      await ext.invalidateBackendStatusCache()
    }
    return ext.getConfig()
  }
})()

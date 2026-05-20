(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const CONFIG_KEY = 'kingsTrackConfig'

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
})()

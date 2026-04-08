(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const CONFIG_KEY = 'kingsTrackConfig'

  ext.defaultConfig = {
    apiBaseUrl: 'http://localhost:8000/api',
    supabaseUrl: '',
    supabaseAnonKey: '',
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
        supabaseUrl: String(config.supabaseUrl || '').trim().replace(/\/$/, ''),
        supabaseAnonKey: String(config.supabaseAnonKey || '').trim(),
        gradeoApiHeadersJson: String(config.gradeoApiHeadersJson || '{}').trim() || '{}',
      },
    })
    return ext.getConfig()
  }
})()

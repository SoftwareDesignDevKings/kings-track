(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const LOG_KEY = 'kingsTrackDebugLogs'
  const MAX_LOGS = 200

  async function appendLocalLog(entry) {
    const result = await browser.storage.local.get(LOG_KEY)
    const logs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : []
    logs.push(entry)
    while (logs.length > MAX_LOGS) {
      logs.shift()
    }
    await browser.storage.local.set({ [LOG_KEY]: logs })
    return logs
  }

  ext.getDebugLogs = async function getDebugLogs() {
    const result = await browser.storage.local.get(LOG_KEY)
    return Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : []
  }

  ext.clearDebugLogs = async function clearDebugLogs() {
    await browser.storage.local.set({ [LOG_KEY]: [] })
  }

  ext.sendDebugLog = async function sendDebugLog(entry) {
    if (!ext.fetchApi) {
      return
    }
    try {
      await ext.fetchApi('/admin/gradeo/extension-log', {
        method: 'POST',
        body: JSON.stringify(entry),
      })
    } catch (error) {
      console.warn('[KingsTrack][debug][upload-failed]', error)
    }
  }

  ext.sendDebugSnapshot = async function sendDebugSnapshot(snapshot) {
    if (!ext.fetchApi) {
      return
    }
    try {
      await ext.fetchApi('/admin/gradeo/extension-snapshot', {
        method: 'POST',
        body: JSON.stringify(snapshot),
      })
    } catch (error) {
      console.warn('[KingsTrack][debug][snapshot-upload-failed]', error)
    }
  }

  ext.logDebug = async function logDebug(scope, event, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      scope,
      event,
      details: details || {},
    }

    console.log('[KingsTrack]', scope, event, details || {})
    await appendLocalLog(entry)

    try {
      if (browser?.runtime?.sendMessage) {
        await browser.runtime.sendMessage({
          type: 'kings.debug.log',
          entry,
        })
      }
    } catch (_error) {
      // Ignore message errors when the background context is unavailable.
    }

    return entry
  }
})()

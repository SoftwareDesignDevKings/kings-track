(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension

  const REQUEST_TYPE = 'kings.bridge.request'
  const DEFAULT_TIMEOUT_MS = 60 * 1000

  function createBridgeRequestId() {
    if (globalThis.crypto?.randomUUID) {
      return `kt-${globalThis.crypto.randomUUID()}`
    }
    return `kt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  }

  async function findBridgeTab(frontendUrl) {
    if (!frontendUrl) {
      throw new Error('Set the Kings Track Dashboard URL in Settings.')
    }
    const base = frontendUrl.replace(/\/$/, '')
    // Firefox's tabs.query URL match patterns don't always cover localhost
    // ports the way Chrome does, so enumerate and filter manually.
    const tabs = await browser.tabs.query({})
    const bridgeTab = (tabs || []).find(tab =>
      typeof tab.url === 'string' && tab.url.startsWith(`${base}/extension-bridge`),
    )
    if (bridgeTab) {
      return bridgeTab
    }
    throw new Error(
      `Open the Kings Track Extension Bridge tab at ${base}/extension-bridge and stay signed in.`,
    )
  }

  // Sends a request to the bridge content script in an open dashboard tab.
  // The bridge forwards via the user's Supabase session and returns the
  // backend's response.
  ext.bridgeRequest = async function bridgeRequest(path, options) {
    const config = await ext.getConfig()
    const tab = await findBridgeTab(config.frontendUrl)
    const method = (options?.method || 'GET').toUpperCase()
    const requestedTimeoutMs = options && Number.isFinite(Number(options.timeoutMs))
      ? Math.max(1000, Number(options.timeoutMs))
      : DEFAULT_TIMEOUT_MS
    let body
    if (options && options.body !== undefined && options.body !== null) {
      if (typeof options.body === 'string') {
        try {
          body = JSON.parse(options.body)
        } catch (_error) {
          body = options.body
        }
      } else {
        body = options.body
      }
    }

    const message = {
      type: REQUEST_TYPE,
      requestId: createBridgeRequestId(),
      path,
      method,
      body,
      timeoutMs: requestedTimeoutMs,
    }

    const response = await browser.tabs.sendMessage(tab.id, message)
    if (!response) {
      throw new Error('Empty response from the bridge tab.')
    }
    if (!response.ok) {
      const detail = response.error || `HTTP ${response.status}`
      throw new Error(`Bridge request failed: ${detail}`)
    }
    return response.data
  }
})()

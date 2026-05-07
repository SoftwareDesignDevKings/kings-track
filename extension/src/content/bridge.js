(function () {
  const REQUEST_TYPE = 'kings-track-bridge:request'
  const RESPONSE_TYPE = 'kings-track-bridge:response'
  const PROTOCOL = 'v1'
  const DEFAULT_TIMEOUT_MS = 60 * 1000

  // The background script messages this content script with a payload to forward
  // through the dashboard's bridge listener. We use window.postMessage to cross
  // the content-script ↔ page-world boundary.
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'kings.bridge.request') {
      return undefined
    }

    const requestId = String(message.requestId || '')
    if (!requestId) {
      return Promise.resolve({ ok: false, status: 0, error: 'Missing requestId' })
    }

    const timeoutMs = Number.isFinite(Number(message.timeoutMs))
      ? Math.max(1000, Number(message.timeoutMs))
      : DEFAULT_TIMEOUT_MS

    return new Promise((resolve) => {
      let settled = false

      function onMessage(event) {
        if (event.source !== window) return
        const data = event.data
        if (!data || typeof data !== 'object') return
        if (data.type !== RESPONSE_TYPE) return
        if (data.requestId !== requestId) return
        if (settled) return
        settled = true
        cleanup()
        resolve({
          ok: Boolean(data.ok),
          status: Number(data.status ?? 0),
          data: data.data,
          error: data.error,
        })
      }

      function cleanup() {
        window.removeEventListener('message', onMessage)
        clearTimeout(timer)
      }

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        resolve({
          ok: false,
          status: 0,
          error: `Bridge request timed out after ${Math.round(timeoutMs / 1000)}s`,
        })
      }, timeoutMs)

      window.addEventListener('message', onMessage)

      window.postMessage(
        {
          type: REQUEST_TYPE,
          bridgeProtocol: PROTOCOL,
          requestId,
          path: message.path,
          method: message.method,
          body: message.body,
        },
        window.location.origin,
      )
    })
  })
})()

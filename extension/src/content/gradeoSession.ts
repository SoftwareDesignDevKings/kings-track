(function () {
  const ext = self.KingsTrackExtension
  const MESSAGE_TYPE = 'kings.gradeo.sessionCaptured'
  let lastCaptureSignature = ''

  function safeStorageItems(storage: Storage | null | undefined, source: string) {
    const items: Array<{ key: string; value: string | null; source: string }> = []
    try {
      if (!storage) {
        return items
      }
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (!key) {
          continue
        }
        items.push({
          key,
          value: storage.getItem(key),
          source,
        })
      }
    } catch (_error) {
      return items
    }
    return items
  }

  function headersToObject(headers: any) {
    const output: Record<string, any> = {}
    if (!headers) {
      return output
    }
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      headers.forEach((value, key) => {
        output[key] = value
      })
      return output
    }
    if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        if (key) {
          output[String(key)] = value
        }
      })
      return output
    }
    if (typeof headers === 'object') {
      return { ...headers }
    }
    return output
  }

  function requestUrl(input: any) {
    if (!input) {
      return ''
    }
    if (typeof input === 'string') {
      return input
    }
    return String(input.url || input.href || '')
  }

  function sameGradeoOrigin(url: string) {
    try {
      return new URL(url, window.location.href).origin === 'https://platform.gradeo.com.au'
    } catch (_error) {
      return false
    }
  }

  async function saveSession(session: Record<string, any> | null) {
    if (!session?.authorization) {
      return ext.describeGradeoSession ? ext.describeGradeoSession(session) : null
    }
    const signature = [session.authorization, session.schoolId || '', session.source || ''].join('|')
    if (signature === lastCaptureSignature) {
      return ext.describeGradeoSession(session)
    }
    lastCaptureSignature = signature
    try {
      return await browser.runtime.sendMessage({
        type: MESSAGE_TYPE,
        session,
      })
    } catch (_error) {
      return ext.describeGradeoSession(session)
    }
  }

  function handlePageCapture(event: MessageEvent) {
    if (event.source && event.source !== window) {
      return
    }
    if (event.origin && event.origin !== window.location.origin) {
      return
    }
    if (event.data?.type !== 'kings.gradeo.pageSessionCaptured') {
      return
    }
    const session = ext.normalizeGradeoSession({
      authorization: event.data.session?.authorization,
      schoolId: event.data.session?.schoolId,
      source: event.data.session?.source || 'page',
      capturedAt: event.data.session?.capturedAt,
    })
    saveSession(session)
  }

  function injectPageProbe() {
    try {
      if (!browser.runtime.getURL) {
        return
      }
      const container = document.documentElement || document.head
      if (!container) {
        document.addEventListener('DOMContentLoaded', injectPageProbe, { once: true })
        return
      }
      const script = document.createElement('script')
      script.src = browser.runtime.getURL('src/content/gradeoSession.page.js')
      script.async = false
      script.onload = () => script.remove()
      container.appendChild(script)
    } catch (_error) {
      // Direct storage capture remains available even if page-world injection fails.
    }
  }

  async function scanGradeoSession(extra: Record<string, any> = {}) {
    const session = ext.extractGradeoSessionFromSources({
      storageItems: [
        ...safeStorageItems(window.localStorage, 'localStorage'),
        ...safeStorageItems(window.sessionStorage, 'sessionStorage'),
      ],
      cookie: document.cookie || '',
      urls: [window.location.href, ...(Array.isArray(extra.urls) ? extra.urls : [])],
      headers: extra.headers || {},
      source: extra.source,
    })
    return saveSession(session)
  }

  function observeFetchRequest(input: any, init: any) {
    const url = requestUrl(input)
    if (!sameGradeoOrigin(url)) {
      return
    }
    const headers = {
      ...headersToObject(input?.headers),
      ...headersToObject(init?.headers),
    }
    scanGradeoSession({
      urls: [url],
      headers,
      source: 'fetch',
    })
  }

  function installFetchObserver() {
    if (typeof window.fetch !== 'function') {
      return
    }
    const nativeFetch = window.fetch
    window.fetch = function observedGradeoFetch(input: any, init?: any) {
      observeFetchRequest(input, init)
      return nativeFetch.apply(this, arguments as any)
    } as typeof window.fetch
  }

  function installXhrObserver() {
    const proto = window.XMLHttpRequest?.prototype as any
    if (!proto?.open || !proto?.send) {
      return
    }
    const nativeOpen = proto.open
    const nativeSend = proto.send
    const nativeSetRequestHeader = proto.setRequestHeader

    proto.open = function observedGradeoXhrOpen(method: string, url: string) {
      this.__kingsTrackGradeoUrl = url
      this.__kingsTrackGradeoHeaders = {}
      return nativeOpen.apply(this, arguments)
    }

    if (nativeSetRequestHeader) {
      proto.setRequestHeader = function observedGradeoXhrHeader(key: string, value: string) {
        this.__kingsTrackGradeoHeaders = this.__kingsTrackGradeoHeaders || {}
        this.__kingsTrackGradeoHeaders[key] = value
        return nativeSetRequestHeader.apply(this, arguments)
      }
    }

    proto.send = function observedGradeoXhrSend() {
      const url = String(this.__kingsTrackGradeoUrl || '')
      if (sameGradeoOrigin(url)) {
        scanGradeoSession({
          urls: [url],
          headers: this.__kingsTrackGradeoHeaders || {},
          source: 'xhr',
        })
      }
      return nativeSend.apply(this, arguments)
    }
  }

  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'kings.gradeo.scanSession') {
      return scanGradeoSession({ source: 'manual_scan' })
    }
    return undefined
  })

  window.addEventListener('message', handlePageCapture)
  injectPageProbe()
  installFetchObserver()
  installXhrObserver()
  scanGradeoSession({ source: 'localStorage' })
})()

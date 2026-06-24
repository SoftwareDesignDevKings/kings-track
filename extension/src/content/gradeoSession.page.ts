(function () {
  if ((window as any).__kingsTrackGradeoPageProbeInstalled) {
    return
  }
  ;(window as any).__kingsTrackGradeoPageProbeInstalled = true

  const MESSAGE_TYPE = 'kings.gradeo.pageSessionCaptured'
  const JWT_PATTERN = /(?:Bearer\s+)?([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g
  const SCHOOL_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  let lastSignature = ''

  function findToken(text: string) {
    const input = String(text || '')
    for (const match of input.matchAll(JWT_PATTERN)) {
      if (match[1]) {
        return match[1]
      }
    }
    return null
  }

  function cookieValue(cookieText: string, key: string) {
    const match = String(cookieText || '').match(new RegExp(`${key}=([^;\\s]+)`, 'i'))
    return match ? decodeURIComponent(match[1]) : null
  }

  function schoolIdFromText(text: string) {
    const cookieSchoolId = cookieValue(text, 'admin_user_schoolId')
    if (cookieSchoolId && SCHOOL_ID_PATTERN.test(cookieSchoolId)) {
      return cookieSchoolId
    }
    const routeMatch = String(text || '').match(
      /\/api\/(?:school\/v2\/list\/student|student-group\/v2)\/([0-9a-f-]{36})(?:[/?]|$)/i,
    )
    if (routeMatch?.[1] && SCHOOL_ID_PATTERN.test(routeMatch[1])) {
      return routeMatch[1]
    }
    const directMatch = String(text || '').match(SCHOOL_ID_PATTERN)
    return directMatch?.[0] || null
  }

  function headersToObject(headers: any) {
    const output: Record<string, string> = {}
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
          output[String(key)] = String(value || '')
        }
      })
      return output
    }
    if (typeof headers === 'object') {
      Object.entries(headers).forEach(([key, value]) => {
        output[key] = String(value || '')
      })
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

  function postCapture(session: Record<string, any>) {
    if (!session.authorization) {
      return
    }
    const signature = [session.authorization, session.schoolId || '', session.source || ''].join('|')
    if (signature === lastSignature) {
      return
    }
    lastSignature = signature
    window.postMessage({
      type: MESSAGE_TYPE,
      session: {
        authorization: session.authorization,
        schoolId: session.schoolId || null,
        source: session.source || 'page',
        capturedAt: new Date().toISOString(),
      },
    }, window.location.origin)
  }

  function scanStorage(source = 'page_storage') {
    const storages = [window.localStorage, window.sessionStorage]
    let token: string | null = null
    for (const storage of storages) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index)
          const value = key ? storage.getItem(key) : ''
          token = findToken(`${key || ''}\n${value || ''}`)
          if (token) {
            break
          }
        }
      } catch (_error) {
        // Ignore inaccessible storage.
      }
      if (token) {
        break
      }
    }
    postCapture({
      authorization: token ? `Bearer ${token}` : null,
      schoolId: schoolIdFromText(`${document.cookie}\n${window.location.href}`),
      source,
    })
  }

  function observeRequest(url: string, headers: Record<string, any>, source: string) {
    if (!sameGradeoOrigin(url)) {
      return
    }
    const headerText = Object.entries(headers || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')
    const authorizationKey = Object.keys(headers || {}).find(key => key.toLowerCase() === 'authorization')
    const token = authorizationKey
      ? findToken(String(headers[authorizationKey] || ''))
      : findToken(headerText)
    postCapture({
      authorization: token ? `Bearer ${token}` : null,
      schoolId: schoolIdFromText(`${document.cookie}\n${url}`),
      source,
    })
  }

  function installFetchObserver() {
    if (typeof window.fetch !== 'function') {
      return
    }
    const nativeFetch = window.fetch
    window.fetch = function observedGradeoPageFetch(input: any, init?: any) {
      observeRequest(requestUrl(input), {
        ...headersToObject(input?.headers),
        ...headersToObject(init?.headers),
      }, 'page_fetch')
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

    proto.open = function observedGradeoPageXhrOpen(method: string, url: string) {
      this.__kingsTrackGradeoUrl = url
      this.__kingsTrackGradeoHeaders = {}
      return nativeOpen.apply(this, arguments)
    }
    if (nativeSetRequestHeader) {
      proto.setRequestHeader = function observedGradeoPageXhrHeader(key: string, value: string) {
        this.__kingsTrackGradeoHeaders = this.__kingsTrackGradeoHeaders || {}
        this.__kingsTrackGradeoHeaders[key] = value
        return nativeSetRequestHeader.apply(this, arguments)
      }
    }
    proto.send = function observedGradeoPageXhrSend() {
      observeRequest(String(this.__kingsTrackGradeoUrl || ''), this.__kingsTrackGradeoHeaders || {}, 'page_xhr')
      return nativeSend.apply(this, arguments)
    }
  }

  installFetchObserver()
  installXhrObserver()
  scanStorage()
})()

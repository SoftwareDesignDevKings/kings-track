(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const SESSION_KEY = 'kingsTrackSession'
  const CODE_VERIFIER_KEY = 'kingsTrackCodeVerifier'

  function base64Url(buffer) {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  async function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  }

  async function randomString(length) {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return base64Url(bytes.buffer).slice(0, length)
  }

  async function getStoredSession() {
    const result = await browser.storage.local.get(SESSION_KEY)
    return result[SESSION_KEY] || null
  }

  async function setStoredSession(session) {
    await browser.storage.local.set({ [SESSION_KEY]: session })
    return session
  }

  async function removeStoredSession() {
    await browser.storage.local.remove([SESSION_KEY, CODE_VERIFIER_KEY])
  }

  async function exchangeCodeForSession({ supabaseUrl, supabaseAnonKey, code, codeVerifier }) {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_code: code,
        code_verifier: codeVerifier,
      }),
    })

    if (!response.ok) {
      throw new Error(`Supabase PKCE exchange failed: ${response.status}`)
    }

    return response.json()
  }

  async function refreshSession(session, config) {
    if (!session?.refresh_token) {
      return null
    }

    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })

    if (!response.ok) {
      await removeStoredSession()
      return null
    }

    const refreshed = await response.json()
    await setStoredSession(refreshed)
    return refreshed
  }

  ext.getSession = getStoredSession

  ext.getValidSession = async function getValidSession() {
    const config = await ext.getConfig()
    const session = await getStoredSession()
    if (!session) {
      return null
    }

    const now = Math.floor(Date.now() / 1000)
    if (session.expires_at && session.expires_at > now + 60) {
      return session
    }

    return refreshSession(session, config)
  }

  ext.signIn = async function signIn() {
    const config = await ext.getConfig()
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase URL and anon key are required before signing in.')
    }

    const codeVerifier = await randomString(64)
    const codeChallenge = base64Url(await sha256(codeVerifier))
    const redirectTo = browser.identity.getRedirectURL('supabase-auth')
    const authUrl = new URL(`${config.supabaseUrl}/auth/v1/authorize`)
    authUrl.searchParams.set('provider', 'google')
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_to', redirectTo)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    await browser.storage.local.set({ [CODE_VERIFIER_KEY]: codeVerifier })
    const redirectUrl = await browser.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    })
    const url = new URL(redirectUrl)
    const params = new URLSearchParams(url.hash.replace(/^#/, '') || url.search.replace(/^\?/, ''))
    const accessToken = params.get('access_token')
    if (accessToken) {
      const session = {
        access_token: accessToken,
        refresh_token: params.get('refresh_token'),
        expires_at: Number(params.get('expires_at') || 0),
      }
      await setStoredSession(session)
      return session
    }

    const authCode = url.searchParams.get('code')
    if (!authCode) {
      throw new Error('Supabase sign-in did not return an auth code.')
    }

    const verifierResult = await browser.storage.local.get(CODE_VERIFIER_KEY)
    const session = await exchangeCodeForSession({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      code: authCode,
      codeVerifier: verifierResult[CODE_VERIFIER_KEY],
    })
    await setStoredSession(session)
    return session
  }

  ext.signOut = async function signOut() {
    await removeStoredSession()
  }

  ext.fetchApi = async function fetchApi(path, options) {
    const config = await ext.getConfig()
    const session = await ext.getValidSession()
    const authHeaders = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
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

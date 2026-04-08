(function () {
  const apiBaseUrl = document.getElementById('apiBaseUrl')
  const supabaseUrl = document.getElementById('supabaseUrl')
  const supabaseAnonKey = document.getElementById('supabaseAnonKey')
  const gradeoApiHeadersJson = document.getElementById('gradeoApiHeadersJson')
  const authSummary = document.getElementById('authSummary')
  const authDetail = document.getElementById('authDetail')
  const statePill = document.getElementById('statePill')
  const stateDetails = document.getElementById('stateDetails')
  const statusHeadline = document.getElementById('statusHeadline')
  const statusSummary = document.getElementById('statusSummary')
  const debugLogs = document.getElementById('debugLogs')
  const noticeBanner = document.getElementById('noticeBanner')
  const configPill = document.getElementById('configPill')
  const authPill = document.getElementById('authPill')
  const headersPill = document.getElementById('headersPill')
  const workflowHint = document.getElementById('workflowHint')
  const signInButton = document.getElementById('signIn')
  const signOutButton = document.getElementById('signOut')
  const configInputs = [
    apiBaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    gradeoApiHeadersJson,
  ]
  const actionButtonIds = ['syncClasses', 'syncStudents', 'importMappedClasses']
  let noticeTimer = null
  let actionsBusy = false

  function setBusy(buttonIds, busy) {
    buttonIds.forEach(id => {
      const button = document.getElementById(id)
      if (button) {
        button.disabled = busy
      }
    })
  }

  function showNotice(kind, message) {
    noticeBanner.textContent = message
    noticeBanner.className = `notice show ${kind}`
    if (noticeTimer) {
      clearTimeout(noticeTimer)
    }
    noticeTimer = setTimeout(() => {
      noticeBanner.className = 'notice'
      noticeBanner.textContent = ''
    }, 4000)
  }

  function isEditingConfig() {
    const active = document.activeElement
    return configInputs.includes(active)
  }

  function titleCaseStatus(status) {
    return String(status || 'idle')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase())
  }

  function hasSavedHeaders(config) {
    const raw = String(config?.gradeoApiHeadersJson || '').trim()
    return Boolean(raw && raw !== '{}' && raw !== 'null')
  }

  function getPillTone(status) {
    if (['completed', 'authenticated'].includes(status)) {
      return 'good'
    }
    if (['blocked', 'error'].includes(status)) {
      return 'warn'
    }
    return 'idle'
  }

  function updateActionAvailability(canRunActions) {
    actionButtonIds.forEach(id => {
      const button = document.getElementById(id)
      if (button) {
        button.disabled = actionsBusy || !canRunActions
      }
    })
  }

  function updatePill(element, label, tone) {
    element.textContent = label
    element.className = `pill ${tone}`
  }

  function buildStateSummary(state) {
    const safeState = state || { status: 'idle' }
    const status = safeState.status || 'idle'

    if (status === 'idle') {
      return {
        headline: 'Nothing running yet.',
        summary: 'Save your settings, confirm sign-in, and then run the Gradeo sync steps from the workflow card.',
      }
    }

    if (status === 'authenticated') {
      return {
        headline: 'Authentication looks good.',
        summary: safeState.user
          ? `Signed in as ${safeState.user}. You can move on to syncing Gradeo data.`
          : 'You are signed in and ready for the next step.',
      }
    }

    if (status === 'signed_out') {
      return {
        headline: 'Signed out.',
        summary: 'Sign back in with Google if you are using a hosted environment, or keep using local mode if your backend supports it.',
      }
    }

    if (status === 'blocked') {
      return {
        headline: 'Something needs attention before the next step.',
        summary: safeState.message || JSON.stringify(safeState.blocked || safeState.preflight || {}, null, 2),
      }
    }

    if (status === 'error') {
      return {
        headline: `The last action failed${safeState.action ? ` during ${titleCaseStatus(safeState.action)}` : ''}.`,
        summary: safeState.message || 'Check the debug log below for more detail.',
      }
    }

    if (status === 'scraping_reporting') {
      const progress = safeState.progress || {}
      return {
        headline: 'Import in progress.',
        summary: progress.message || 'The extension is collecting reporting data from Gradeo.',
      }
    }

    if (status === 'completed') {
      const action = safeState.action ? titleCaseStatus(safeState.action) : 'The last action'
      return {
        headline: `${action} finished successfully.`,
        summary: safeState.user
          ? `Completed by ${safeState.user}. You can continue with the next workflow step.`
          : 'The latest action completed successfully.',
      }
    }

    return {
      headline: `${titleCaseStatus(status)} in progress.`,
      summary: 'The extension is currently working. You can keep this popup open to watch the latest state.',
    }
  }

  function setWorkflowHint(configReady, authReady, headersReady) {
    if (!configReady) {
      workflowHint.textContent = 'Start by saving the Kings Track API base URL. The sync buttons become useful once connection settings are in place.'
      return
    }
    if (!authReady) {
      workflowHint.textContent = 'Connection settings are saved. Sign in next unless you are intentionally using local backend auth.'
      return
    }
    if (!headersReady) {
      workflowHint.textContent = 'You are almost ready. Paste fresh Gradeo request headers before running classes, students, or imports.'
      return
    }
    workflowHint.textContent = 'Ready to go: sync classes first, link them in Kings Track, then sync students and import mapped classes.'
  }

  function renderState(context) {
    const config = context.config || {}

    if (!isEditingConfig()) {
      apiBaseUrl.value = config.apiBaseUrl || ''
      supabaseUrl.value = config.supabaseUrl || ''
      supabaseAnonKey.value = config.supabaseAnonKey || ''
      gradeoApiHeadersJson.value = config.gradeoApiHeadersJson || '{}'
    }

    const configReady = Boolean(String(config.apiBaseUrl || '').trim())
    const headersReady = hasSavedHeaders(config)
    const user = context.user || null
    const session = context.session || null
    const authReady = Boolean(user || session)
    const localMode = Boolean(user && !session)

    updatePill(configPill, configReady ? 'Saved' : 'Needs setup', configReady ? 'good' : 'warn')
    updatePill(authPill, authReady ? (localMode ? 'Local auth' : 'Signed in') : 'Not signed in', authReady ? 'good' : 'warn')
    updatePill(headersPill, headersReady ? 'Headers saved' : 'Headers missing', headersReady ? 'good' : 'warn')

    if (user) {
      authSummary.textContent = `${user.email} · ${user.role}`
      authDetail.textContent = localMode
        ? 'Using local backend auth. Google sign-in is optional in this setup.'
        : 'Extension session is active and Kings Track recognizes your account.'
    } else if (session) {
      authSummary.textContent = 'Signed in, checking admin access…'
      authDetail.textContent = 'The extension has a session and is still resolving your Kings Track user details.'
    } else {
      authSummary.textContent = 'Not signed in'
      authDetail.textContent = config.supabaseUrl && config.supabaseAnonKey
        ? 'Use Google sign-in for hosted environments, or rely on local backend auth if that is how you are testing.'
        : 'Supabase settings are optional for local-only development. They are required for Google sign-in.'
    }

    signInButton.disabled = Boolean(!config.supabaseUrl || !config.supabaseAnonKey)
    signOutButton.disabled = !authReady
    setWorkflowHint(configReady, authReady, headersReady)
    updateActionAvailability(configReady && authReady && headersReady)

    const status = context.state?.status || 'idle'
    updatePill(statePill, titleCaseStatus(status), getPillTone(status))

    const summary = buildStateSummary(context.state)
    statusHeadline.textContent = summary.headline
    statusSummary.textContent = summary.summary
    stateDetails.textContent = JSON.stringify(context.state || { status: 'idle' }, null, 2)
  }

  async function refreshLogs() {
    const logs = await browser.runtime.sendMessage({ type: 'kings.popup.getDebugLogs' })
    if (!logs || logs.length === 0) {
      debugLogs.textContent = 'No debug logs yet.'
      return
    }
    debugLogs.textContent = logs
      .slice(-25)
      .map(entry => `${entry.timestamp} [${entry.scope}] ${entry.event} ${JSON.stringify(entry.details || {})}`)
      .join('\n')
  }

  async function refresh() {
    const context = await browser.runtime.sendMessage({ type: 'kings.popup.getContext' })
    renderState(context)
    await refreshLogs()
  }

  async function saveConfig(showSavedMessage) {
    await browser.runtime.sendMessage({
      type: 'kings.popup.saveConfig',
      config: {
        apiBaseUrl: apiBaseUrl.value,
        supabaseUrl: supabaseUrl.value,
        supabaseAnonKey: supabaseAnonKey.value,
        gradeoApiHeadersJson: gradeoApiHeadersJson.value,
      },
    })
    if (showSavedMessage) {
      showNotice('good', 'Settings saved.')
    }
    await refresh()
  }

  document.getElementById('saveConfig').addEventListener('click', async () => {
    try {
      await saveConfig(true)
    } catch (error) {
      showNotice('warn', error.message || String(error))
    }
  })

  document.getElementById('saveApiHeaders').addEventListener('click', async () => {
    try {
      await saveConfig(false)
      showNotice('good', 'Gradeo headers saved.')
    } catch (error) {
      showNotice('warn', error.message || String(error))
    }
  })

  document.getElementById('signIn').addEventListener('click', async () => {
    setBusy(['signIn'], true)
    try {
      await browser.runtime.sendMessage({ type: 'kings.popup.signIn' })
      showNotice('good', 'Signed in successfully.')
    } catch (error) {
      authSummary.textContent = error.message
      showNotice('warn', error.message || String(error))
    } finally {
      setBusy(['signIn'], false)
      await refresh()
    }
  })

  document.getElementById('signOut').addEventListener('click', async () => {
    try {
      await browser.runtime.sendMessage({ type: 'kings.popup.signOut' })
      showNotice('good', 'Signed out.')
    } catch (error) {
      showNotice('warn', error.message || String(error))
    } finally {
      await refresh()
    }
  })

  async function runAction(messageType) {
    actionsBusy = true
    setBusy(actionButtonIds, true)
    try {
      await browser.runtime.sendMessage({ type: messageType })
    } catch (error) {
      stateDetails.textContent = error.message
      showNotice('warn', error.message || String(error))
    } finally {
      actionsBusy = false
      setBusy(actionButtonIds, false)
      await refresh()
    }
  }

  document.getElementById('syncStudents').addEventListener('click', async () => {
    await runAction('kings.popup.syncStudents')
  })

  document.getElementById('syncClasses').addEventListener('click', async () => {
    await runAction('kings.popup.syncClasses')
  })

  document.getElementById('importMappedClasses').addEventListener('click', async () => {
    await runAction('kings.popup.importMappedClasses')
  })

  document.getElementById('refreshLogs').addEventListener('click', async () => {
    await refreshLogs()
  })

  document.getElementById('clearLogs').addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'kings.popup.clearDebugLogs' })
    showNotice('good', 'Debug log cleared.')
    await refreshLogs()
  })

  refresh()
  setInterval(refresh, 1500)
})()

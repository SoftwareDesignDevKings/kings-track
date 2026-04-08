(function () {
  const apiBaseUrl = document.getElementById('apiBaseUrl')
  const extensionApiKey = document.getElementById('extensionApiKey')
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
  const configInputs = [
    apiBaseUrl,
    extensionApiKey,
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
        summary: 'Save your API URL and extension key, then paste Gradeo headers and run the sync workflow from this popup.',
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

    if (status === 'loading_mappings') {
      return {
        headline: 'Preparing the import list.',
        summary: 'Reading mapped Gradeo classes from Kings Track before starting the reporting import.',
      }
    }

    if (status === 'loading_reporting_classes') {
      return {
        headline: 'Checking reporting availability.',
        summary: safeState.totalClasses
          ? `Checking ${safeState.totalClasses} mapped class${safeState.totalClasses === 1 ? '' : 'es'} against the Gradeo reporting list.`
          : 'Checking the mapped classes against the Gradeo reporting list.',
      }
    }

    if (status === 'preflighting_import') {
      return {
        headline: 'Checking whether a class is ready.',
        summary: safeState.className
          ? `Preflighting ${safeState.className}${safeState.currentClass && safeState.totalClasses ? ` (${safeState.currentClass}/${safeState.totalClasses})` : ''}.`
          : 'Running the backend preflight checks for the next class import.',
      }
    }

    if (status === 'importing_class') {
      return {
        headline: 'Loading class context.',
        summary: safeState.className
          ? `Fetching the roster and syllabus details for ${safeState.className}${safeState.currentClass && safeState.totalClasses ? ` (${safeState.currentClass}/${safeState.totalClasses})` : ''}.`
          : 'Fetching the class roster and metadata from Gradeo.',
      }
    }

    if (status === 'importing_student_results') {
      return {
        headline: 'Collecting student result summaries.',
        summary: safeState.studentName
          ? `Reading exam results for ${safeState.studentName}${safeState.currentStudent && safeState.totalStudents ? ` (${safeState.currentStudent}/${safeState.totalStudents})` : ''}${safeState.className ? ` in ${safeState.className}` : ''}.`
          : 'Reading the next student result set from Gradeo.',
      }
    }

    if (status === 'importing_exam_sessions') {
      return {
        headline: 'Resolving exam session details.',
        summary: safeState.examName
          ? `Confirming roster and marking data for ${safeState.examName}${safeState.currentExam && safeState.totalExams ? ` (${safeState.currentExam}/${safeState.totalExams})` : ''}${safeState.className ? ` in ${safeState.className}` : ''}.`
          : `Resolving exam session details${safeState.currentExam && safeState.totalExams ? ` (${safeState.currentExam}/${safeState.totalExams})` : ''}.`,
      }
    }

    if (status === 'uploading_class') {
      return {
        headline: 'Uploading the class import.',
        summary: safeState.className
          ? `Sending ${safeState.students || 0} student import record${safeState.students === 1 ? '' : 's'} for ${safeState.className} to Kings Track.`
          : 'Sending the collected class import payload to Kings Track.',
      }
    }

    if (status === 'syncing_students') {
      if (safeState.phase === 'fetching_directory') {
        return {
          headline: 'Syncing the Gradeo student directory.',
          summary: `Fetched ${safeState.fetched || 0} students so far from the Gradeo directory.`,
        }
      }
      if (safeState.phase === 'uploading_student_directory') {
        return {
          headline: 'Uploading the Gradeo student directory.',
          summary: `Sending ${safeState.count || 0} students across ${safeState.pages || 0} page${safeState.pages === 1 ? '' : 's'} to Kings Track.`,
        }
      }
    }

    if (status === 'syncing_classes') {
      if (safeState.phase === 'fetching_classes') {
        return {
          headline: 'Syncing the Gradeo class list.',
          summary: `Fetched ${safeState.fetched || 0} classes so far from Gradeo.`,
        }
      }
      if (safeState.phase === 'uploading_school_groups') {
        return {
          headline: 'Uploading the Gradeo class list.',
          summary: `Sending ${safeState.count || 0} classes across ${safeState.pages || 0} page${safeState.pages === 1 ? '' : 's'} to Kings Track.`,
        }
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

  function setWorkflowHint(configReady, authReady, headersReady, apiKeySaved, localMode) {
    if (!configReady) {
      workflowHint.textContent = 'Start by saving the Kings Track API base URL so the extension knows where to send imports.'
      return
    }
    if (!apiKeySaved && !localMode) {
      workflowHint.textContent = 'Generate an extension API key in Kings Track Settings, paste it here, and save it before trying the sync actions.'
      return
    }
    if (!authReady) {
      workflowHint.textContent = 'The saved key has not verified yet. Double-check the API base URL, regenerate the key if needed, and make sure the key belongs to an admin account.'
      return
    }
    if (!headersReady) {
      workflowHint.textContent = 'Access looks good. Paste fresh Gradeo request headers before syncing classes, students, or imports.'
      return
    }
    workflowHint.textContent = 'Ready to go: sync classes first, link them in Kings Track, then sync students and import mapped classes.'
  }

  function renderState(context) {
    const config = context.config || {}

    if (!isEditingConfig()) {
      apiBaseUrl.value = config.apiBaseUrl || ''
      extensionApiKey.value = config.extensionApiKey || ''
      gradeoApiHeadersJson.value = config.gradeoApiHeadersJson || '{}'
    }

    const configReady = Boolean(String(config.apiBaseUrl || '').trim())
    const headersReady = hasSavedHeaders(config)
    const apiKeySaved = Boolean(String(config.extensionApiKey || '').trim())
    const user = context.user || null
    const localMode = Boolean(user && (user.local_auth || user.auth_source === 'local'))
    const authReady = Boolean(user)

    updatePill(configPill, configReady ? 'Saved' : 'Needs setup', configReady ? 'good' : 'warn')
    updatePill(
      authPill,
      authReady ? (localMode ? 'Local auth' : 'Verified') : apiKeySaved ? 'Needs verify' : 'Missing key',
      authReady ? 'good' : 'warn',
    )
    updatePill(headersPill, headersReady ? 'Headers saved' : 'Headers missing', headersReady ? 'good' : 'warn')

    if (user) {
      authSummary.textContent = `${user.email} · ${user.role}`
      authDetail.textContent = localMode
        ? 'Using local backend auth for development. The extension API key is optional in this setup.'
        : 'Extension key verified. Kings Track recognizes this extension as an authenticated admin.'
    } else if (apiKeySaved) {
      authSummary.textContent = 'Key saved, not verified yet'
      authDetail.textContent = 'Check the API base URL, confirm the key was generated in Kings Track Settings, and make sure the backend can reach /auth/me.'
    } else {
      authSummary.textContent = 'No extension key saved'
      authDetail.textContent = 'Generate a key in Kings Track Settings and paste it here to unlock the sync workflow.'
    }

    setWorkflowHint(configReady, authReady, headersReady, apiKeySaved, localMode)
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

  async function saveConfig(showSavedMessage, customMessage) {
    await browser.runtime.sendMessage({
      type: 'kings.popup.saveConfig',
      config: {
        apiBaseUrl: apiBaseUrl.value,
        extensionApiKey: extensionApiKey.value,
        gradeoApiHeadersJson: gradeoApiHeadersJson.value,
      },
    })
    if (showSavedMessage) {
      showNotice('good', customMessage || 'Settings saved.')
    }
    await refresh()
  }

  document.getElementById('saveConfig').addEventListener('click', async () => {
    try {
      await saveConfig(true, 'Connection settings saved.')
    } catch (error) {
      showNotice('warn', error.message || String(error))
    }
  })

  document.getElementById('saveExtensionKey').addEventListener('click', async () => {
    try {
      await saveConfig(true, 'Extension key saved.')
    } catch (error) {
      showNotice('warn', error.message || String(error))
    }
  })

  document.getElementById('saveApiHeaders').addEventListener('click', async () => {
    try {
      await saveConfig(true, 'Gradeo headers saved.')
    } catch (error) {
      showNotice('warn', error.message || String(error))
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

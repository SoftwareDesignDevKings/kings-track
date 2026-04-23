(function () {
  const homeView = document.getElementById('homeView')
  const settingsView = document.getElementById('settingsView')
  const openSettingsButton = document.getElementById('openSettings')
  const closeSettingsButton = document.getElementById('closeSettings')
  const saveSettingsButton = document.getElementById('saveSettings')

  const apiBaseUrl = document.getElementById('apiBaseUrl')
  const extensionApiKey = document.getElementById('extensionApiKey')
  const gradeoApiHeadersJson = document.getElementById('gradeoApiHeadersJson')
  const homeNote = document.getElementById('homeNote')
  const authDetail = document.getElementById('authDetail')
  const statePill = document.getElementById('statePill')
  const statusHeadline = document.getElementById('statusHeadline')
  const statusSummary = document.getElementById('statusSummary')
  const noticeBanner = document.getElementById('noticeBanner')

  const configSignals = [
    document.getElementById('configPill'),
    document.getElementById('settingsConfigPill'),
  ]
  const authSignals = [
    document.getElementById('authPill'),
    document.getElementById('settingsAuthPill'),
  ]
  const headerSignals = [
    document.getElementById('headersPill'),
    document.getElementById('settingsHeadersPill'),
  ]

  const configInputs = [apiBaseUrl, extensionApiKey, gradeoApiHeadersJson]
  const actionButtonIds = ['syncClasses', 'syncStudents', 'importMappedClasses']

  let noticeTimer = null
  let actionsBusy = false

  function showView(view) {
    homeView.classList.toggle('active', view === 'home')
    settingsView.classList.toggle('active', view === 'settings')
  }

  function setBusy(buttonIds, busy) {
    buttonIds.forEach((id) => {
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
    return configInputs.includes(document.activeElement)
  }

  function titleCaseStatus(status) {
    return String(status || 'idle')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
  }

  function hasSavedHeaders(config) {
    const raw = String(config?.gradeoApiHeadersJson || '').trim()
    return Boolean(raw && raw !== '{}' && raw !== 'null')
  }

  function getTone(status) {
    if (['completed', 'authenticated', 'ready'].includes(status)) {
      return 'good'
    }
    if (['blocked', 'error', 'missing'].includes(status)) {
      return 'warn'
    }
    return ''
  }

  function updateSignal(element, label, tone) {
    if (!element) {
      return
    }
    element.textContent = label
    element.className = tone ? `signal ${tone}` : 'signal'
  }

  function updateSignalGroup(elements, label, tone) {
    elements.forEach((element) => updateSignal(element, label, tone))
  }

  function updateStatusChip(label, tone) {
    statePill.textContent = label
    statePill.className = tone ? `status-chip ${tone}` : 'status-chip'
  }

  function updateActionAvailability(canRunActions) {
    actionButtonIds.forEach((id) => {
      const button = document.getElementById(id)
      if (button) {
        button.disabled = actionsBusy || !canRunActions
      }
    })
  }

  function buildStateSummary(state) {
    const safeState = state || { status: 'idle' }
    const status = safeState.status || 'idle'

    if (status === 'idle') {
      return {
        headline: 'Ready',
        summary: 'No sync running.',
      }
    }

    if (status === 'blocked') {
      return {
        headline: 'Blocked',
        summary: safeState.message || 'Fix setup and try again.',
      }
    }

    if (status === 'error') {
      return {
        headline: 'Failed',
        summary: safeState.message || 'Check settings and retry.',
      }
    }

    if (status === 'scraping_reporting') {
      return {
        headline: 'Collecting reports',
        summary: safeState.progress?.message || 'Working in Gradeo.',
      }
    }

    if (status === 'loading_mappings') {
      return {
        headline: 'Loading mappings',
        summary: 'Preparing import.',
      }
    }

    if (status === 'loading_reporting_classes') {
      return {
        headline: 'Checking classes',
        summary: safeState.totalClasses ? `${safeState.totalClasses} mapped` : 'Checking mapped classes.',
      }
    }

    if (status === 'preflighting_import') {
      return {
        headline: 'Preflight',
        summary: safeState.className
          ? `${safeState.className}${safeState.currentClass && safeState.totalClasses ? ` (${safeState.currentClass}/${safeState.totalClasses})` : ''}`
          : 'Checking next class.',
      }
    }

    if (status === 'importing_class') {
      return {
        headline: 'Loading class',
        summary: safeState.className || 'Fetching class data.',
      }
    }

    if (status === 'importing_student_results') {
      return {
        headline: 'Reading students',
        summary: safeState.studentName
          ? `${safeState.studentName}${safeState.currentStudent && safeState.totalStudents ? ` (${safeState.currentStudent}/${safeState.totalStudents})` : ''}`
          : 'Collecting results.',
      }
    }

    if (status === 'importing_exam_sessions') {
      return {
        headline: 'Resolving exams',
        summary: safeState.examName
          ? `${safeState.examName}${safeState.currentExam && safeState.totalExams ? ` (${safeState.currentExam}/${safeState.totalExams})` : ''}`
          : 'Loading exam sessions.',
      }
    }

    if (status === 'uploading_class') {
      return {
        headline: 'Uploading class',
        summary: safeState.className
          ? `${safeState.className} · ${safeState.students || 0} students`
          : 'Sending class import.',
      }
    }

    if (status === 'syncing_students') {
      if (safeState.phase === 'fetching_directory') {
        return {
          headline: 'Syncing students',
          summary: `${safeState.fetched || 0} fetched`,
        }
      }
      if (safeState.phase === 'uploading_student_directory') {
        return {
          headline: 'Uploading students',
          summary: `${safeState.count || 0} students`,
        }
      }
    }

    if (status === 'syncing_classes') {
      if (safeState.phase === 'fetching_classes') {
        return {
          headline: 'Syncing classes',
          summary: `${safeState.fetched || 0} fetched`,
        }
      }
      if (safeState.phase === 'uploading_school_groups') {
        return {
          headline: 'Uploading classes',
          summary: `${safeState.count || 0} classes`,
        }
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
      return {
        headline: 'Done',
        summary: safeState.action ? titleCaseStatus(safeState.action) : 'Action finished.',
      }
    }

    return {
      headline: titleCaseStatus(status),
      summary: 'Working.',
    }
  }

  function buildHomeNote(configReady, authReady, headersReady, apiKeySaved, localMode, authStatus, backendStatus) {
    if (!configReady) {
      return 'Add the API URL in Settings.'
    }
    if (backendStatus && backendStatus.ok === false) {
      return 'Cannot reach Kings Track.'
    }
    if (!apiKeySaved && !localMode) {
      return 'Add the extension key in Settings.'
    }
    if (authStatus && authStatus.ok === false) {
      return 'API key is not verifying.'
    }
    if (!authReady) {
      return apiKeySaved ? 'Checking API key.' : 'Checking saved credentials.'
    }
    if (!headersReady) {
      return 'Paste fresh Gradeo headers in Settings.'
    }
    return ''
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
    const authStatus = context.authStatus || null
    const backendStatus = context.backendStatus || null
    const localMode = Boolean(user && (user.local_auth || user.auth_source === 'local'))
    const authReady = Boolean(user)

    let kingsTrackTone = 'warn'
    if (configReady && backendStatus && backendStatus.ok) {
      kingsTrackTone = 'good'
    } else if (configReady && !backendStatus) {
      kingsTrackTone = ''
    }

    updateSignalGroup(configSignals, "King's Track", kingsTrackTone)
    let apiKeyTone = 'warn'
    if (configReady && (apiKeySaved || localMode) && authStatus && authStatus.ok) {
      apiKeyTone = 'good'
    } else if (configReady && (apiKeySaved || localMode) && !authStatus) {
      apiKeyTone = ''
    }
    updateSignalGroup(authSignals, 'API Key', apiKeyTone)
    updateSignalGroup(headerSignals, 'Gradeo Headers', headersReady ? 'good' : 'warn')

    if (!configReady && apiKeySaved) {
      authDetail.textContent = 'Key saved. Add the Kings Track URL.'
    } else if (backendStatus && backendStatus.ok === false) {
      authDetail.textContent = 'Kings Track is unreachable.'
    } else if (user) {
      authDetail.textContent = localMode ? 'Using local auth.' : `${user.email} · ${user.role}`
    } else if (authStatus && authStatus.ok === false) {
      authDetail.textContent = 'API key did not verify.'
    } else if (apiKeySaved) {
      authDetail.textContent = 'Key saved. Checking verification.'
    } else {
      authDetail.textContent = 'Not connected.'
    }

    const note = buildHomeNote(configReady, authReady, headersReady, apiKeySaved, localMode, authStatus, backendStatus)
    homeNote.textContent = note
    homeNote.hidden = !note
    updateActionAvailability(configReady && authReady && headersReady)

    const status = context.state?.status || 'idle'
    const summary = buildStateSummary(context.state)
    const tone = getTone(status)

    updateStatusChip(titleCaseStatus(status), tone)
    statusHeadline.textContent = summary.headline
    statusSummary.textContent = summary.summary
  }

  async function refresh() {
    const context = await browser.runtime.sendMessage({ type: 'kings.popup.getContext' })
    renderState(context)
  }

  async function saveConfig(showSavedMessage) {
    await browser.runtime.sendMessage({
      type: 'kings.popup.saveConfig',
      config: {
        apiBaseUrl: apiBaseUrl.value,
        extensionApiKey: extensionApiKey.value,
        gradeoApiHeadersJson: gradeoApiHeadersJson.value,
      },
    })
    if (showSavedMessage) {
      showNotice('good', 'Settings saved.')
    }
    await refresh()
  }

  async function runAction(messageType) {
    actionsBusy = true
    setBusy(actionButtonIds, true)
    try {
      await browser.runtime.sendMessage({ type: messageType })
    } catch (error) {
      showNotice('warn', error.message || String(error))
    } finally {
      actionsBusy = false
      setBusy(actionButtonIds, false)
      await refresh()
    }
  }

  openSettingsButton.addEventListener('click', () => {
    showView('settings')
  })

  closeSettingsButton.addEventListener('click', async () => {
    showView('home')
    await refresh()
  })

  saveSettingsButton.addEventListener('click', async () => {
    try {
      await saveConfig(true)
      showView('home')
    } catch (error) {
      showNotice('warn', error.message || String(error))
    }
  })

  document.getElementById('syncStudents').addEventListener('click', async () => {
    await runAction('kings.popup.syncStudents')
  })

  document.getElementById('syncClasses').addEventListener('click', async () => {
    await runAction('kings.popup.syncClasses')
  })

  document.getElementById('importMappedClasses').addEventListener('click', async () => {
    await runAction('kings.popup.importMappedClasses')
  })

  refresh()
  setInterval(refresh, 1500)
})()

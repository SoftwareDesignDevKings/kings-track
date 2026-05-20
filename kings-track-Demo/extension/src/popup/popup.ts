import { getOptionalElement, getRequiredElement, setButtonsBusy } from './dom'

(function () {
  const homeView = getRequiredElement<HTMLElement>('homeView')
  const settingsView = getRequiredElement<HTMLElement>('settingsView')
  const openSettingsButton = getRequiredElement<HTMLButtonElement>('openSettings')
  const closeSettingsButton = getRequiredElement<HTMLButtonElement>('closeSettings')
  const saveSettingsButton = getRequiredElement<HTMLButtonElement>('saveSettings')
  const openBridgeTabButton = getRequiredElement<HTMLButtonElement>('openBridgeTab')

  const frontendUrl = getRequiredElement<HTMLInputElement>('frontendUrl')
  const gradeoApiHeadersJson = getRequiredElement<HTMLTextAreaElement>('gradeoApiHeadersJson')
  const homeNote = getRequiredElement<HTMLElement>('homeNote')
  const authDetail = getRequiredElement<HTMLElement>('authDetail')
  const statePill = getRequiredElement<HTMLElement>('statePill')
  const statusHeadline = getRequiredElement<HTMLElement>('statusHeadline')
  const statusSummary = getRequiredElement<HTMLElement>('statusSummary')
  const noticeBanner = getRequiredElement<HTMLElement>('noticeBanner')

  const bridgeSignals = [
    getOptionalElement<HTMLElement>('settingsBridgePill'),
  ].filter(Boolean)
  const headerSignals = [
    getOptionalElement<HTMLElement>('settingsHeadersPill'),
  ].filter(Boolean)

  const configInputs: HTMLElement[] = [frontendUrl, gradeoApiHeadersJson]
  const actionButtonIds = ['syncClasses', 'syncStudents', 'importMappedClasses']

  let noticeTimer = null
  let actionsBusy = false

  function showView(view) {
    homeView.classList.toggle('active', view === 'home')
    settingsView.classList.toggle('active', view === 'settings')
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
    return configInputs.includes(document.activeElement as HTMLElement)
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
    if (!element) return
    element.textContent = label
    element.classList.remove('good', 'warn')
    if (tone) {
      element.classList.add(tone)
    }
  }

  function updateSignalGroup(elements, label, tone) {
    elements.forEach((element) => updateSignal(element, label, tone))
  }

  function updateStatusChip(label, tone) {
    statePill.textContent = label
    statePill.classList.remove('good', 'warn')
    if (tone) {
      statePill.classList.add(tone)
    }
  }

  function updateActionAvailability(ready) {
    if (actionsBusy) return
    setButtonsBusy(actionButtonIds, !ready)
  }

  function buildStateSummary(state) {
    if (!state) {
      return { headline: 'Ready', summary: 'No sync running.' }
    }
    const safeState = state || {}
    const status = safeState.status || 'idle'

    if (status === 'idle') {
      return { headline: 'Ready', summary: '' }
    }

    if (status === 'completed') {
      return {
        headline: 'Done',
        summary: safeState.action ? titleCaseStatus(safeState.action) : '',
      }
    }

    if (status === 'error') {
      return {
        headline: 'Error',
        summary: safeState.message || '',
      }
    }

    if (status === 'blocked') {
      return {
        headline: 'Blocked',
        summary: safeState.preflight?.reason || safeState.blocked?.reason || '',
      }
    }

    if (status === 'loading_mappings') {
      return { headline: 'Loading mappings', summary: '' }
    }

    if (status === 'loading_reporting_classes') {
      return {
        headline: 'Checking reporting',
        summary: safeState.totalClasses ? `${safeState.totalClasses} classes` : '',
      }
    }

    if (status === 'preflighting_import') {
      const progress = safeState.currentClass && safeState.totalClasses
        ? ` ${safeState.currentClass}/${safeState.totalClasses}`
        : ''
      return {
        headline: `Preflight${progress}`,
        summary: safeState.className || '',
      }
    }

    if (status === 'importing_class') {
      const progress = safeState.currentClass && safeState.totalClasses
        ? ` ${safeState.currentClass}/${safeState.totalClasses}`
        : ''
      return {
        headline: `Importing class${progress}`,
        summary: safeState.className || '',
      }
    }

    if (status === 'importing_student_results') {
      const classProgress = safeState.currentClass && safeState.totalClasses
        ? ` ${safeState.currentClass}/${safeState.totalClasses}`
        : ''
      const studentProgress = safeState.currentStudent && safeState.totalStudents
        ? `${safeState.currentStudent}/${safeState.totalStudents}`
        : ''
      const summary = [studentProgress, safeState.studentName, safeState.className]
        .filter(Boolean)
        .join(' · ')
      return {
        headline: `Students${classProgress}`,
        summary,
      }
    }

    if (status === 'importing_exam_sessions') {
      const examProgress = safeState.currentExam && safeState.totalExams
        ? ` ${safeState.currentExam}/${safeState.totalExams}`
        : ''
      const summary = [safeState.examName, safeState.className].filter(Boolean).join(' · ')
      return {
        headline: `Exam sessions${examProgress}`,
        summary,
      }
    }

    if (status === 'uploading_class') {
      const progress = safeState.currentClass && safeState.totalClasses
        ? ` ${safeState.currentClass}/${safeState.totalClasses}`
        : ''
      const parts = []
      if (safeState.className) parts.push(safeState.className)
      if (safeState.students != null) parts.push(`${safeState.students} students`)
      return {
        headline: `Uploading${progress}`,
        summary: parts.join(' · '),
      }
    }

    if (status === 'syncing_students') {
      if (safeState.phase === 'fetching_directory') {
        return {
          headline: 'Fetching students',
          summary: `${safeState.fetched || 0} fetched`,
        }
      }
      if (safeState.phase === 'uploading_student_directory') {
        return {
          headline: 'Uploading students',
          summary: `${safeState.count || 0} · ${safeState.pages || 0} pages`,
        }
      }
      return { headline: 'Syncing students', summary: '' }
    }

    if (status === 'syncing_classes') {
      if (safeState.phase === 'fetching_classes') {
        return {
          headline: 'Fetching classes',
          summary: `${safeState.fetched || 0} fetched`,
        }
      }
      if (safeState.phase === 'uploading_school_groups') {
        return {
          headline: 'Uploading classes',
          summary: `${safeState.count || 0} · ${safeState.pages || 0} pages`,
        }
      }
      return { headline: 'Syncing classes', summary: '' }
    }

    return {
      headline: titleCaseStatus(status),
      summary: safeState.phase || '',
    }
  }

  function buildHomeNote(configReady, bridgeOpen, headersReady) {
    if (!configReady) {
      return 'Set the Dashboard URL in Settings.'
    }
    if (!bridgeOpen) {
      return 'Open the Extension Bridge tab and sign in as admin.'
    }
    if (!headersReady) {
      return 'Paste fresh Gradeo headers in Settings.'
    }
    return ''
  }

  function renderState(context) {
    const config = context.config || {}

    if (!isEditingConfig()) {
      frontendUrl.value = config.frontendUrl || ''
      gradeoApiHeadersJson.value = config.gradeoApiHeadersJson || '{}'
    }

    const configReady = Boolean(String(config.frontendUrl || '').trim())
    const headersReady = hasSavedHeaders(config)
    const bridgeOpen = Boolean(context.bridgeTabOpen)

    let bridgeTone = 'warn'
    if (configReady && bridgeOpen) {
      bridgeTone = 'good'
    } else if (!configReady) {
      bridgeTone = 'warn'
    }

    updateSignalGroup(bridgeSignals, bridgeOpen ? 'Bridge tab open' : 'Bridge tab closed', bridgeTone)
    updateSignalGroup(headerSignals, 'Gradeo Headers', headersReady ? 'good' : 'warn')

    if (!configReady) {
      authDetail.textContent = 'Set the Kings Track Dashboard URL.'
    } else if (!bridgeOpen) {
      authDetail.textContent = 'Open the Bridge tab to connect.'
    } else {
      authDetail.textContent = 'Bridge tab is open and listening.'
    }

    const note = buildHomeNote(configReady, bridgeOpen, headersReady)
    homeNote.textContent = note
    homeNote.style.display = note ? '' : 'none'
    updateActionAvailability(configReady && bridgeOpen && headersReady)

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
        frontendUrl: frontendUrl.value,
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
    setButtonsBusy(actionButtonIds, true)
    try {
      await browser.runtime.sendMessage({ type: messageType })
    } catch (error) {
      showNotice('warn', error.message || String(error))
    } finally {
      actionsBusy = false
      setButtonsBusy(actionButtonIds, false)
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

  openBridgeTabButton.addEventListener('click', async () => {
    try {
      await browser.runtime.sendMessage({ type: 'kings.popup.openBridgeTab' })
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

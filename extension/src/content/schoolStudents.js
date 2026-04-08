(function () {
  const ext = self.KingsTrackExtension
  const logDebug = ext.logDebug
    ? (...args) => ext.logDebug(...args)
    : async () => {}
  let knownPageSize = null
  const PAGE_CLICK_SETTLE_MS = 650
  const PAGE_STABLE_POLLS = 4
  const PAGE_STABLE_INTERVAL_MS = 250

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function waitFor(predicate, timeoutMs) {
    const timeoutAt = Date.now() + (timeoutMs || 10000)
    while (Date.now() < timeoutAt) {
      const value = predicate()
      if (value) {
        return value
      }
      await wait(100)
    }
    throw new Error('Timed out waiting for the Gradeo student directory')
  }

  function parseNumber(value) {
    const digits = String(value || '').replace(/[^\d]/g, '')
    return digits ? Number(digits) : null
  }

  function readDisplayedRowsText() {
    return document.querySelector('.MuiTablePagination-displayedRows')?.textContent?.trim() || null
  }

  function parseDisplayedRows(text) {
    if (!text) {
      return null
    }

    const rangeMatch = text.match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)\s+of\s+(\d[\d,]*)/i)
    if (rangeMatch) {
      const start = parseNumber(rangeMatch[1])
      const end = parseNumber(rangeMatch[2])
      const total = parseNumber(rangeMatch[3])
      return {
        start,
        end,
        total,
        windowSize: start && end ? end - start + 1 : null,
      }
    }

    const totalMatch = text.match(/of\s+(\d[\d,]*)/i)
    if (totalMatch) {
      const total = parseNumber(totalMatch[1])
      return {
        start: total === 0 ? 0 : 1,
        end: total === 0 ? 0 : total,
        total,
        windowSize: total,
      }
    }

    return null
  }

  function getCurrentPage() {
    const currentButton = document.querySelector('button[aria-current="true"]')
    const currentText = currentButton?.textContent?.trim()
    const currentPage = Number.parseInt(currentText || '', 10)
    if (Number.isFinite(currentPage) && currentPage > 0) {
      return currentPage
    }

    const pageInfo = parseDisplayedRows(readDisplayedRowsText())
    const pageSize = knownPageSize || pageInfo?.windowSize
    if (pageInfo?.start && pageSize) {
      return Math.floor((pageInfo.start - 1) / pageSize) + 1
    }

    return 1
  }

  function getNextPageButton() {
    return document.querySelector('button[aria-label="Go to next page"]')
  }

  function isDisabled(button) {
    return Boolean(
      !button ||
      button.disabled ||
      button.getAttribute('aria-disabled') === 'true' ||
      button.classList.contains('Mui-disabled')
    )
  }

  function readPageState() {
    const displayedRowsText = readDisplayedRowsText()
    const pageInfo = parseDisplayedRows(displayedRowsText)
    const students = ext.extractStudentDirectoryFromDocument(document)
    if (pageInfo?.windowSize) {
      knownPageSize = Math.max(knownPageSize || 0, pageInfo.windowSize)
    }
    const currentPage = getCurrentPage()
    const nextButton = getNextPageButton()
    const pageSize = knownPageSize || pageInfo?.windowSize || students.length || null
    const totalPages = pageInfo?.total && pageSize
      ? Math.max(1, Math.ceil(pageInfo.total / pageSize))
      : null

    return {
      url: window.location.href,
      students,
      displayedRowsText,
      pageInfo,
      pageSize,
      currentPage,
      totalPages,
      nextDisabled: isDisabled(nextButton),
      signature: [
        currentPage,
        displayedRowsText || '',
        students[0]?.gradeo_student_id || '',
        students.length,
      ].join('|'),
    }
  }

  async function waitForDirectoryReady() {
    await waitFor(() => (
      document.querySelector('.MuiTablePagination-displayedRows') ||
      document.querySelector('tbody tr')
    ), 15000)

    return waitFor(() => {
      const state = readPageState()
      if (state.students.length > 0) {
        return state
      }
      if (state.pageInfo && state.pageInfo.total === 0) {
        return state
      }
      return null
    }, 15000)
  }

  async function waitForPageChange(previousState) {
    await waitFor(() => {
      const state = readPageState()
      return state.signature !== previousState.signature ? state : null
    }, 15000)

    await wait(PAGE_CLICK_SETTLE_MS)

    let stableState = null
    let stableCount = 0
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = readPageState()
      if (
        stableState &&
        stableState.signature === state.signature
      ) {
        stableCount += 1
      } else {
        stableCount = 1
      }

      if (
        (state.students.length > 0 || state.pageInfo?.total === 0)
      ) {
        if (stableCount >= PAGE_STABLE_POLLS) {
          return state
        }
      }
      stableState = state
      await wait(PAGE_STABLE_INTERVAL_MS)
    }

    return readPageState()
  }

  async function captureDebugSnapshot(reason, state) {
    if (!ext.sendDebugSnapshot) {
      return
    }

    await ext.sendDebugSnapshot({
      scope: 'schoolStudents',
      reason,
      url: window.location.href,
      page: state?.currentPage || null,
      displayed_rows: state?.displayedRowsText || null,
      diagnostics: ext.inspectStudentDirectoryDocument(document),
      html: document.documentElement.outerHTML,
    })
  }

  async function scrapeCurrentPage() {
    const state = await waitForDirectoryReady()

    await logDebug('schoolStudents', 'directory_page_scraped', {
      page: state.currentPage,
      count: state.students.length,
      displayedRows: state.displayedRowsText,
      totalPages: state.totalPages,
      totalRows: state.pageInfo?.total || null,
      url: state.url,
    })

    if (state.students.length === 0) {
      await logDebug('schoolStudents', 'directory_page_empty', {
        page: state.currentPage,
        displayedRows: state.displayedRowsText,
        diagnostics: ext.inspectStudentDirectoryDocument(document),
      })
      await captureDebugSnapshot('empty-page', state)
    }

    return {
      page: state.currentPage,
      perPage: state.pageSize || state.students.length || 50,
      totalPages: state.totalPages,
      displayedRows: state.displayedRowsText,
      url: state.url,
      students: state.students,
    }
  }

  async function scrapeStudentDirectory() {
    const seen = new Set()
    const students = []
    const pageDiagnostics = []
    const visitedSignatures = new Set()

    let state = await waitForDirectoryReady()

    for (let guard = 0; guard < 100; guard += 1) {
      const pageKey = `${state.currentPage}:${state.signature}`
      if (visitedSignatures.has(pageKey)) {
        await logDebug('schoolStudents', 'pagination_repeat_detected', {
          page: state.currentPage,
          displayedRows: state.displayedRowsText,
          url: state.url,
        })
        break
      }
      visitedSignatures.add(pageKey)

      pageDiagnostics.push({
        page: state.currentPage,
        count: state.students.length,
        displayedRows: state.displayedRowsText,
        url: state.url,
      })

      await logDebug('schoolStudents', 'directory_page_scraped', {
        page: state.currentPage,
        count: state.students.length,
        displayedRows: state.displayedRowsText,
        totalPages: state.totalPages,
        totalRows: state.pageInfo?.total || null,
        url: state.url,
      })

      state.students.forEach(student => {
        if (!seen.has(student.gradeo_student_id)) {
          seen.add(student.gradeo_student_id)
          students.push(student)
        }
      })

      if (
        state.students.length === 0 ||
        state.nextDisabled ||
        (state.totalPages && state.currentPage >= state.totalPages)
      ) {
        break
      }

      const nextButton = getNextPageButton()
      if (isDisabled(nextButton)) {
        break
      }

      await logDebug('schoolStudents', 'pagination_click_next', {
        currentPage: state.currentPage,
        displayedRows: state.displayedRowsText,
        pageSize: state.pageSize,
      })

      nextButton.scrollIntoView({ block: 'center', inline: 'center' })
      nextButton.click()
      state = await waitForPageChange(state)
    }

    await logDebug('schoolStudents', 'directory_scraped', {
      count: students.length,
      pages: pageDiagnostics,
      totalPages: pageDiagnostics.length,
      url: window.location.href,
    })

    if (students.length === 0) {
      await captureDebugSnapshot('empty-directory', readPageState())
    }

    return {
      page: window.location.href,
      students,
      pageDiagnostics,
    }
  }

  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'kings.gradeo.scrapeStudentDirectoryPage') {
      return scrapeCurrentPage()
    }

    if (message?.type === 'kings.gradeo.scrapeStudentDirectory') {
      return scrapeStudentDirectory()
    }

    return undefined
  })
})()

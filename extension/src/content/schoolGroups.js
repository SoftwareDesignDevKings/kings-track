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

  function sanitizeApiHeaders(headers) {
    const blockedHeaders = new Set([
      'accept-encoding',
      'connection',
      'content-length',
      'cookie',
      'host',
      'origin',
      'referer',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'te',
      'user-agent',
    ])

    return Object.fromEntries(
      Object.entries(headers || {})
        .map(([key, value]) => [String(key || '').trim(), value])
        .filter(([key, value]) => key && value != null && String(value).trim() !== '')
        .filter(([key]) => !blockedHeaders.has(key.toLowerCase()))
    )
  }

  function parseRawHeaderBlock(raw) {
    const headers = {}
    String(raw || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        if (index === 0 && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i.test(line)) {
          return
        }
        const separatorIndex = line.indexOf(':')
        if (separatorIndex <= 0) {
          return
        }
        const key = line.slice(0, separatorIndex).trim()
        const value = line.slice(separatorIndex + 1).trim()
        if (key && value) {
          headers[key] = value
        }
      })
    return headers
  }

  async function getConfiguredApiHeaders() {
    const config = await ext.getConfig()
    const raw = String(config?.gradeoApiHeadersJson || '{}').trim() || '{}'

    let parsed = {}
    if (raw.startsWith('{')) {
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        await logDebug('schoolGroups', 'api_headers_invalid_json', {
          error: String(error),
        })
        throw new Error('Gradeo API headers are invalid. Paste a valid JSON object or raw copied headers in the API tab.')
      }
    } else {
      parsed = parseRawHeaderBlock(raw)
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Gradeo API headers must be a JSON object or raw copied headers.')
    }

    const headers = sanitizeApiHeaders(parsed)
    await logDebug('schoolGroups', 'api_headers_loaded', {
      keys: Object.keys(headers),
    })
    return headers
  }

  function mapApiClass(item) {
    const syllabuses = Array.isArray(item?.syllabuses) ? item.syllabuses : []
    return {
      gradeo_class_id: String(item?.id || '').trim(),
      name: String(item?.name || '').trim(),
      syllabus_title: syllabuses
        .map(syllabus => String(syllabus?.title || '').trim())
        .filter(Boolean)
        .join(', ') || null,
      teacher_count: Number.isFinite(item?.teacherCount) ? item.teacherCount : parseNumber(item?.teacherCount),
      student_count: Number.isFinite(item?.studentCount) ? item.studentCount : parseNumber(item?.studentCount),
    }
  }

  function getSchoolGroupsApiUrl() {
    const entries = performance.getEntriesByType('resource')
    const match = [...entries]
      .reverse()
      .find(entry => /\/api\/student-group\/v2\/[^/]+\/by-school/i.test(entry.name))

    if (!match?.name) {
      return null
    }

    return new URL(match.name)
  }

  async function fetchSchoolGroupsViaApi() {
    const discoveredUrl = getSchoolGroupsApiUrl()
    if (!discoveredUrl) {
      await logDebug('schoolGroups', 'api_endpoint_missing', {
        url: window.location.href,
      })
      throw new Error('Could not discover the Gradeo classes API URL from the page')
    }

    await logDebug('schoolGroups', 'api_endpoint_discovered', {
      endpoint: discoveredUrl.toString(),
    })

    const configuredHeaders = await getConfiguredApiHeaders()

    const limit = 100
    const total = []
    const pageDiagnostics = []
    let offset = 0
    let totalRows = null

    while (offset === 0 || (totalRows != null && offset < totalRows)) {
      const pageUrl = new URL(discoveredUrl.toString())
      pageUrl.searchParams.set('limit', String(limit))
      pageUrl.searchParams.set('offset', String(offset))
      if (!pageUrl.searchParams.has('studentGroupName')) {
        pageUrl.searchParams.set('studentGroupName', '')
      }

      const response = await fetch(pageUrl.toString(), {
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...configuredHeaders,
        },
      })

      if (!response.ok) {
        throw new Error(`Gradeo classes API returned ${response.status}`)
      }

      const payload = await response.json()
      const rows = Array.isArray(payload?.list) ? payload.list : []
      totalRows = parseNumber(payload?.pgn?.total) || rows.length
      const mappedRows = rows
        .map(mapApiClass)
        .filter(gradeoClass => gradeoClass.gradeo_class_id && gradeoClass.name)

      pageDiagnostics.push({
        page: Math.floor(offset / limit) + 1,
        count: mappedRows.length,
        totalRows,
        offset,
        limit,
        url: pageUrl.toString(),
      })

      await logDebug('schoolGroups', 'api_page_fetched', {
        page: Math.floor(offset / limit) + 1,
        count: mappedRows.length,
        totalRows,
        offset,
        limit,
        url: pageUrl.toString(),
      })

      total.push(...mappedRows)

      if (rows.length === 0 || total.length >= totalRows) {
        break
      }

      offset += rows.length
    }

    const deduped = []
    const seen = new Set()
    total.forEach(gradeoClass => {
      if (!seen.has(gradeoClass.gradeo_class_id)) {
        seen.add(gradeoClass.gradeo_class_id)
        deduped.push(gradeoClass)
      }
    })

    await logDebug('schoolGroups', 'api_directory_fetched', {
      count: deduped.length,
      pages: pageDiagnostics,
      endpoint: discoveredUrl.toString(),
    })

    return {
      page: window.location.href,
      classes: deduped,
      pageDiagnostics,
      source: 'api',
    }
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
    throw new Error('Timed out waiting for the Gradeo classes directory')
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
    const classes = ext.extractSchoolGroupsFromDocument(document)
    if (pageInfo?.windowSize) {
      knownPageSize = Math.max(knownPageSize || 0, pageInfo.windowSize)
    }
    const currentPage = getCurrentPage()
    const nextButton = getNextPageButton()
    const pageSize = knownPageSize || pageInfo?.windowSize || classes.length || null
    const totalPages = pageInfo?.total && pageSize
      ? Math.max(1, Math.ceil(pageInfo.total / pageSize))
      : null

    return {
      url: window.location.href,
      classes,
      displayedRowsText,
      pageInfo,
      pageSize,
      currentPage,
      totalPages,
      nextDisabled: isDisabled(nextButton),
      signature: [
        currentPage,
        displayedRowsText || '',
        classes[0]?.gradeo_class_id || '',
        classes.length,
      ].join('|'),
    }
  }

  async function waitForSchoolGroupsReady() {
    await waitFor(() => (
      document.querySelector('.MuiTablePagination-displayedRows') ||
      document.querySelector('tbody tr')
    ), 15000)

    return waitFor(() => {
      const state = readPageState()
      if (state.classes.length > 0) {
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
      if (stableState && stableState.signature === state.signature) {
        stableCount += 1
      } else {
        stableCount = 1
      }

      if (state.classes.length > 0 || state.pageInfo?.total === 0) {
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
      scope: 'schoolGroups',
      reason,
      url: window.location.href,
      page: state?.currentPage || null,
      displayed_rows: state?.displayedRowsText || null,
      diagnostics: ext.inspectSchoolGroupsDocument(document),
      html: document.documentElement.outerHTML,
    })
  }

  async function scrapeSchoolGroups() {
    const seen = new Set()
    const classes = []
    const pageDiagnostics = []
    const visitedSignatures = new Set()

    let state = await waitForSchoolGroupsReady()

    for (let guard = 0; guard < 100; guard += 1) {
      const pageKey = `${state.currentPage}:${state.signature}`
      if (visitedSignatures.has(pageKey)) {
        await logDebug('schoolGroups', 'pagination_repeat_detected', {
          page: state.currentPage,
          displayedRows: state.displayedRowsText,
          url: state.url,
        })
        break
      }
      visitedSignatures.add(pageKey)

      pageDiagnostics.push({
        page: state.currentPage,
        count: state.classes.length,
        displayedRows: state.displayedRowsText,
        url: state.url,
      })

      await logDebug('schoolGroups', 'directory_page_scraped', {
        page: state.currentPage,
        count: state.classes.length,
        displayedRows: state.displayedRowsText,
        totalPages: state.totalPages,
        totalRows: state.pageInfo?.total || null,
        url: state.url,
      })

      state.classes.forEach(gradeoClass => {
        if (!seen.has(gradeoClass.gradeo_class_id)) {
          seen.add(gradeoClass.gradeo_class_id)
          classes.push(gradeoClass)
        }
      })

      if (
        state.classes.length === 0 ||
        state.nextDisabled ||
        (state.totalPages && state.currentPage >= state.totalPages)
      ) {
        break
      }

      const nextButton = getNextPageButton()
      if (isDisabled(nextButton)) {
        break
      }

      await logDebug('schoolGroups', 'pagination_click_next', {
        currentPage: state.currentPage,
        displayedRows: state.displayedRowsText,
        pageSize: state.pageSize,
      })

      nextButton.scrollIntoView({ block: 'center', inline: 'center' })
      nextButton.click()
      state = await waitForPageChange(state)
    }

    await logDebug('schoolGroups', 'directory_scraped', {
      count: classes.length,
      pages: pageDiagnostics,
      totalPages: pageDiagnostics.length,
      url: window.location.href,
    })

    if (classes.length === 0) {
      await captureDebugSnapshot('empty-directory', readPageState())
    }

    return {
      page: window.location.href,
      classes,
      pageDiagnostics,
      source: 'dom',
    }
  }

  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'kings.gradeo.fetchSchoolGroupsApi') {
      return fetchSchoolGroupsViaApi()
    }

    if (message?.type === 'kings.gradeo.scrapeSchoolGroups') {
      return scrapeSchoolGroups()
    }

    return undefined
  })
})()

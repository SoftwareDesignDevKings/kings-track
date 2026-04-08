(function () {
  const ext = self.KingsTrackExtension
  const STATE_KEY = 'kingsTrackSyncState'
  const EXTENSION_VERSION = '0.1.0'
  const GRADEO_BASE_URL = 'https://platform.gradeo.com.au'

  async function setState(state) {
    await browser.storage.local.set({ [STATE_KEY]: state })
    return state
  }

  async function getState() {
    const result = await browser.storage.local.get(STATE_KEY)
    return result[STATE_KEY] || { status: 'idle' }
  }

  async function getActiveGradeoTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (!tab?.id || !tab.url?.includes('platform.gradeo.com.au')) {
      await ext.logDebug('background', 'active_tab_missing', { url: tab?.url || null })
      throw new Error('Open a Gradeo tab before running the importer.')
    }
    await ext.logDebug('background', 'active_gradeo_tab', { tabId: tab.id, url: tab.url })
    return tab
  }

  async function waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        browser.tabs.onUpdated.removeListener(handleUpdate)
        reject(new Error('Timed out waiting for the Gradeo tab to finish loading'))
      }, 20000)

      function handleUpdate(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId) {
          return
        }
        if (changeInfo.status === 'complete') {
          clearTimeout(timeout)
          browser.tabs.onUpdated.removeListener(handleUpdate)
          resolve()
        }
      }

      browser.tabs.onUpdated.addListener(handleUpdate)
    })
  }

  async function prepareStudentDirectoryTab(tab) {
    const url = new URL(tab.url)
    let changed = false

    if (url.pathname !== '/admin/schoolStudents') {
      return tab
    }

    if (url.searchParams.get('perPage') !== '50') {
      url.searchParams.set('perPage', '50')
      changed = true
    }
    if (url.searchParams.get('page') !== '1') {
      url.searchParams.set('page', '1')
      changed = true
    }
    if (!url.searchParams.get('order')) {
      url.searchParams.set('order', 'ASC')
      changed = true
    }
    if (!url.searchParams.get('sort')) {
      url.searchParams.set('sort', 'id')
      changed = true
    }

    if (!changed) {
      return tab
    }

    await ext.logDebug('background', 'student_directory_prepare_tab', {
      fromUrl: tab.url,
      toUrl: url.toString(),
    })

    await browser.tabs.update(tab.id, { url: url.toString() })
    await waitForTabLoad(tab.id)
    const [updatedTab] = await browser.tabs.query({ active: true, currentWindow: true })
    return updatedTab || tab
  }

  async function prepareSchoolGroupsTab(tab) {
    const url = new URL(tab.url)
    let changed = false

    if (url.pathname !== '/admin/schoolGroups') {
      url.pathname = '/admin/schoolGroups'
      url.search = ''
      changed = true
    }

    if (url.searchParams.get('perPage') !== '50') {
      url.searchParams.set('perPage', '50')
      changed = true
    }
    if (url.searchParams.get('page') !== '1') {
      url.searchParams.set('page', '1')
      changed = true
    }
    if (!url.searchParams.get('order')) {
      url.searchParams.set('order', 'ASC')
      changed = true
    }
    if (!url.searchParams.get('sort')) {
      url.searchParams.set('sort', 'id')
      changed = true
    }

    if (!changed) {
      return tab
    }

    await ext.logDebug('background', 'school_groups_prepare_tab', {
      fromUrl: tab.url,
      toUrl: url.toString(),
    })

    await browser.tabs.update(tab.id, { url: url.toString() })
    await waitForTabLoad(tab.id)
    const [updatedTab] = await browser.tabs.query({ active: true, currentWindow: true })
    return updatedTab || tab
  }

  async function scrapeStudentDirectory(tabId, retries) {
    let lastError = null
    for (let attempt = 0; attempt < (retries || 10); attempt += 1) {
      try {
        return await browser.tabs.sendMessage(tabId, {
          type: 'kings.gradeo.scrapeStudentDirectory',
        })
      } catch (error) {
        lastError = error
        await ext.logDebug('background', 'student_directory_retry', {
          tabId,
          attempt: attempt + 1,
          error: String(error),
        })
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    throw lastError || new Error('Failed to scrape the Gradeo student directory')
  }

  async function scrapeSchoolGroups(tabId, retries) {
    let lastError = null
    for (let attempt = 0; attempt < (retries || 10); attempt += 1) {
      try {
        return await browser.tabs.sendMessage(tabId, {
          type: 'kings.gradeo.scrapeSchoolGroups',
        })
      } catch (error) {
        lastError = error
        await ext.logDebug('background', 'school_groups_retry', {
          tabId,
          attempt: attempt + 1,
          error: String(error),
        })
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    throw lastError || new Error('Failed to scrape the Gradeo classes directory')
  }

  async function fetchSchoolGroupsViaApi(tabId, retries) {
    let lastError = null
    for (let attempt = 0; attempt < (retries || 10); attempt += 1) {
      try {
        return await browser.tabs.sendMessage(tabId, {
          type: 'kings.gradeo.fetchSchoolGroupsApi',
        })
      } catch (error) {
        lastError = error
        await ext.logDebug('background', 'school_groups_api_retry', {
          tabId,
          attempt: attempt + 1,
          error: String(error),
        })
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    throw lastError || new Error('Failed to fetch the Gradeo classes directory API')
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
    let requestLine = null
    String(raw || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        if (index === 0 && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i.test(line)) {
          requestLine = line
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
    return { headers, requestLine }
  }

  function readCookieValue(cookieHeader, key) {
    if (!cookieHeader) {
      return null
    }
    const match = String(cookieHeader).match(new RegExp(`${key}=([^;]+)`))
    return match ? decodeURIComponent(match[1]) : null
  }

  function extractSchoolIdFromRaw(rawText, parsedHeaders, requestLine) {
    const fromCookie = readCookieValue(
      parsedHeaders.Cookie || parsedHeaders.cookie || '',
      'admin_user_schoolId',
    )
    if (fromCookie) {
      return fromCookie
    }

    const searchText = [requestLine, rawText, parsedHeaders['X-School-Id'], parsedHeaders['x-school-id']]
      .filter(Boolean)
      .join('\n')
    const routeMatch = searchText.match(/\/api\/(?:student-group\/v2|school\/v2\/list\/student)\/([0-9a-f-]{36})/i)
    return routeMatch ? routeMatch[1] : null
  }

  async function getGradeoApiContext() {
    const config = await ext.getConfig()
    const raw = String(config?.gradeoApiHeadersJson || '{}').trim() || '{}'

    let parsedHeaders = {}
    let requestLine = null
    if (raw.startsWith('{')) {
      try {
        parsedHeaders = JSON.parse(raw)
      } catch (error) {
        throw new Error('Gradeo API headers are invalid JSON. Paste a valid JSON object or raw copied headers block.')
      }
    } else {
      const parsed = parseRawHeaderBlock(raw)
      parsedHeaders = parsed.headers
      requestLine = parsed.requestLine
    }

    if (!parsedHeaders || typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
      throw new Error('Gradeo API headers must be a JSON object or raw copied headers.')
    }

    const headers = sanitizeApiHeaders(parsedHeaders)
    const authorizationHeader = Object.keys(headers).find(key => key.toLowerCase() === 'authorization')
    if (!authorizationHeader || !String(headers[authorizationHeader]).trim()) {
      throw new Error('Gradeo API headers are missing Authorization. Save a fresh copied request from Gradeo first.')
    }

    const schoolId = extractSchoolIdFromRaw(raw, parsedHeaders, requestLine)

    await ext.logDebug('background', 'gradeo_api_context_loaded', {
      schoolId,
      keys: Object.keys(headers),
    })

    return {
      headers,
      schoolId,
      baseUrl: GRADEO_BASE_URL,
    }
  }

  async function gradeoFetchJson(ctx, path, scope) {
    const url = path.startsWith('http') ? path : `${ctx.baseUrl}${path}`
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...ctx.headers,
      },
    })

    if (response.status === 401) {
      throw new Error('Gradeo API returned 401. Refresh the saved Gradeo headers and make sure you are still signed in to Gradeo.')
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      await ext.logDebug('background', 'gradeo_api_request_failed', {
        scope: scope || 'gradeo',
        status: response.status,
        url,
        body: body.slice(0, 300),
      })
      throw new Error(`Gradeo API ${response.status} for ${path}`)
    }

    return response.json()
  }

  function mapApiClass(item) {
    const syllabuses = Array.isArray(item?.syllabuses) ? item.syllabuses : []
    const parseNumber = value => {
      const digits = String(value || '').replace(/[^\d.-]/g, '')
      if (!digits || digits === '-' || digits === '.' || digits === '-.') {
        return null
      }
      const number = Number(digits)
      return Number.isFinite(number) ? number : null
    }

    return {
      gradeo_class_id: String(item?.id || '').trim(),
      name: String(item?.name || '').trim(),
      syllabuses,
      syllabus_title: syllabuses
        .map(syllabus => String(syllabus?.title || '').trim())
        .filter(Boolean)
        .join(', ') || null,
      teacher_count: parseNumber(item?.teacherCount),
      student_count: parseNumber(item?.studentCount),
    }
  }

  function buildStudentName(item) {
    return [item?.firstName, item?.lastName]
      .map(part => String(part || '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function mapApiStudent(item) {
    return {
      gradeo_student_id: String(item?.id || '').trim(),
      name: buildStudentName(item),
      email: String(item?.email || '').trim().toLowerCase(),
    }
  }

  function deriveExamStatus(row) {
    if (!row?.examAnswerSheetId) {
      return 'not_submitted'
    }
    if (row?.studentMarkTotal == null) {
      return 'awaiting_marking'
    }
    return 'scored'
  }

  function parseOptionalNumber(value) {
    if (value == null || value === '') {
      return null
    }
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function normalizeExamSummaryRow(item, className) {
    const examName = String(item?.examTitle || '').trim()
    const examSessionId = String(item?.examSessionId || '').trim()
    const markingSessionId = item?.markingSessionId ? String(item.markingSessionId).trim() : ''
    if (!examName || !examSessionId) {
      return null
    }

    return {
      exam_name: examName,
      gradeo_exam_id: String(item?.examId || '').trim() || examSessionId,
      gradeo_exam_session_id: examSessionId,
      gradeo_marking_session_id: markingSessionId || null,
      gradeo_class_id: null,
      class_name: className || null,
      class_average: parseOptionalNumber(item?.studentGroupMarkAverage),
      exam_mark: parseOptionalNumber(item?.studentMarkTotal),
      marks_available: parseOptionalNumber(item?.examPointsTotal),
      status: deriveExamStatus(item),
      answer_submitted: Boolean(item?.examAnswerSheetId),
      marking_session_id: markingSessionId || null,
      exam_answer_sheet_id: item?.examAnswerSheetId ? String(item.examAnswerSheetId) : null,
      exam_session_start_date: item?.examSessionStartDate || null,
      exam_session_max_time_seconds: parseOptionalNumber(item?.examSessionMaxTimeSeconds),
      student_group_mark_average: parseOptionalNumber(item?.studentGroupMarkAverage),
      syllabus_id: null,
      syllabus_title: null,
      syllabus_grade: null,
      bands: [],
      outcomes: [],
      topics: [],
    }
  }

  async function ensureAdmin() {
    const user = await ext.getCurrentUser()
    if (!user || user.role !== 'admin') {
      await ext.logDebug('background', 'admin_check_failed', { user: user || null })
      throw new Error('Your Kings Track account must have admin access to use this extension.')
    }
    await ext.logDebug('background', 'admin_check_passed', { email: user.email, role: user.role })
    return user
  }

  async function syncStudentsApi() {
    const user = await ensureAdmin()
    const ctx = await getGradeoApiContext()
    if (!ctx.schoolId) {
      throw new Error('Could not determine the Gradeo school ID from the saved headers. Paste a copied Classes or Students request that includes the school context.')
    }

    const limit = 100
    let offset = 0
    let totalRows = null
    const students = []
    const diagnostics = []

    while (offset === 0 || (totalRows != null && offset < totalRows)) {
      await setState({
        status: 'syncing_students',
        phase: 'fetching_directory',
        fetched: students.length,
        offset,
        limit,
      })

      const payload = await gradeoFetchJson(
        ctx,
        `/api/school/v2/list/student/${ctx.schoolId}?limit=${limit}&offset=${offset}&searchTerm=`,
        'students',
      )
      const rows = Array.isArray(payload?.list) ? payload.list : []
      totalRows = parseOptionalNumber(payload?.pgn?.total) || rows.length
      const mapped = rows
        .map(mapApiStudent)
        .filter(student => student.gradeo_student_id && student.name && student.email)

      diagnostics.push({
        page: Math.floor(offset / limit) + 1,
        count: mapped.length,
        totalRows,
        offset,
      })
      students.push(...mapped)

      await ext.logDebug('background', 'gradeo_students_page_fetched', {
        page: Math.floor(offset / limit) + 1,
        count: mapped.length,
        totalRows,
        offset,
      })

      if (rows.length === 0 || students.length >= totalRows) {
        break
      }
      offset += rows.length
    }

    const deduped = []
    const seen = new Set()
    students.forEach(student => {
      if (!seen.has(student.gradeo_student_id)) {
        seen.add(student.gradeo_student_id)
        deduped.push(student)
      }
    })

    await setState({
      status: 'syncing_students',
      phase: 'uploading_student_directory',
      count: deduped.length,
      pages: diagnostics.length,
    })
    const result = await ext.fetchApi('/admin/gradeo/student-directory', {
      method: 'POST',
      body: JSON.stringify({
        extension_version: EXTENSION_VERSION,
        students: deduped,
      }),
    })

    await ext.logDebug('background', 'student_directory_uploaded', {
      count: deduped.length,
      result,
    })
    await setState({ status: 'completed', action: 'student_directory', result, user: user.email })
    return result
  }

  async function syncClassesApi() {
    const user = await ensureAdmin()
    const ctx = await getGradeoApiContext()
    if (!ctx.schoolId) {
      throw new Error('Could not determine the Gradeo school ID from the saved headers. Paste a copied Classes or Students request that includes the school context.')
    }

    const limit = 100
    let offset = 0
    let totalRows = null
    const classes = []
    const diagnostics = []

    while (offset === 0 || (totalRows != null && offset < totalRows)) {
      await setState({
        status: 'syncing_classes',
        phase: 'fetching_classes',
        fetched: classes.length,
        offset,
        limit,
      })

      const payload = await gradeoFetchJson(
        ctx,
        `/api/student-group/v2/${ctx.schoolId}/by-school?limit=${limit}&studentGroupName=&offset=${offset}`,
        'classes',
      )
      const rows = Array.isArray(payload?.list) ? payload.list : []
      totalRows = parseOptionalNumber(payload?.pgn?.total) || rows.length
      const mapped = rows
        .map(mapApiClass)
        .filter(gradeoClass => gradeoClass.gradeo_class_id && gradeoClass.name)

      diagnostics.push({
        page: Math.floor(offset / limit) + 1,
        count: mapped.length,
        totalRows,
        offset,
      })
      classes.push(...mapped)

      await ext.logDebug('background', 'gradeo_classes_page_fetched', {
        page: Math.floor(offset / limit) + 1,
        count: mapped.length,
        totalRows,
        offset,
      })

      if (rows.length === 0 || classes.length >= totalRows) {
        break
      }
      offset += rows.length
    }

    const deduped = []
    const seen = new Set()
    classes.forEach(gradeoClass => {
      if (!seen.has(gradeoClass.gradeo_class_id)) {
        seen.add(gradeoClass.gradeo_class_id)
        deduped.push(gradeoClass)
      }
    })

    await setState({
      status: 'syncing_classes',
      phase: 'uploading_school_groups',
      count: deduped.length,
      pages: diagnostics.length,
      source: 'api',
    })
    const result = await ext.fetchApi('/admin/gradeo/classes', {
      method: 'POST',
      body: JSON.stringify({
        extension_version: EXTENSION_VERSION,
        classes: deduped,
      }),
    })

    await ext.logDebug('background', 'school_groups_uploaded', {
      count: deduped.length,
      result,
      source: 'api',
    })
    await setState({
      status: 'completed',
      action: 'class_discovery',
      source: 'api',
      result,
      user: user.email,
    })
    return result
  }

  async function fetchReportingClasses(ctx) {
    const payload = await gradeoFetchJson(
      ctx,
      '/api/student-group/temp/group-and-high-stake-exams-all',
      'reporting_classes',
    )
    const rows = Array.isArray(payload) ? payload : []
    return rows
      .map(item => ({
        id: String(item?.studentGroup?.id || '').trim(),
        name: String(item?.studentGroup?.name || '').trim(),
      }))
      .filter(item => item.id && item.name)
  }

  async function fetchClassDetails(ctx, classId) {
    const payload = await gradeoFetchJson(ctx, `/api/student-group/${classId}`, 'class_roster')
    const users = Array.isArray(payload?.users) ? payload.users : []
    const syllabuses = Array.isArray(payload?.syllabuses) ? payload.syllabuses : []
    const students = users
      .map(user => ({
        id: String(user?.id || '').trim(),
        name: buildStudentName(user),
      }))
      .filter(user => user.id && user.name)

    return {
      id: String(payload?.id || classId || '').trim(),
      name: String(payload?.name || '').trim() || null,
      students,
      syllabusIds: syllabuses
        .map(syllabus => String(syllabus?.id || '').trim())
        .filter(Boolean),
      syllabusTitlesById: Object.fromEntries(
        syllabuses
          .map(syllabus => [
            String(syllabus?.id || '').trim(),
            String(syllabus?.title || '').trim(),
          ])
          .filter(([id, title]) => id && title)
      ),
    }
  }

  function firstDefinedValue(values) {
    for (const value of values) {
      if (value != null) {
        return value
      }
    }
    return null
  }

  async function fetchStudentExamCandidates(ctx, classId, className, student) {
    const limit = 100
    let offset = 0
    let totalRows = null
    const rows = []

    while (offset === 0 || (totalRows != null && offset < totalRows)) {
      const payload = await gradeoFetchJson(
        ctx,
        `/api/statistics-student/teacher/exam-session-result?limit=${limit}&offset=${offset}&studentId=${encodeURIComponent(student.id)}&groupId=${encodeURIComponent(classId)}`,
        'student_results',
      )
      const pageRows = Array.isArray(payload?.list) ? payload.list : []
      totalRows = parseOptionalNumber(payload?.pgn?.total) || pageRows.length

      rows.push(...pageRows)

      await ext.logDebug('background', 'gradeo_student_results_page_fetched', {
        classId,
        className,
        studentId: student.id,
        studentName: student.name,
        page: Math.floor(offset / limit) + 1,
        count: pageRows.length,
        totalRows,
        offset,
      })

      if (pageRows.length === 0 || rows.length >= totalRows) {
        break
      }
      offset += pageRows.length
    }

    const candidates = []
    const seen = new Set()
    rows.forEach(item => {
      const markingSessionId = String(item?.markingSessionId || '').trim()
      const examSessionId = String(item?.examSessionId || '').trim()
      const dedupeKey = markingSessionId || examSessionId
      if (!dedupeKey || seen.has(dedupeKey)) {
        return
      }
      seen.add(dedupeKey)
      candidates.push({
        studentId: student.id,
        studentName: student.name,
        classId,
        className,
        markingSessionId: markingSessionId || null,
        examSessionId: examSessionId || null,
        examTitle: String(item?.examTitle || '').trim() || null,
        examMark: parseOptionalNumber(item?.studentMarkTotal),
        marksAvailable: parseOptionalNumber(item?.examPointsTotal),
        classAverage: parseOptionalNumber(item?.studentGroupMarkAverage),
        examAnswerSheetId: item?.examAnswerSheetId ? String(item.examAnswerSheetId) : null,
        examSessionStartDate: item?.examSessionStartDate || null,
        examSessionMaxTimeSeconds: parseOptionalNumber(item?.examSessionMaxTimeSeconds),
        studentGroupMarkAverage: parseOptionalNumber(item?.studentGroupMarkAverage),
        rawStatus: deriveExamStatus(item),
      })
    })

    return candidates
  }

  async function fetchMarkingSessionAggregate(ctx, markingSessionId) {
    return gradeoFetchJson(
      ctx,
      `/api/exam-process/aggregated/state/marking/${encodeURIComponent(markingSessionId)}`,
      'marking_session_aggregate',
    )
  }

  async function fetchMarkingStudentStates(ctx, markingSessionId) {
    const payload = await gradeoFetchJson(
      ctx,
      `/api/exam-process/aggregated/state/marking/student/${encodeURIComponent(markingSessionId)}`,
      'marking_session_students',
    )
    return Array.isArray(payload) ? payload : []
  }

  async function fetchExamAssignmentRoster(ctx, classId, examId) {
    const payload = await gradeoFetchJson(
      ctx,
      `/api/student-group/v2/${encodeURIComponent(classId)}/variation-one/${encodeURIComponent(examId)}`,
      'exam_assignment_roster',
    )
    const students = Array.isArray(payload?.students) ? payload.students : []
    return {
      id: String(payload?.id || '').trim(),
      name: String(payload?.name || '').trim(),
      students: students
        .map(student => ({
          id: String(student?.id || '').trim(),
          name: buildStudentName(student),
          status: String(student?.status || '').trim() || null,
        }))
        .filter(student => student.id),
    }
  }

  function buildAssignedExamSummaryRow({
    className,
    student,
    candidate,
    examAggregate,
    markingState,
    classId,
    syllabusTitle,
  }) {
    const canonicalExamId = String(
      examAggregate?.exam?.id ||
      '',
    ).trim()
    const canonicalExamSessionId = String(
      examAggregate?.examSession?.id ||
      candidate?.examSessionId ||
      '',
    ).trim()
    const canonicalMarkingSessionId = String(
      examAggregate?.markingSession?.id ||
      candidate?.markingSessionId ||
      '',
    ).trim()
    if (!canonicalExamId || !canonicalExamSessionId || !canonicalMarkingSessionId) {
      return null
    }

    const examName = String(
      examAggregate?.exam?.title ||
      candidate?.examTitle ||
      '',
    ).trim()
    if (!examName) {
      return null
    }

    const header = markingState?.examAnswerSheetWithUser?.header || null
    const stats = markingState?.markingSessionAnswerStatistics || null
    const submittedPartCount = parseOptionalNumber(stats?.submittedPartCount) || 0
    const hasSubmittedHeader = Boolean(candidate?.examAnswerSheetId || header?.isSubmitted)
    const hasStartedAttempt = Boolean(header || submittedPartCount > 0)
    const examMark = firstDefinedValue([candidate?.examMark])
    const marksAvailable = firstDefinedValue([candidate?.marksAvailable])
    const classAverage = firstDefinedValue([candidate?.classAverage, candidate?.studentGroupMarkAverage])

    let status = 'not_submitted'
    if (examMark != null) {
      status = 'scored'
    } else if (hasSubmittedHeader || hasStartedAttempt) {
      status = 'awaiting_marking'
    }

    return {
      exam_name: examName,
      gradeo_exam_id: canonicalExamId,
      gradeo_exam_session_id: canonicalExamSessionId,
      gradeo_marking_session_id: canonicalMarkingSessionId,
      gradeo_class_id: classId || null,
      class_name: className || null,
      class_average: classAverage,
      exam_mark: examMark,
      marks_available: marksAvailable,
      status,
      answer_submitted: hasSubmittedHeader,
      marking_session_id: canonicalMarkingSessionId,
      exam_answer_sheet_id: candidate?.examAnswerSheetId || String(header?.id || '').trim() || null,
      exam_session_start_date: candidate?.examSessionStartDate || header?.startDate || null,
      exam_session_max_time_seconds: firstDefinedValue([
        candidate?.examSessionMaxTimeSeconds,
        parseOptionalNumber(stats?.timeMaxSeconds),
      ]),
      student_group_mark_average: classAverage,
      syllabus_id: String(examAggregate?.exam?.syllabusId || '').trim() || null,
      syllabus_title: syllabusTitle || null,
      syllabus_grade: examAggregate?.exam?.grade ? String(examAggregate.exam.grade) : null,
      bands: [],
      outcomes: [],
      topics: [],
      student_id: student.id,
    }
  }

  async function importMappedClass(ctx, {
    classId,
    className,
    classIndex,
    totalClasses,
  }) {
    await setState({
      status: 'preflighting_import',
      currentClass: classIndex,
      totalClasses,
      className,
    })
    const preflight = await ext.fetchApi('/admin/gradeo/imports/preflight', {
      method: 'POST',
      body: JSON.stringify({
        gradeo_class_id: classId,
        gradeo_class_name: className,
      }),
    })

    if (!preflight.ready) {
      await ext.logDebug('background', 'mapped_class_blocked', {
        classId,
        className,
        preflight,
      })
      return {
        imported: null,
        skipped: {
          gradeo_class_id: classId,
          gradeo_class_name: className,
          reason: preflight,
        },
      }
    }

    await setState({
      status: 'importing_class',
      currentClass: classIndex,
      totalClasses,
      className,
    })
    const classDetails = await fetchClassDetails(ctx, classId)
    const students = classDetails.students
    const studentsById = new Map(students.map(student => [student.id, student]))
    const classStudentIds = new Set(students.map(student => student.id))
    const classSyllabusIds = new Set(classDetails.syllabusIds || [])
    const importStudentsById = new Map(
      students.map(student => [
        student.id,
        {
          gradeo_student_id: student.id,
          student_name: student.name,
          rows: [],
          exam_rows: [],
        },
      ])
    )
    const candidateSessions = new Map()
    const skippedExamReasons = {
      no_canonical_exam_id: 0,
      roster_gate_failed: 0,
      syllabus_mismatch: 0,
      zero_assigned_students: 0,
    }
    let importedExamCount = 0

    for (let studentIndex = 0; studentIndex < students.length; studentIndex += 1) {
      const student = students[studentIndex]
      await setState({
        status: 'importing_student_results',
        currentClass: classIndex,
        totalClasses,
        className,
        currentStudent: studentIndex + 1,
        totalStudents: students.length,
        studentName: student.name,
      })
      const candidates = await fetchStudentExamCandidates(ctx, classId, className, student)
      candidates.forEach(candidate => {
        if (!candidate.markingSessionId) {
          skippedExamReasons.no_canonical_exam_id += 1
          ext.logDebug('background', 'gradeo_exam_candidate_skipped', {
            classId,
            className,
            studentId: student.id,
            studentName: student.name,
            examTitle: candidate.examTitle,
            examSessionId: candidate.examSessionId,
            reason: 'no_marking_session_id',
          })
          return
        }
        const existing = candidateSessions.get(candidate.markingSessionId) || {
          markingSessionId: candidate.markingSessionId,
          classId,
          className,
          studentCandidates: new Map(),
        }
        existing.studentCandidates.set(student.id, candidate)
        candidateSessions.set(candidate.markingSessionId, existing)
      })
    }

    for (const session of candidateSessions.values()) {
      const aggregate = await fetchMarkingSessionAggregate(ctx, session.markingSessionId)
      const canonicalExamId = String(aggregate?.exam?.id || '').trim()
      const canonicalExamSessionId = String(
        aggregate?.examSession?.id ||
        [...session.studentCandidates.values()][0]?.examSessionId ||
        '',
      ).trim()
      const canonicalSyllabusId = String(aggregate?.exam?.syllabusId || '').trim()

      if (!canonicalExamId || !canonicalExamSessionId) {
        skippedExamReasons.no_canonical_exam_id += 1
        await ext.logDebug('background', 'gradeo_exam_skipped', {
          classId,
          className,
          markingSessionId: session.markingSessionId,
          reason: 'no_canonical_exam_id',
          examId: canonicalExamId || null,
          examSessionId: canonicalExamSessionId || null,
        })
        continue
      }

      if (classSyllabusIds.size > 0 && canonicalSyllabusId && !classSyllabusIds.has(canonicalSyllabusId)) {
        skippedExamReasons.syllabus_mismatch += 1
        await ext.logDebug('background', 'gradeo_exam_skipped', {
          classId,
          className,
          markingSessionId: session.markingSessionId,
          examId: canonicalExamId,
          examSessionId: canonicalExamSessionId,
          reason: 'syllabus_mismatch',
          examSyllabusId: canonicalSyllabusId,
          classSyllabusIds: Array.from(classSyllabusIds),
        })
        continue
      }

      const assignmentRoster = await fetchExamAssignmentRoster(ctx, classId, canonicalExamId)
      if (assignmentRoster.id !== classId) {
        skippedExamReasons.roster_gate_failed += 1
        await ext.logDebug('background', 'gradeo_exam_skipped', {
          classId,
          className,
          markingSessionId: session.markingSessionId,
          examId: canonicalExamId,
          examSessionId: canonicalExamSessionId,
          reason: 'roster_gate_failed',
          rosterClassId: assignmentRoster.id || null,
        })
        continue
      }

      const assignedStudents = assignmentRoster.students.filter(student => classStudentIds.has(student.id))
      if (assignedStudents.length === 0) {
        skippedExamReasons.zero_assigned_students += 1
        await ext.logDebug('background', 'gradeo_exam_skipped', {
          classId,
          className,
          markingSessionId: session.markingSessionId,
          examId: canonicalExamId,
          examSessionId: canonicalExamSessionId,
          reason: 'zero_assigned_students_after_intersection',
        })
        continue
      }

      const markingStates = await fetchMarkingStudentStates(ctx, session.markingSessionId)
      const markingStateByStudentId = new Map(
        markingStates
          .map(item => {
            const userId = String(item?.examAnswerSheetWithUser?.user?.id || item?.markingSessionAnswerStatistics?.id || '').trim()
            return userId ? [userId, item] : null
          })
          .filter(Boolean)
      )

      let assignedRowCount = 0
      assignedStudents.forEach(assignedStudent => {
        const importStudent = importStudentsById.get(assignedStudent.id)
        const student = studentsById.get(assignedStudent.id)
        if (!importStudent || !student) {
          return
        }
        const examRow = buildAssignedExamSummaryRow({
          className,
          student,
          candidate: session.studentCandidates.get(assignedStudent.id) || null,
          examAggregate: aggregate,
          markingState: markingStateByStudentId.get(assignedStudent.id) || null,
          classId,
          syllabusTitle: canonicalSyllabusId ? classDetails.syllabusTitlesById[canonicalSyllabusId] || null : null,
        })
        if (!examRow) {
          return
        }
        const alreadyPresent = importStudent.exam_rows.some(
          existing => existing.gradeo_marking_session_id === examRow.gradeo_marking_session_id
        )
        if (alreadyPresent) {
          return
        }
        importStudent.exam_rows.push(examRow)
        assignedRowCount += 1
      })

      if (assignedRowCount === 0) {
        skippedExamReasons.zero_assigned_students += 1
        await ext.logDebug('background', 'gradeo_exam_skipped', {
          classId,
          className,
          markingSessionId: session.markingSessionId,
          examId: canonicalExamId,
          examSessionId: canonicalExamSessionId,
          reason: 'zero_assigned_rows_built',
        })
        continue
      }

      importedExamCount += 1
      await ext.logDebug('background', 'gradeo_exam_confirmed', {
        classId,
        className,
        markingSessionId: session.markingSessionId,
        examId: canonicalExamId,
        examSessionId: canonicalExamSessionId,
        assignedStudents: assignedRowCount,
      })
    }

    const importStudents = Array.from(importStudentsById.values())

    await setState({
      status: 'uploading_class',
      currentClass: classIndex,
      totalClasses,
      className,
      students: importStudents.length,
    })
    const result = await ext.fetchApi('/admin/gradeo/imports', {
      method: 'POST',
      body: JSON.stringify({
        gradeo_class_id: classId,
        gradeo_class_name: className,
        extension_version: EXTENSION_VERSION,
        students: importStudents,
      }),
    })

    await ext.logDebug('background', 'mapped_class_imported', {
      classId,
      className,
      confirmedExams: importedExamCount,
      skippedExamReasons,
      processedStudents: result?.processed_students,
      matchedStudents: result?.matched_students,
      importedExams: result?.imported_exams,
    })

    return {
      imported: {
        gradeo_class_id: classId,
        gradeo_class_name: className,
        result,
      },
      skipped: null,
    }
  }

  async function importMappedClasses() {
    const user = await ensureAdmin()
    const ctx = await getGradeoApiContext()

    await setState({ status: 'loading_mappings' })
    const mappings = await ext.fetchApi('/admin/gradeo/mappings')
    if (!Array.isArray(mappings) || mappings.length === 0) {
      const blocked = { ready: false, reason: 'No Gradeo class mappings found in Kings Track.' }
      await setState({ status: 'blocked', action: 'import_mapped_classes', blocked })
      return blocked
    }

    await setState({ status: 'loading_reporting_classes', totalClasses: mappings.length })
    const reportingClasses = await fetchReportingClasses(ctx)
    const reportingClassMap = new Map(reportingClasses.map(item => [item.id, item]))

    const imported = []
    const skipped = []

    for (let classIndex = 0; classIndex < mappings.length; classIndex += 1) {
      const mapping = mappings[classIndex]
      const classId = mapping.gradeo_class_id
      const className = mapping.gradeo_class_name
      const reportingClass = reportingClassMap.get(classId)

      if (!reportingClass) {
        skipped.push({
          gradeo_class_id: classId,
          gradeo_class_name: className,
          reason: 'Class is not available in Gradeo reporting.',
        })
        await ext.logDebug('background', 'mapped_class_skipped', {
          classId,
          className,
          reason: 'missing_from_reporting',
        })
        continue
      }

      const classImport = await importMappedClass(ctx, {
        classId,
        className,
        classIndex: classIndex + 1,
        totalClasses: mappings.length,
      })
      if (classImport.imported) {
        imported.push(classImport.imported)
      }
      if (classImport.skipped) {
        skipped.push(classImport.skipped)
      }
    }

    const result = {
      imported_classes: imported.length,
      skipped_classes: skipped.length,
      imported,
      skipped,
    }
    await setState({
      status: 'completed',
      action: 'import_mapped_classes',
      result,
      user: user.email,
    })
    return result
  }

  async function syncReportingClass() {
    const tab = await getActiveGradeoTab()
    const user = await ensureAdmin()
    const selectedClass = await browser.tabs.sendMessage(tab.id, { type: 'kings.gradeo.getSelectedClass' })
    const ctx = await getGradeoApiContext()
    await ext.logDebug('background', 'reporting_sync_started', {
      user: user.email,
      tabId: tab.id,
      classId: selectedClass.id,
      className: selectedClass.name,
    })
    const classImport = await importMappedClass(ctx, {
      classId: selectedClass.id,
      className: selectedClass.name,
      classIndex: 1,
      totalClasses: 1,
    })
    if (classImport.skipped) {
      await setState({ status: 'blocked', action: 'class_import', preflight: classImport.skipped.reason })
      return classImport.skipped.reason
    }

    await setState({ status: 'completed', action: 'class_import', result: classImport.imported.result, user: user.email })
    return classImport.imported.result
  }

  async function uploadSchoolGroups(user, tab, response, source) {
    await ext.logDebug('background', 'school_groups_scraped', {
      tabId: tab.id,
      count: response.classes.length,
      page: response.page,
      pages: response.pageDiagnostics,
      source: source || response.source || 'dom',
    })
    await setState({
      status: 'uploading_school_groups',
      count: response.classes.length,
      source: source || response.source || 'dom',
    })
    const result = await ext.fetchApi('/admin/gradeo/classes', {
      method: 'POST',
      body: JSON.stringify({
        extension_version: EXTENSION_VERSION,
        classes: response.classes,
      }),
    })
    await ext.logDebug('background', 'school_groups_uploaded', result)
    await setState({
      status: 'completed',
      action: 'class_discovery',
      source: source || response.source || 'dom',
      result,
      user: user.email,
    })
    return result
  }

  async function syncSchoolGroupsScrape() {
    let tab = await getActiveGradeoTab()
    const user = await ensureAdmin()
    tab = await prepareSchoolGroupsTab(tab)
    await ext.logDebug('background', 'school_groups_sync_started', {
      user: user.email,
      tabId: tab.id,
      source: 'dom',
    })
    await setState({ status: 'scraping_school_groups' })
    const response = await scrapeSchoolGroups(tab.id, 12)
    return uploadSchoolGroups(user, tab, response, 'dom')
  }

  async function syncSchoolGroupsApi() {
    return syncClassesApi()
  }

  async function runVisibleAction(action, callback) {
    try {
      return await callback()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ext.logDebug('background', 'visible_action_failed', {
        action,
        message,
      })
      await setState({
        status: 'error',
        action,
        message,
      })
      throw error
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === 'kings.debug.log') {
      const entry = message.entry || {}
      return ext.sendDebugLog(entry)
    }

    if (message?.type === 'kings.gradeo.progress') {
      return setState({ status: 'scraping_reporting', progress: message.progress })
    }

    if (message?.type === 'kings.popup.getContext') {
      return Promise.all([
        ext.getConfig(),
        getState(),
        ext.getCachedCurrentUser(5 * 60 * 1000).catch(() => null),
        ext.getCachedAuthStatus(5 * 60 * 1000).catch(() => null),
        ext.getCachedBackendStatus(5 * 60 * 1000).catch(() => null),
      ])
        .then(([config, state, user, authStatus, backendStatus]) => {
          ext.refreshBackendStatus().catch(() => null)
          ext.getCurrentUser({ maxAgeMs: 30 * 1000 }).catch(() => null)
          return {
            config,
            state,
            user,
            authStatus,
            backendStatus,
          }
        })
    }

    if (message?.type === 'kings.popup.saveConfig') {
      ext.logDebug('popup', 'save_config_clicked', {
        apiBaseUrl: message.config?.apiBaseUrl || '',
        hasExtensionApiKey: Boolean(message.config?.extensionApiKey),
      })
      return ext.saveConfig(message.config)
    }

    if (message?.type === 'kings.popup.syncStudents' || message?.type === 'kings.popup.syncStudentDirectory') {
      ext.logDebug('popup', 'sync_students_clicked')
      return runVisibleAction('sync_students', syncStudentsApi)
    }

    if (message?.type === 'kings.popup.syncClasses' || message?.type === 'kings.popup.syncSchoolGroupsApi') {
      ext.logDebug('popup', 'sync_classes_clicked')
      return runVisibleAction('sync_classes', syncClassesApi)
    }

    if (message?.type === 'kings.popup.importMappedClasses') {
      ext.logDebug('popup', 'import_mapped_classes_clicked')
      return runVisibleAction('import_mapped_classes', importMappedClasses)
    }

    if (message?.type === 'kings.popup.syncSchoolGroupsScrape') {
      ext.logDebug('popup', 'sync_school_groups_scrape_clicked')
      return syncSchoolGroupsScrape()
    }

    if (message?.type === 'kings.popup.syncReportingClass') {
      ext.logDebug('popup', 'sync_reporting_clicked')
      return syncReportingClass()
    }

    if (message?.type === 'kings.popup.getDebugLogs') {
      return ext.getDebugLogs()
    }

    if (message?.type === 'kings.popup.clearDebugLogs') {
      return ext.clearDebugLogs()
    }

    return undefined
  })
})()

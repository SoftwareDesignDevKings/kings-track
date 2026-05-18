import { getGradeoApiContext, gradeoFetchJson, gradeoFetchText } from './gradeoApi'
import { fetchKingsTrackApi } from './kingsTrackApi'
import { registerMessageHandlers } from './messages'
import { compactImportStudent } from './payload'
import { __stateTest, beginActiveJob, getState, heartbeatActiveJob, setState } from './state'

(function () {
  const ext = self.KingsTrackExtension
  const EXTENSION_VERSION = '0.1.0'
  const LONG_IMPORT_TIMEOUT_MS = 5 * 60 * 1000
  const KEEP_ALIVE_HEARTBEAT_MS = 20 * 1000

  async function tickKeepAlive(action) {
    try {
      if (browser.runtime.getPlatformInfo) {
        await browser.runtime.getPlatformInfo()
      }
      await heartbeatActiveJob(action)
    } catch (error) {
      await ext.logDebug('background', 'long_action_keepalive_failed', {
        action,
        error: String(error),
      })
    }
  }

  async function withKeepAlive(action, run, options?) {
    const heartbeatMs = options?.heartbeatMs != null
      ? Math.max(1, Number(options.heartbeatMs) || KEEP_ALIVE_HEARTBEAT_MS)
      : KEEP_ALIVE_HEARTBEAT_MS
    await tickKeepAlive(action)
    const keepAliveInterval = setInterval(() => {
      tickKeepAlive(action)
    }, heartbeatMs)

    try {
      return await run()
    } finally {
      clearInterval(keepAliveInterval)
    }
  }

  async function runLongAction(action, callback, options?) {
    const job = await beginActiveJob(action)
    if (!job.started) {
      await ext.logDebug('background', 'long_action_duplicate_ignored', {
        action,
        activeJob: job.state?.activeJob || null,
        status: job.state?.status || null,
      })
      return job.state
    }

    await ext.logDebug('background', 'long_action_started', {
      action,
      activeJob: job.state.activeJob,
    })

    return withKeepAlive(action, callback, options)
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
    return new Promise<void>((resolve, reject) => {
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

  function compactListValue(value) {
    if (Array.isArray(value)) {
      return value
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .join(',')
    }
    return String(value || '').trim() || null
  }

  function normalizeTaskKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
  }

  function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim())
  }

  function normalizeMarkingSessionIds(ids) {
    return Array.from(new Set(
      (Array.isArray(ids) ? ids : [])
        .map(id => String(id || '').trim())
        .filter(Boolean)
    ))
  }

  function resolveTargetMarkingSessionIds(sessions, taskQuery, markingSessionIds) {
    const explicitIds = normalizeMarkingSessionIds(markingSessionIds)
    if (explicitIds.length > 0) {
      return { ids: explicitIds, error: null }
    }

    const query = String(taskQuery || '').trim()
    if (!query) {
      return { ids: [], error: 'Enter a Gradeo task name or marking session ID.' }
    }

    const sessionRows = Array.isArray(sessions) ? sessions : []
    const matches = isUuidLike(query)
      ? sessionRows.filter(session => session.markingSessionId === query)
      : sessionRows.filter(session => normalizeTaskKey(session.examTitle) === normalizeTaskKey(query))

    if (matches.length === 0) {
      return { ids: [], error: `Task not found: ${query}` }
    }

    const ids = normalizeMarkingSessionIds(matches.map(session => session.markingSessionId))
    if (ids.length > 1) {
      const detail = matches
        .map(session => `${session.examTitle || 'Untitled task'} (${session.markingSessionId})`)
        .join(', ')
      return { ids: [], error: `Task is ambiguous: ${detail}` }
    }

    return { ids, error: null }
  }

  async function fetchRecentMarkingSessionNotifications(ctx, maxPages = 4) {
    const limit = 100
    const sessions = []
    let offset = 0
    let totalRows = null

    for (let page = 0; page < maxPages; page += 1) {
      const payload = await gradeoFetchJson(
        ctx,
        `/api/notification/?limit=${limit}&offset=${offset}`,
        'gradeo_notifications',
      )
      const rows = Array.isArray(payload?.list) ? payload.list : []
      totalRows = parseOptionalNumber(payload?.pgn?.total) || rows.length

      rows.forEach(row => {
        const type = String(row?.type || '').trim()
        const markingSessionId = String(row?.content?.markingSessionId || '').trim()
        const examTitle = String(row?.content?.examTitle || '').trim()
        if (type !== 'MARKING_SESSION_FINISHED' || !markingSessionId) {
          return
        }
        sessions.push({
          markingSessionId,
          examTitle: examTitle || null,
          createdDate: row?.createdDate || null,
        })
      })

      if (rows.length === 0 || offset + rows.length >= totalRows) {
        break
      }
      offset += rows.length
    }

    return sessions
  }

  async function resolveTargetMarkingSessionIdsWithFallback(ctx, sessions, taskQuery, markingSessionIds) {
    const resolved = resolveTargetMarkingSessionIds(sessions, taskQuery, markingSessionIds)
    if (!resolved.error) {
      return { ...resolved, fallbackSessions: [] }
    }

    const query = String(taskQuery || '').trim()
    if (isUuidLike(query)) {
      return {
        ids: [query],
        error: null,
        fallbackSessions: [{ markingSessionId: query, examTitle: null }],
      }
    }

    try {
      const notificationSessions = await fetchRecentMarkingSessionNotifications(ctx)
      const notificationResolved = resolveTargetMarkingSessionIds(notificationSessions, taskQuery, [])
      if (!notificationResolved.error) {
        const idSet = new Set(notificationResolved.ids)
        return {
          ...notificationResolved,
          fallbackSessions: notificationSessions.filter(session => idSet.has(session.markingSessionId)),
        }
      }
      if (/ambiguous/i.test(notificationResolved.error)) {
        return { ...notificationResolved, fallbackSessions: [] }
      }
    } catch (error) {
      await ext.logDebug('background', 'targeted_task_notification_lookup_failed', {
        taskQuery,
        error: String(error),
      })
    }

    return {
      ids: [],
      error: `Task not found in student results or recent Gradeo notifications: ${query}`,
      fallbackSessions: [],
    }
  }

  function buildClassImportRequestBody({
    classId,
    className,
    scope = 'class',
    scopeMarkingSessionIds = [],
    uploadStudents = [],
  }) {
    return JSON.stringify({
      gradeo_class_id: classId,
      gradeo_class_name: className,
      extension_version: EXTENSION_VERSION,
      import_scope: scope,
      scope_marking_session_ids: scope === 'marking_sessions' ? normalizeMarkingSessionIds(scopeMarkingSessionIds) : [],
      students: uploadStudents,
    })
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
    // Admin gating now lives on the dashboard bridge page — it refuses to install
    // its listener for non-admin sessions. Here we only verify a bridge tab is
    // available so we can fail fast with a clear message.
    const config = await ext.getConfig()
    const base = String(config.frontendUrl || '').trim().replace(/\/$/, '')
    if (!base) {
      throw new Error('Set the Kings Track Dashboard URL in Settings.')
    }
    const tabs = await browser.tabs.query({})
    const bridgeTab = (tabs || []).find(tab =>
      typeof tab.url === 'string' && tab.url.startsWith(`${base}/extension-bridge`),
    )
    if (!bridgeTab) {
      await ext.logDebug('background', 'bridge_tab_missing', { frontendUrl: base })
      throw new Error(`Open the Kings Track Extension Bridge tab at ${base}/extension-bridge and stay signed in.`)
    }
    await ext.logDebug('background', 'bridge_tab_found', { frontendUrl: base, tabId: bridgeTab.id })
    return { email: 'bridge-session', role: 'admin' }
  }

  function fetchGradeoMappings() {
    return fetchKingsTrackApi('/admin/gradeo/mappings', undefined, {
      scope: 'mapping_fetch',
    })
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
    const result = await fetchKingsTrackApi('/admin/gradeo/student-directory', {
      method: 'POST',
      body: JSON.stringify({
        extension_version: EXTENSION_VERSION,
        students: deduped,
      }),
    }, {
      scope: 'student_directory_upload',
      studentCount: deduped.length,
      pages: diagnostics.length,
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
    const result = await fetchKingsTrackApi('/admin/gradeo/classes', {
      method: 'POST',
      body: JSON.stringify({
        extension_version: EXTENSION_VERSION,
        classes: deduped,
      }),
    }, {
      scope: 'class_upload',
      classCount: deduped.length,
      pages: diagnostics.length,
      source: 'api',
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

  async function fetchMarkingSessionMetadata(ctx, markingSessionId) {
    return gradeoFetchJson(
      ctx,
      `/api/marking-session/summary/metadata/${encodeURIComponent(markingSessionId)}`,
      'marking_session_metadata',
    )
  }

  function extractTopicLabels(metadata) {
    const labels = Array.isArray(metadata?.examSummary?.topicLabels)
      ? metadata.examSummary.topicLabels
      : []
    return labels
      .map(label => String(label?.text || '').trim())
      .filter(Boolean)
  }

  function getTopicLabelsForMarkingSession(ctx, markingSessionId, cache) {
    if (cache.has(markingSessionId)) {
      return cache.get(markingSessionId)
    }

    const request = fetchMarkingSessionMetadata(ctx, markingSessionId)
      .then(extractTopicLabels)
      .catch(error => {
        ext.logDebug('background', 'gradeo_marking_session_metadata_failed', {
          markingSessionId,
          error: String(error),
        })
        return []
      })
    cache.set(markingSessionId, request)
    return request
  }

  async function fetchMarkingSessionQuestions(ctx, markingSessionId) {
    const payload = await gradeoFetchJson(
      ctx,
      `/api/marking-session/question/${encodeURIComponent(markingSessionId)}`,
      'marking_session_questions',
    )
    return Array.isArray(payload) ? payload : []
  }

  function questionMetadataByPartId(questions) {
    const metadata = new Map<string, any>()
    ;(Array.isArray(questions) ? questions : []).forEach(question => {
      const questionId = String(question?.id || '').trim()
      const questionTitle = String(question?.title || '').trim() || null
      const copyrightNotice = String(question?.copyrightText || '').trim() || null
      ;(Array.isArray(question?.parts) ? question.parts : []).forEach(part => {
        const partId = String(part?.id || '').trim()
        if (!partId) {
          return
        }
        const syllabus = part?.metadata?.syllabus || null
        metadata.set(partId, {
          gradeo_question_id: questionId || null,
          question: questionTitle,
          question_part: String(part?.title || '').trim() || null,
          gradeo_question_part_id: partId,
          question_link: questionId ? `https://platform.gradeo.com.au/question/${questionId}` : null,
          marks_available: parseOptionalNumber(part?.metadata?.mark),
          syllabus_id: String(syllabus?.id || question?.syllabusId || '').trim() || null,
          syllabus_title: String(syllabus?.title || '').trim() || null,
          syllabus_grade: syllabus?.grade != null ? String(syllabus.grade) : null,
          copyright_notice: copyrightNotice,
        })
      })
    })
    return metadata
  }

  function getQuestionMetadataForMarkingSession(ctx, markingSessionId, cache) {
    if (cache.has(markingSessionId)) {
      return cache.get(markingSessionId)
    }

    const request = fetchMarkingSessionQuestions(ctx, markingSessionId)
      .then(questionMetadataByPartId)
      .catch(error => {
        ext.logDebug('background', 'gradeo_marking_session_questions_failed', {
          markingSessionId,
          error: String(error),
        })
        return new Map<string, any>()
      })
    cache.set(markingSessionId, request)
    return request
  }

  function rowsByStudentId(rows) {
    const grouped = new Map<string, any[]>()
    rows.forEach(row => {
      const studentId = String(row?.['Student ID'] || '').trim()
      if (!studentId) {
        return
      }
      const existing = grouped.get(studentId) || []
      existing.push(row)
      grouped.set(studentId, existing)
    })
    return grouped
  }

  function rowsByQuestionPartId(rows) {
    const grouped = new Map<string, any>()
    ;(Array.isArray(rows) ? rows : []).forEach(row => {
      const partId = String(row?.['Question part ID'] || row?.gradeo_question_part_id || '').trim()
      if (partId && !grouped.has(partId)) {
        grouped.set(partId, row)
      }
    })
    return grouped
  }

  async function fetchMarkingSessionCsvRows(ctx, markingSessionId) {
    const text = await gradeoFetchText(
      ctx,
      `/api/statistics-marking-session/download-csv/${encodeURIComponent(markingSessionId)}/`,
      'marking_session_csv',
    )
    return ext.parseCsv(text)
  }

  function getCsvRowsForMarkingSession(ctx, markingSessionId, cache) {
    if (cache.has(markingSessionId)) {
      return cache.get(markingSessionId)
    }

    const request = fetchMarkingSessionCsvRows(ctx, markingSessionId)
      .then(rowsByStudentId)
      .catch(error => {
        ext.logDebug('background', 'gradeo_marking_session_csv_failed', {
          markingSessionId,
          error: String(error),
        })
        return new Map<string, any[]>()
      })
    cache.set(markingSessionId, request)
    return request
  }

  function appendCsvRowsForStudent(importStudent, csvRowsByStudentId, markingSessionId) {
    const csvRows = csvRowsByStudentId.get(importStudent.gradeo_student_id) || []
    csvRows.forEach(row => {
      importStudent.rows.push(ext.toImportRow(row, markingSessionId))
    })
    return csvRows.length
  }

  async function fetchMarkingItemsForStudent(ctx, markingSessionId, studentId) {
    const payload = await gradeoFetchJson(
      ctx,
      `/api/marking-session/question-part-by-student/${encodeURIComponent(markingSessionId)}/${encodeURIComponent(studentId)}`,
      'marking_session_student_question_parts',
    )
    return Array.isArray(payload) ? payload : []
  }

  async function getMarkingItemsForStudent(ctx, markingSessionId, studentId, studentName) {
    try {
      return await fetchMarkingItemsForStudent(ctx, markingSessionId, studentId)
    } catch (error) {
      await ext.logDebug('background', 'gradeo_marking_items_failed', {
        markingSessionId,
        studentId,
        studentName,
        error: String(error),
      })
      return []
    }
  }

  function getPrimaryMarkingItem(item) {
    const direct = item?.markingSessionMarkingItem || null
    if (direct) {
      return direct
    }
    const markingItems = Array.isArray(item?.markingSessionMarkingItemList)
      ? item.markingSessionMarkingItemList
      : []
    return markingItems.find(markingItem => markingItem?.markerType === 'LEAD') || markingItems[0] || null
  }

  function buildMarkerName(markingItem, fallbackCsvRow) {
    const fromMarkingItem = [markingItem?.markerFirstName, markingItem?.markerLastName]
      .map(part => String(part || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim()
    return fromMarkingItem || fallbackCsvRow?.['Marker name'] || null
  }

  function buildAuthoritativeQuestionRowsForStudent({
    examRow,
    markingItems,
    questionMetadataByPartId,
    csvRowsByPartId,
  }) {
    return (Array.isArray(markingItems) ? markingItems : [])
      .map(item => {
        const markingItem = getPrimaryMarkingItem(item)
        const partId = String(
          item?.partId ||
          markingItem?.partId ||
          item?.examAnswerSheetItem?.partId ||
          '',
        ).trim()
        if (!partId) {
          return null
        }
        const questionMetadata = questionMetadataByPartId.get(partId) || {}
        const csvRow = csvRowsByPartId.get(partId) || {}
        const answerSubmitted = Boolean(
          markingItem?.isSubmitted ||
          (item?.examAnswerSheetItem && markingItem?.answerNotSubmitted !== true),
        )
        return {
          exam_name: examRow.exam_name,
          gradeo_exam_id: examRow.gradeo_exam_id,
          gradeo_exam_session_id: examRow.gradeo_exam_session_id,
          gradeo_marking_session_id: examRow.gradeo_marking_session_id,
          gradeo_class_id: examRow.gradeo_class_id,
          class_name: examRow.class_name,
          class_average: examRow.class_average,
          syllabus_id: questionMetadata.syllabus_id || examRow.syllabus_id,
          question: csvRow.Question || questionMetadata.question || null,
          gradeo_question_id: csvRow['Question ID'] || questionMetadata.gradeo_question_id || null,
          question_part: csvRow['Question part'] || questionMetadata.question_part || null,
          gradeo_question_part_id: partId,
          question_link: csvRow['Question link'] || questionMetadata.question_link || null,
          mark: parseOptionalNumber(markingItem?.mark),
          marks_available: questionMetadata.marks_available ?? parseOptionalNumber(csvRow['Marks available']),
          answer_submitted: answerSubmitted,
          feedback: markingItem?.feedbackText ?? csvRow.Feedback ?? null,
          marker_name: buildMarkerName(markingItem, csvRow),
          marker_id: markingItem?.markerId || csvRow['Marker ID'] || null,
          marking_session_link: csvRow['Marking session link'] || `https://platform.gradeo.com.au/script/${examRow.gradeo_marking_session_id}`,
          exam_mark: null,
          syllabus_title: questionMetadata.syllabus_title || examRow.syllabus_title,
          syllabus_grade: questionMetadata.syllabus_grade || examRow.syllabus_grade,
          bands: compactListValue(csvRow.Bands),
          outcomes: compactListValue(csvRow.Outcomes),
          topics: compactListValue(csvRow.Topics),
          copyright_notice: csvRow.Copyright || questionMetadata.copyright_notice,
        }
      })
      .filter(Boolean)
  }

  function applyAuthoritativeRowsToExamSummary(examRow, questionRows) {
    if (!Array.isArray(questionRows) || questionRows.length === 0) {
      return examRow
    }

    const submittedRows = questionRows.filter(row => row.answer_submitted)
    const unmarkedSubmittedRows = submittedRows.filter(row =>
      row.mark == null && (row.marks_available == null || Number(row.marks_available) > 0)
    )
    const computedMarksAvailable = questionRows.reduce(
      (total, row) => total + (Number(row.marks_available) || 0),
      0,
    )
    let status = 'not_submitted'
    let examMark = null
    if (submittedRows.length > 0 && unmarkedSubmittedRows.length === 0) {
      status = 'scored'
      examMark = submittedRows.reduce((total, row) => total + (Number(row.mark) || 0), 0)
    } else if (submittedRows.length > 0) {
      status = 'awaiting_marking'
    }

    return {
      ...examRow,
      status,
      exam_mark: examMark,
      marks_available: computedMarksAvailable > 0 ? computedMarksAvailable : examRow.marks_available,
      answer_submitted: submittedRows.length > 0,
    }
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
    topics,
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
      topics: Array.isArray(topics) ? topics : [],
      student_id: student.id,
    }
  }

  async function importMappedClass(ctx, {
    classId,
    className,
    classIndex,
    totalClasses,
    topicMetadataCache,
    csvRowsCache,
    questionMetadataCache,
    scope = 'class',
    taskQuery = null,
    markingSessionIds = [],
  }) {
    await setState({
      status: 'preflighting_import',
      currentClass: classIndex,
      totalClasses,
      className,
    })
    const preflight = await fetchKingsTrackApi('/admin/gradeo/imports/preflight', {
      method: 'POST',
      body: JSON.stringify({
        gradeo_class_id: classId,
        gradeo_class_name: className,
      }),
    }, {
      scope: 'import_preflight',
      classId,
      className,
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
    const studentsById = new Map<string, any>(students.map(student => [student.id, student]))
    const classStudentIds = new Set(students.map(student => student.id))
    const classSyllabusIds = new Set(classDetails.syllabusIds || [])
    const importStudentsById = new Map<string, any>(
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
          examTitle: candidate.examTitle || null,
          studentCandidates: new Map(),
        }
        existing.examTitle = existing.examTitle || candidate.examTitle || null
        existing.studentCandidates.set(student.id, candidate)
        candidateSessions.set(candidate.markingSessionId, existing)
      })
    }

    let scopedMarkingSessionIds = normalizeMarkingSessionIds(markingSessionIds)
    let sessions = Array.from<any>(candidateSessions.values())
    if (scope === 'marking_sessions') {
      const resolved = await resolveTargetMarkingSessionIdsWithFallback(ctx, sessions, taskQuery, scopedMarkingSessionIds)
      if (resolved.error) {
        await ext.logDebug('background', 'targeted_task_import_blocked', {
          classId,
          className,
          taskQuery,
          reason: resolved.error,
        })
        return {
          imported: null,
          skipped: {
            gradeo_class_id: classId,
            gradeo_class_name: className,
            reason: resolved.error,
          },
        }
      }
      scopedMarkingSessionIds = resolved.ids
      const sessionsById = new Map(sessions.map(session => [session.markingSessionId, session]))
      ;(resolved.fallbackSessions || []).forEach(session => {
        if (!session?.markingSessionId || sessionsById.has(session.markingSessionId)) {
          return
        }
        sessionsById.set(session.markingSessionId, {
          markingSessionId: session.markingSessionId,
          classId,
          className,
          examTitle: session.examTitle || null,
          studentCandidates: new Map(),
        })
      })
      const scopedIdSet = new Set(scopedMarkingSessionIds)
      sessions = Array.from<any>(sessionsById.values()).filter(session => scopedIdSet.has(session.markingSessionId))
    }

    for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex += 1) {
      const session = sessions[sessionIndex]
      const sessionExamName = [...session.studentCandidates.values()][0]?.examTitle || session.examTitle || null
      await setState({
        status: 'importing_exam_sessions',
        currentClass: classIndex,
        totalClasses,
        className,
        currentExam: sessionIndex + 1,
        totalExams: sessions.length,
        examName: sessionExamName,
      })

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
          classSyllabusIds: Array.from<any>(classSyllabusIds),
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

      const [topics, csvRowsByStudentId, markingStates, questionMetadataByPartId] = await Promise.all([
        getTopicLabelsForMarkingSession(ctx, session.markingSessionId, topicMetadataCache),
        getCsvRowsForMarkingSession(ctx, session.markingSessionId, csvRowsCache),
        fetchMarkingStudentStates(ctx, session.markingSessionId),
        getQuestionMetadataForMarkingSession(ctx, session.markingSessionId, questionMetadataCache),
      ])
      const markingStateByStudentId = new Map<string, any>(
        markingStates
          .map(item => {
            const userId = String(item?.examAnswerSheetWithUser?.user?.id || item?.markingSessionAnswerStatistics?.id || '').trim()
            return userId ? [userId, item] as [string, any] : null
          })
          .filter(Boolean)
      )

      let assignedRowCount = 0
      for (const assignedStudent of assignedStudents) {
        const importStudent = importStudentsById.get(assignedStudent.id)
        const student = studentsById.get(assignedStudent.id)
        if (!importStudent || !student) {
          continue
        }
        const examRow = buildAssignedExamSummaryRow({
          className,
          student,
          candidate: session.studentCandidates.get(assignedStudent.id) || null,
          examAggregate: aggregate,
          markingState: markingStateByStudentId.get(assignedStudent.id) || null,
          classId,
          syllabusTitle: canonicalSyllabusId ? classDetails.syllabusTitlesById[canonicalSyllabusId] || null : null,
          topics,
        })
        if (!examRow) {
          continue
        }
        const alreadyPresent = importStudent.exam_rows.some(
          existing => existing.gradeo_marking_session_id === examRow.gradeo_marking_session_id
        )
        if (alreadyPresent) {
          continue
        }
        const markingItems = await getMarkingItemsForStudent(
          ctx,
          session.markingSessionId,
          assignedStudent.id,
          student.name,
        )
        const authoritativeRows = buildAuthoritativeQuestionRowsForStudent({
          examRow,
          markingItems,
          questionMetadataByPartId,
          csvRowsByPartId: rowsByQuestionPartId(csvRowsByStudentId.get(assignedStudent.id) || []),
        })
        importStudent.rows.push(...authoritativeRows)
        importStudent.exam_rows.push(applyAuthoritativeRowsToExamSummary(examRow, authoritativeRows))
        assignedRowCount += 1
      }

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

    if (scope === 'marking_sessions' && importedExamCount === 0) {
      const reason = `Task was found, but no matching assigned exam data was confirmed for ${className}. Check the mapped class selected in Targeted re-sync.`
      await ext.logDebug('background', 'targeted_task_import_blocked', {
        classId,
        className,
        taskQuery,
        scopeMarkingSessionIds: scopedMarkingSessionIds,
        skippedExamReasons,
        reason,
      })
      return {
        imported: null,
        skipped: {
          gradeo_class_id: classId,
          gradeo_class_name: className,
          reason,
        },
      }
    }

    const importStudents = Array.from<any>(importStudentsById.values())
    const uploadStudents = importStudents
      .filter(student => (
        (Array.isArray(student.rows) && student.rows.length > 0) ||
        (Array.isArray(student.exam_rows) && student.exam_rows.length > 0)
      ))
      .map(compactImportStudent)
    const requestBody = buildClassImportRequestBody({
      classId,
      className,
      scope,
      scopeMarkingSessionIds: scopedMarkingSessionIds,
      uploadStudents,
    })
    const payloadBytes = new TextEncoder().encode(requestBody).length
    await ext.logDebug('background', 'class_import_payload_built', {
      classId,
      className,
      originalStudents: importStudents.length,
      uploadStudents: uploadStudents.length,
      payloadBytes,
      payloadKilobytes: Math.round(payloadBytes / 1024),
      confirmedExams: importedExamCount,
    })

    await setState({
      status: 'uploading_class',
      currentClass: classIndex,
      totalClasses,
      className,
      students: uploadStudents.length,
      payloadKilobytes: Math.round(payloadBytes / 1024),
    })
    const result = await fetchKingsTrackApi('/admin/gradeo/imports', {
      method: 'POST',
      timeoutMs: LONG_IMPORT_TIMEOUT_MS,
      body: requestBody,
    }, {
      scope: 'class_import_upload',
      classId,
      className,
      studentCount: uploadStudents.length,
      payloadBytes,
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
    const topicMetadataCache = new Map()
    const csvRowsCache = new Map()
    const questionMetadataCache = new Map()

    await setState({ status: 'loading_mappings' })
    const mappings = await fetchGradeoMappings()
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
        topicMetadataCache,
        csvRowsCache,
        questionMetadataCache,
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

  async function importSingleMappedClass(classId, className) {
    const user = await ensureAdmin()
    const ctx = await getGradeoApiContext()
    const topicMetadataCache = new Map()
    const csvRowsCache = new Map()
    const questionMetadataCache = new Map()
    const normalizedClassId = String(classId || '').trim()
    const normalizedClassName = String(className || '').trim()
    if (!normalizedClassId || !normalizedClassName) {
      throw new Error('Choose a mapped Gradeo class to re-sync.')
    }

    const classImport = await importMappedClass(ctx, {
      classId: normalizedClassId,
      className: normalizedClassName,
      classIndex: 1,
      totalClasses: 1,
      topicMetadataCache,
      csvRowsCache,
      questionMetadataCache,
      scope: 'class',
    })
    if (classImport.skipped) {
      await setState({ status: 'blocked', action: 'import_mapped_class', preflight: classImport.skipped.reason })
      return classImport.skipped.reason
    }

    await setState({ status: 'completed', action: 'import_mapped_class', result: classImport.imported.result, user: user.email })
    return classImport.imported.result
  }

  async function importMappedClassTask(classId, className, taskQuery) {
    const user = await ensureAdmin()
    const ctx = await getGradeoApiContext()
    const topicMetadataCache = new Map()
    const csvRowsCache = new Map()
    const questionMetadataCache = new Map()
    const normalizedClassId = String(classId || '').trim()
    const normalizedClassName = String(className || '').trim()
    const normalizedTaskQuery = String(taskQuery || '').trim()
    if (!normalizedClassId || !normalizedClassName) {
      throw new Error('Choose a mapped Gradeo class to re-sync.')
    }
    if (!normalizedTaskQuery) {
      throw new Error('Enter a Gradeo task name or marking session ID.')
    }

    const classImport = await importMappedClass(ctx, {
      classId: normalizedClassId,
      className: normalizedClassName,
      classIndex: 1,
      totalClasses: 1,
      topicMetadataCache,
      csvRowsCache,
      questionMetadataCache,
      scope: 'marking_sessions',
      taskQuery: normalizedTaskQuery,
    })
    if (classImport.skipped) {
      await setState({ status: 'blocked', action: 'import_mapped_class_task', preflight: classImport.skipped.reason })
      return classImport.skipped.reason
    }

    await setState({ status: 'completed', action: 'import_mapped_class_task', result: classImport.imported.result, user: user.email })
    return classImport.imported.result
  }

  async function syncReportingClass() {
    const tab = await getActiveGradeoTab()
    const user = await ensureAdmin()
    const selectedClass = await browser.tabs.sendMessage(tab.id, { type: 'kings.gradeo.getSelectedClass' })
    const ctx = await getGradeoApiContext()
    const topicMetadataCache = new Map()
    const csvRowsCache = new Map()
    const questionMetadataCache = new Map()
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
      topicMetadataCache,
      csvRowsCache,
      questionMetadataCache,
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
    const result = await fetchKingsTrackApi('/admin/gradeo/classes', {
      method: 'POST',
      body: JSON.stringify({
        extension_version: EXTENSION_VERSION,
        classes: response.classes,
      }),
    }, {
      scope: 'class_upload',
      classCount: response.classes.length,
      source: source || response.source || 'dom',
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
      return await runLongAction(action, callback)
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

  ext.__gradeoBackgroundTest = {
    runLongAction,
    runVisibleAction,
    tickKeepAlive,
    withKeepAlive,
    getState,
    stateTest: __stateTest,
    extractTopicLabels,
    normalizeTaskKey,
    resolveTargetMarkingSessionIds,
    fetchRecentMarkingSessionNotifications,
    resolveTargetMarkingSessionIdsWithFallback,
    buildClassImportRequestBody,
    getTopicLabelsForMarkingSession,
    questionMetadataByPartId,
    getQuestionMetadataForMarkingSession,
    getCsvRowsForMarkingSession,
    rowsByStudentId,
    rowsByQuestionPartId,
    appendCsvRowsForStudent,
    getMarkingItemsForStudent,
    buildAuthoritativeQuestionRowsForStudent,
    applyAuthoritativeRowsToExamSummary,
  }

  registerMessageHandlers({
    getState,
    setState,
    runVisibleAction,
    syncStudentsApi,
    syncClassesApi,
    fetchGradeoMappings,
    importMappedClasses,
    importSingleMappedClass,
    importMappedClassTask,
    syncSchoolGroupsScrape,
    syncReportingClass,
  })
})()

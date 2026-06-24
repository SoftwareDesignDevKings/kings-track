import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const csvFixture = `"Exam","Exam ID","Class name","Class average","Student","Student ID","Copyright","Question","Question ID","Question part","Question part ID","Question link","Mark","Marks available","Answer submitted?","Feedback","Marker name","Marker ID","Marking session link","Exam mark","Syllabus title","Syllabus grade","Bands","Outcomes","Topics"
"12ENC_Cycle6","exam-1","12 encx_2026","1.6","Eamon Wong","student-1","NESA Activities","Spreadsheets","question-1","Part A","part-1","https://platform.gradeo.com.au/question/question-1","2","2","Yes","","TKS CST","marker-1","https://platform.gradeo.com.au/script/script-1","9","Enterprise Computing","12","3,4,5","EC-12-04,EC-12-08","Data Science"
"12ENC_Cycle6","exam-1","12 encx_2026","1.6","Eamon Wong","student-1","TKS2025","Spreadsheets 2","question-2","Part B","part-2","https://platform.gradeo.com.au/question/question-2","7","8","Yes","Good work","TKS CST","marker-1","https://platform.gradeo.com.au/script/script-1","9","Enterprise Computing","12","3,4","EC-12-05","Data Science"`

async function importBuilt(relativePath) {
  const url = pathToFileURL(new URL(`../dist/${relativePath}`, import.meta.url).pathname)
  await import(`${url.href}?cache=${Date.now()}-${Math.random()}`)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function encodeBase64Url(value) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64url')
}

function makeJwt(payload) {
  return [
    encodeBase64Url({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }),
    encodeBase64Url(payload),
    'test-signature',
  ].join('.')
}

function setupBrowserMock() {
  const storageData = {}
  const messageListeners = []
  let platformInfoCalls = 0

  globalThis.browser = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener)
        },
      },
      async sendMessage() {
        return undefined
      },
      async getPlatformInfo() {
        platformInfoCalls += 1
        return { os: 'mac', arch: 'x86-64' }
      },
    },
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map(item => [item, storageData[item]]))
          }
          if (typeof key === 'string') {
            return { [key]: storageData[key] }
          }
          if (key && typeof key === 'object') {
            return { ...key, ...storageData }
          }
          return { ...storageData }
        },
        async set(values) {
          Object.assign(storageData, values)
        },
      },
    },
    tabs: {
      async query() {
        return []
      },
    },
  }

  return {
    storageData,
    messageListeners,
    get platformInfoCalls() {
      return platformInfoCalls
    },
  }
}

beforeEach(() => {
  globalThis.self = globalThis
  globalThis.KingsTrackExtension = {
    async logDebug() {},
  }
  delete globalThis.browser
})

describe('Gradeo extension built utilities', () => {
  it('extracts Gradeo session details from storage, cookies, and API urls', async () => {
    await importBuilt('src/shared/gradeoSession.js')
    const ext = globalThis.KingsTrackExtension
    const token = makeJwt({
      iss: 'https://gradeo.au.auth0.com/',
      aud: ['https://api.portal.gradeo.com.au'],
      exp: 2000000000,
    })

    const result = ext.extractGradeoSessionFromSources({
      storageItems: [{ key: 'gradeo-auth', value: JSON.stringify({ access_token: token }) }],
      cookie: 'admin_user_schoolId=7572b03a-1507-4309-950e-2a286bdcf0a4',
      urls: ['https://platform.gradeo.com.au/api/school/v2/list/student/7572b03a-1507-4309-950e-2a286bdcf0a4?limit=10'],
    })

    assert.equal(result.authorization, `Bearer ${token}`)
    assert.equal(result.schoolId, '7572b03a-1507-4309-950e-2a286bdcf0a4')
    assert.equal(result.source, 'localStorage')
  })

  it('redacts captured sessions for diagnostics', async () => {
    await importBuilt('src/shared/gradeoSession.js')
    const ext = globalThis.KingsTrackExtension

    assert.deepEqual(ext.describeGradeoSession({
      authorization: 'Bearer test-token',
      schoolId: '7572b03a-1507-4309-950e-2a286bdcf0a4',
      capturedAt: '2026-06-24T00:00:00.000Z',
      source: 'fetch',
    }), {
      hasAuthorization: true,
      schoolId: '7572b03a-1507-4309-950e-2a286bdcf0a4',
      capturedAt: '2026-06-24T00:00:00.000Z',
      source: 'fetch',
      stale: false,
    })
  })

  it('prefers an automatically captured Gradeo session over manual headers', async () => {
    const mock = setupBrowserMock()
    const token = makeJwt({
      iss: 'https://gradeo.au.auth0.com/',
      aud: ['https://api.portal.gradeo.com.au'],
      exp: 2000000000,
    })
    mock.storageData.kingsTrackGradeoSession = {
      authorization: `Bearer ${token}`,
      schoolId: '7572b03a-1507-4309-950e-2a286bdcf0a4',
      capturedAt: new Date().toISOString(),
      source: 'localStorage',
    }
    mock.storageData.kingsTrackConfig = {
      frontendUrl: 'http://localhost:5173',
      gradeoApiHeadersJson: '{"Authorization":"Bearer manual"}',
    }
    await importBuilt('src/shared/config.js')
    await importBuilt('src/shared/logger.js')
    await importBuilt('src/shared/gradeoSession.js')
    await importBuilt('src/background/index.js')

    const ctx = await globalThis.KingsTrackExtension.__gradeoBackgroundTest.getGradeoApiContext()

    assert.equal(ctx.headers.Authorization, `Bearer ${token}`)
    assert.equal(ctx.schoolId, '7572b03a-1507-4309-950e-2a286bdcf0a4')
  })

  it('stores captured Gradeo sessions without logging token values', async () => {
    const mock = setupBrowserMock()
    const token = makeJwt({
      iss: 'https://gradeo.au.auth0.com/',
      aud: ['https://api.portal.gradeo.com.au'],
      exp: 2000000000,
    })
    await importBuilt('src/shared/config.js')
    await importBuilt('src/shared/logger.js')
    await importBuilt('src/shared/gradeoSession.js')
    await importBuilt('src/background/index.js')

    const response = await mock.messageListeners[0]({
      type: 'kings.gradeo.sessionCaptured',
      session: {
        authorization: `Bearer ${token}`,
        schoolId: '7572b03a-1507-4309-950e-2a286bdcf0a4',
        source: 'fetch',
      },
    })

    assert.equal(response.hasAuthorization, true)
    assert.equal(mock.storageData.kingsTrackGradeoSession.authorization, `Bearer ${token}`)
    assert.doesNotMatch(JSON.stringify(mock.storageData.kingsTrackDebugLogs || []), new RegExp(token))
  })

  it('parses Gradeo CSV rows into a student import payload', async () => {
    await importBuilt('src/shared/csv.js')
    const ext = globalThis.KingsTrackExtension

    const studentImport = ext.buildStudentImport(csvFixture, { id: 'fallback', name: 'Fallback Student' })

    assert.equal(studentImport.gradeo_student_id, 'student-1')
    assert.equal(studentImport.student_name, 'Eamon Wong')
    assert.equal(studentImport.rows.length, 2)
    assert.equal(studentImport.rows[0].gradeo_exam_id, 'exam-1')
    assert.equal(studentImport.rows[0].gradeo_marking_session_id, 'script-1')
    assert.equal(studentImport.rows[1].feedback, 'Good work')
  })

  it('stamps CSV imports with the canonical marking-session id when provided', async () => {
    await importBuilt('src/shared/csv.js')
    const ext = globalThis.KingsTrackExtension
    const [row] = ext.parseCsv(csvFixture)

    const importRow = ext.toImportRow(row, 'marking-session-1')

    assert.equal(importRow.gradeo_marking_session_id, 'marking-session-1')
    assert.equal(importRow.marking_session_link, 'https://platform.gradeo.com.au/script/script-1')
  })

  it('builds authoritative Gradeo rows from marking items over stale CSV marks', async () => {
    setupBrowserMock()
    await importBuilt('src/shared/csv.js')
    await importBuilt('src/background/index.js')
    const ext = globalThis.KingsTrackExtension
    const helpers = ext.__gradeoBackgroundTest
    const csvRows = ext.parseCsv(csvFixture).map(row => ({
      ...row,
      Mark: '',
      'Answer submitted?': 'No',
    }))
    const questionMetadataByPartId = helpers.questionMetadataByPartId([
      {
        id: 'exam-question-1',
        title: 'Project Management',
        copyrightText: 'NESA Activities',
        parts: [
          {
            id: 'part-1',
            title: 'Part A',
            metadata: {
              mark: 2,
              syllabus: { id: 'syllabus-1', title: 'Enterprise Computing', grade: 12 },
            },
          },
        ],
      },
      {
        id: 'exam-question-2',
        title: 'Spreadsheets 2',
        copyrightText: 'TKS2025',
        parts: [
          {
            id: 'part-2',
            title: 'Part B',
            metadata: {
              mark: 3,
              syllabus: { id: 'syllabus-1', title: 'Enterprise Computing', grade: 12 },
            },
          },
          {
            id: 'part-3',
            title: 'Part C',
            metadata: {
              mark: 3,
              syllabus: { id: 'syllabus-1', title: 'Enterprise Computing', grade: 12 },
            },
          },
        ],
      },
    ])
    const examRow = {
      exam_name: '12ENC_Cycle6',
      gradeo_exam_id: 'exam-1',
      gradeo_exam_session_id: 'exam-session-1',
      gradeo_marking_session_id: 'marking-session-1',
      gradeo_class_id: 'gradeo-class-1',
      class_name: '12 encx_2026',
      class_average: 5.625,
      exam_mark: null,
      marks_available: 8,
      status: 'awaiting_marking',
      answer_submitted: true,
      syllabus_id: 'syllabus-1',
      syllabus_title: 'Enterprise Computing',
      syllabus_grade: '12',
    }
    const rows = helpers.buildAuthoritativeQuestionRowsForStudent({
      examRow,
      markingItems: [
        {
          partId: 'part-1',
          examAnswerSheetItem: { partId: 'part-1' },
          markingSessionMarkingItem: {
            partId: 'part-1',
            mark: 0,
            isSubmitted: true,
            answerNotSubmitted: false,
            feedbackText: 'Needs work',
            markerId: 'marker-1',
            markerFirstName: 'TKS',
            markerLastName: 'CST',
          },
        },
        {
          partId: 'part-2',
          examAnswerSheetItem: { partId: 'part-2' },
          markingSessionMarkingItem: {
            partId: 'part-2',
            mark: 1,
            isSubmitted: true,
            answerNotSubmitted: false,
            markerId: 'marker-1',
            markerFirstName: 'TKS',
            markerLastName: 'CST',
          },
        },
        {
          partId: 'part-3',
          examAnswerSheetItem: { partId: 'part-3' },
          markingSessionMarkingItem: {
            partId: 'part-3',
            mark: 3,
            isSubmitted: true,
            answerNotSubmitted: false,
            markerId: 'marker-1',
            markerFirstName: 'TKS',
            markerLastName: 'CST',
          },
        },
      ],
      questionMetadataByPartId,
      csvRowsByPartId: helpers.rowsByQuestionPartId(csvRows),
    })
    const summary = helpers.applyAuthoritativeRowsToExamSummary(examRow, rows)

    assert.deepEqual(rows.map(row => row.mark), [0, 1, 3])
    assert.deepEqual(rows.map(row => row.answer_submitted), [true, true, true])
    assert.deepEqual(rows.map(row => row.marks_available), [2, 3, 3])
    assert.equal(rows[0].topics, 'Data Science')
    assert.equal(rows[2].topics, null)
    assert.equal(rows[0].feedback, 'Needs work')
    assert.equal(summary.status, 'scored')
    assert.equal(summary.exam_mark, 4)
    assert.equal(summary.marks_available, 8)
  })

  it('resolves targeted task syncs and builds scoped import payloads', async () => {
    setupBrowserMock()
    await importBuilt('src/background/index.js')
    const helpers = globalThis.KingsTrackExtension.__gradeoBackgroundTest
    const sessions = [
      { markingSessionId: '11111111-1111-1111-1111-111111111111', examTitle: '11ENC_Cycle4' },
      { markingSessionId: '22222222-2222-2222-2222-222222222222', examTitle: '11ENC_Cycle5' },
    ]

    assert.deepEqual(
      helpers.resolveTargetMarkingSessionIds(sessions, '11111111-1111-1111-1111-111111111111', []),
      { ids: ['11111111-1111-1111-1111-111111111111'], error: null },
    )
    assert.deepEqual(
      helpers.resolveTargetMarkingSessionIds(sessions, '11 ENC Cycle 5', []),
      { ids: ['22222222-2222-2222-2222-222222222222'], error: null },
    )
    assert.match(
      helpers.resolveTargetMarkingSessionIds(sessions, 'missing task', []).error,
      /Task not found/,
    )
    assert.match(
      helpers.resolveTargetMarkingSessionIds(
        [...sessions, { markingSessionId: '33333333-3333-3333-3333-333333333333', examTitle: '11ENC Cycle5' }],
        '11ENC_Cycle5',
        [],
      ).error,
      /Task is ambiguous/,
    )

    const payload = JSON.parse(helpers.buildClassImportRequestBody({
      classId: 'class-1',
      className: '2026_11encx',
      scope: 'marking_sessions',
      scopeMarkingSessionIds: ['session-1', 'session-1', 'session-2'],
      uploadStudents: [{ gradeo_student_id: 'student-1', student_name: 'Eamon Wong' }],
    }))
    assert.equal(payload.import_scope, 'marking_sessions')
    assert.deepEqual(payload.scope_marking_session_ids, ['session-1', 'session-2'])
    assert.equal(payload.students.length, 1)
  })

  it('falls back to Gradeo notifications when a targeted task is missing from student results', async () => {
    setupBrowserMock()
    await importBuilt('src/background/index.js')
    const helpers = globalThis.KingsTrackExtension.__gradeoBackgroundTest
    const originalFetch = globalThis.fetch
    const markingSessionId = '0d3d4db5-fa38-4b1a-bcd1-bdd76506376d'

    globalThis.fetch = async url => {
      assert.match(String(url), /\/api\/notification\/\?limit=100&offset=0$/)
      return new Response(JSON.stringify({
        pgn: { total: 1 },
        list: [
          {
            id: 'notification-1',
            type: 'MARKING_SESSION_FINISHED',
            createdDate: '2026-05-18T03:22:49.915Z',
            content: {
              markingSessionId,
              examTitle: '12SEN_Cycle9',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    try {
      const resolved = await helpers.resolveTargetMarkingSessionIdsWithFallback(
        { baseUrl: 'https://platform.gradeo.com.au', headers: {} },
        [],
        '12SEN_Cycle9',
        [],
      )

      assert.equal(resolved.error, null)
      assert.deepEqual(resolved.ids, [markingSessionId])
      assert.equal(resolved.fallbackSessions[0].examTitle, '12SEN_Cycle9')
    } finally {
      globalThis.fetch = originalFetch
    }

    const uuidResolved = await helpers.resolveTargetMarkingSessionIdsWithFallback(
      { baseUrl: 'https://platform.gradeo.com.au', headers: {} },
      [],
      '11111111-1111-1111-1111-111111111111',
      [],
    )
    assert.equal(uuidResolved.error, null)
    assert.deepEqual(uuidResolved.ids, ['11111111-1111-1111-1111-111111111111'])
  })

  it('extracts Gradeo student IDs and emails from the school-students page', async () => {
    const dom = new JSDOM(`
      <table>
        <tbody>
          <tr>
            <td>Eamon Wong</td>
            <td>eamon@kings.edu.au</td>
            <td><a href="/admin/schoolStudents/215e30a9-2da4-4bef-b008-b3ceb8b520df">Open</a></td>
          </tr>
          <tr>
            <td>Hayden Foxwell</td>
            <td>hayden@kings.edu.au</td>
            <td data-student-id="b7dc1fd5-17cf-4307-a260-e6cae356e3d7">Profile</td>
          </tr>
        </tbody>
      </table>
    `)
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.Element = dom.window.Element

    await importBuilt('src/content/schoolStudents.parsers.js')
    const students = globalThis.KingsTrackExtension.extractStudentDirectoryFromDocument(dom.window.document)

    assert.deepEqual(students, [
      {
        gradeo_student_id: '215e30a9-2da4-4bef-b008-b3ceb8b520df',
        name: 'Eamon Wong',
        email: 'eamon@kings.edu.au',
      },
      {
        gradeo_student_id: 'b7dc1fd5-17cf-4307-a260-e6cae356e3d7',
        name: 'Hayden Foxwell',
        email: 'hayden@kings.edu.au',
      },
    ])
  })

  it('walks a selected class and emits per-student progress during reporting sync', async () => {
    await importBuilt('src/shared/csv.js')
    await importBuilt('src/content/reporting.sync.js')
    const ext = globalThis.KingsTrackExtension

    const selectedStudents = []
    const progressEvents = []
    const result = await ext.runReportingSync({
      async getSelectedClass() {
        return { id: 'gradeo-class-1', name: '12 encx_2026' }
      },
      async listStudents() {
        return [
          { id: 'student-1', name: 'Eamon Wong' },
          { id: 'student-2', name: 'Noah Ould' },
        ]
      },
      async selectStudent(student) {
        selectedStudents.push(student.name)
      },
      async collectCurrentStudentImport({ student }) {
        return ext.buildStudentImport(
          csvFixture.replaceAll('"student-1"', `"${student.id}"`).replaceAll('"Eamon Wong"', `"${student.name}"`),
          student,
        )
      },
      onProgress(progress) {
        progressEvents.push(progress)
      },
    })

    assert.deepEqual(selectedStudents, ['Eamon Wong', 'Noah Ould'])
    assert.equal(result.gradeo_class_id, 'gradeo-class-1')
    assert.equal(result.students.length, 2)
    assert.deepEqual(
      {
        phase: progressEvents[0].phase,
        current: progressEvents[0].current,
        total: progressEvents[0].total,
      },
      { phase: 'exporting_student', current: 1, total: 2 },
    )
    assert.equal(progressEvents.at(-1).phase, 'class_ready')
  })

  it('keeps the background worker alive while a long action is running', async () => {
    const browserMock = setupBrowserMock()
    await importBuilt('src/background/index.js')
    const helpers = globalThis.KingsTrackExtension.__gradeoBackgroundTest

    const result = await helpers.withKeepAlive(
      'import_mapped_classes',
      () => delay(25).then(() => 'ok'),
      { heartbeatMs: 5 },
    )

    assert.equal(result, 'ok')
    assert.ok(browserMock.platformInfoCalls >= 2)
    const callsAfterCompletion = browserMock.platformInfoCalls
    await delay(20)
    assert.equal(browserMock.platformInfoCalls, callsAfterCompletion)
  })

  it('returns the running state instead of starting a duplicate long action', async () => {
    setupBrowserMock()
    await importBuilt('src/background/index.js')
    const helpers = globalThis.KingsTrackExtension.__gradeoBackgroundTest
    let finish

    const first = helpers.runVisibleAction(
      'import_mapped_classes',
      () => new Promise(resolve => {
        finish = () => resolve('done')
      }),
    )
    await delay(0)

    const duplicate = await helpers.runVisibleAction('import_mapped_classes', async () => {
      throw new Error('duplicate callback should not run')
    })

    assert.equal(duplicate.status, 'running')
    assert.equal(duplicate.activeJob.action, 'import_mapped_classes')
    finish()
    assert.equal(await first, 'done')
  })

  it('writes an error state when a visible long action fails', async () => {
    const browserMock = setupBrowserMock()
    await importBuilt('src/background/index.js')
    const helpers = globalThis.KingsTrackExtension.__gradeoBackgroundTest

    await assert.rejects(
      helpers.runVisibleAction('import_mapped_classes', async () => {
        throw new Error('Gradeo exploded')
      }),
      /Gradeo exploded/,
    )

    const state = browserMock.storageData.kingsTrackSyncState
    assert.equal(state.status, 'error')
    assert.equal(state.action, 'import_mapped_classes')
    assert.equal(state.message, 'Gradeo exploded')
    assert.equal(state.activeJob, undefined)
  })

  it('marks a running state from an old worker as interrupted', async () => {
    const browserMock = setupBrowserMock()
    browserMock.storageData.kingsTrackSyncState = {
      status: 'importing_class',
      action: 'import_mapped_classes',
      activeJob: {
        action: 'import_mapped_classes',
        startedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        workerInstanceId: 'previous-worker',
      },
    }
    await importBuilt('src/background/index.js')
    const helpers = globalThis.KingsTrackExtension.__gradeoBackgroundTest

    const state = await helpers.getState()

    assert.equal(state.status, 'error')
    assert.equal(state.action, 'import_mapped_classes')
    assert.equal(state.interrupted, true)
    assert.match(state.message, /background worker restarted/)
  })
})

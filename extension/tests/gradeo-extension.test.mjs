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
  it('parses Gradeo CSV rows into a student import payload', async () => {
    await importBuilt('src/shared/csv.js')
    const ext = globalThis.KingsTrackExtension

    const studentImport = ext.buildStudentImport(csvFixture, { id: 'fallback', name: 'Fallback Student' })

    assert.equal(studentImport.gradeo_student_id, 'student-1')
    assert.equal(studentImport.student_name, 'Eamon Wong')
    assert.equal(studentImport.rows.length, 2)
    assert.equal(studentImport.rows[0].gradeo_exam_id, 'exam-1')
    assert.equal(studentImport.rows[1].feedback, 'Good work')
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

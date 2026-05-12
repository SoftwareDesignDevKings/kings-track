import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const csvFixture = `"Exam","Exam ID","Class name","Class average","Student","Student ID","Copyright","Question","Question ID","Question part","Question part ID","Question link","Mark","Marks available","Answer submitted?","Feedback","Marker name","Marker ID","Marking session link","Exam mark","Syllabus title","Syllabus grade","Bands","Outcomes","Topics"
"12ENC_Cycle6","exam-1","12 encx_2026","1.6","Eamon Wong","student-1","NESA Activities","Spreadsheets","question-1","Part A","part-1","https://platform.gradeo.com.au/question/question-1","2","2","Yes","","TKS CST","marker-1","https://platform.gradeo.com.au/script/script-1","9","Enterprise Computing","12","3,4,5","EC-12-04,EC-12-08","Data Science"
"12ENC_Cycle6","exam-1","12 encx_2026","1.6","Eamon Wong","student-1","TKS2025","Spreadsheets 2","question-2","Part B","part-2","https://platform.gradeo.com.au/question/question-2","7","8","Yes","Good work","TKS CST","marker-1","https://platform.gradeo.com.au/script/script-1","9","Enterprise Computing","12","3,4","EC-12-05","Data Science"`

describe('Gradeo extension utilities', () => {
  const originalFetch = globalThis.fetch
  const originalBrowser = (globalThis as any).browser

  beforeEach(() => {
    vi.resetModules()
    vi.useRealTimers()
    ;(globalThis as any).KingsTrackExtension = {}
    ;(globalThis as any).browser = undefined
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
    ;(globalThis as any).browser = originalBrowser
  })

  it('parses Gradeo CSV rows into a student import payload', async () => {
    await import('../../../extension/src/shared/csv.js')
    const ext = (globalThis as any).KingsTrackExtension

    const studentImport = ext.buildStudentImport(csvFixture, { id: 'fallback', name: 'Fallback Student' })

    expect(studentImport.gradeo_student_id).toBe('student-1')
    expect(studentImport.student_name).toBe('Eamon Wong')
    expect(studentImport.rows).toHaveLength(2)
    expect(studentImport.rows[0].gradeo_exam_id).toBe('exam-1')
    expect(studentImport.rows[1].feedback).toBe('Good work')
  })

  it('extracts Gradeo student IDs and emails from the school-students page', async () => {
    document.body.innerHTML = `
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
    `

    await import('../../../extension/src/content/schoolStudents.parsers.js')
    const ext = (globalThis as any).KingsTrackExtension
    const students = ext.extractStudentDirectoryFromDocument(document)

    expect(students).toEqual([
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
    await import('../../../extension/src/shared/csv.js')
    await import('../../../extension/src/content/reporting.sync.js')
    const ext = (globalThis as any).KingsTrackExtension

    const selectedStudents: string[] = []
    const progressEvents: any[] = []
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
      async selectStudent(student: { name: string }) {
        selectedStudents.push(student.name)
      },
      async collectCurrentStudentImport({ student }: { student: { id: string; name: string } }) {
        return ext.buildStudentImport(
          csvFixture.replaceAll('"student-1"', `"${student.id}"`).replaceAll('"Eamon Wong"', `"${student.name}"`),
          student,
        )
      },
      onProgress(progress: any) {
        progressEvents.push(progress)
      },
    })

    expect(selectedStudents).toEqual(['Eamon Wong', 'Noah Ould'])
    expect(result.gradeo_class_id).toBe('gradeo-class-1')
    expect(result.students).toHaveLength(2)
    expect(progressEvents[0]).toMatchObject({ phase: 'exporting_student', current: 1, total: 2 })
    expect(progressEvents.at(-1)).toMatchObject({ phase: 'class_ready', current: 2, total: 2 })
  })

  it('extracts and caches Gradeo marking-session topic metadata', async () => {
    ;(globalThis as any).KingsTrackExtension = {
      logDebug: vi.fn().mockResolvedValue(undefined),
    }
    ;(globalThis as any).browser = {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
        },
      },
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: vi.fn().mockResolvedValue({
        examSummary: {
          topicLabels: [
            { id: 'topic-1', text: 'Secure Software Architecture' },
            { id: 'topic-2', text: 'Programming for the Web' },
            { id: 'blank', text: '   ' },
          ],
        },
      }),
    }) as unknown as typeof fetch

    await import('../../../extension/src/background/index.js')
    const ext = (globalThis as any).KingsTrackExtension
    const cache = new Map()
    const ctx = {
      baseUrl: 'https://platform.gradeo.com.au',
      headers: { Authorization: 'Bearer test' },
    }

    const first = await ext.__gradeoBackgroundTest.getTopicLabelsForMarkingSession(ctx, 'marking-session-1', cache)
    const second = await ext.__gradeoBackgroundTest.getTopicLabelsForMarkingSession(ctx, 'marking-session-1', cache)

    expect(first).toEqual(['Secure Software Architecture', 'Programming for the Web'])
    expect(second).toEqual(first)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://platform.gradeo.com.au/api/marking-session/summary/metadata/marking-session-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('falls back to empty Gradeo topics when marking-session metadata fails', async () => {
    const logDebug = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as any).KingsTrackExtension = { logDebug }
    ;(globalThis as any).browser = {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
        },
      },
    }
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Gradeo unavailable')) as unknown as typeof fetch

    await import('../../../extension/src/background/index.js')
    const ext = (globalThis as any).KingsTrackExtension
    const topics = await ext.__gradeoBackgroundTest.getTopicLabelsForMarkingSession(
      {
        baseUrl: 'https://platform.gradeo.com.au',
        headers: { Authorization: 'Bearer test' },
      },
      'marking-session-2',
      new Map(),
    )

    expect(topics).toEqual([])
    expect(logDebug).toHaveBeenCalledWith(
      'background',
      'gradeo_marking_session_metadata_failed',
      expect.objectContaining({ markingSessionId: 'marking-session-2' }),
    )
  })

  it('fetches and groups Gradeo CSV rows once per marking session', async () => {
    ;(globalThis as any).KingsTrackExtension = {
      logDebug: vi.fn().mockResolvedValue(undefined),
    }
    ;(globalThis as any).browser = {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
        },
      },
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: vi.fn().mockResolvedValue(csvFixture),
    }) as unknown as typeof fetch

    await import('../../../extension/src/shared/csv.js')
    await import('../../../extension/src/background/index.js')
    const ext = (globalThis as any).KingsTrackExtension
    const cache = new Map()
    const ctx = {
      baseUrl: 'https://platform.gradeo.com.au',
      headers: { Authorization: 'Bearer test' },
    }

    const first = await ext.__gradeoBackgroundTest.getCsvRowsForMarkingSession(ctx, 'marking-session-1', cache)
    const second = await ext.__gradeoBackgroundTest.getCsvRowsForMarkingSession(ctx, 'marking-session-1', cache)

    expect(second).toBe(first)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(first.get('student-1')).toHaveLength(2)

    const importStudent: any = {
      gradeo_student_id: 'student-1',
      student_name: 'Eamon Wong',
      rows: [],
      exam_rows: [],
    }
    const attached = ext.__gradeoBackgroundTest.appendCsvRowsForStudent(importStudent, first)
    expect(attached).toBe(2)
    expect(importStudent.rows.map((row: any) => row.gradeo_question_part_id)).toEqual(['part-1', 'part-2'])
    expect(importStudent.rows[0].topics).toBe('Data Science')
  })

  it('falls back to empty Gradeo CSV rows when CSV enrichment fails', async () => {
    const logDebug = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as any).KingsTrackExtension = { logDebug }
    ;(globalThis as any).browser = {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
        },
      },
    }
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('CSV unavailable')) as unknown as typeof fetch

    await import('../../../extension/src/shared/csv.js')
    await import('../../../extension/src/background/index.js')
    const ext = (globalThis as any).KingsTrackExtension
    const rows = await ext.__gradeoBackgroundTest.getCsvRowsForMarkingSession(
      {
        baseUrl: 'https://platform.gradeo.com.au',
        headers: { Authorization: 'Bearer test' },
      },
      'marking-session-2',
      new Map(),
    )

    expect(rows).toBeInstanceOf(Map)
    expect(rows.size).toBe(0)
    expect(logDebug).toHaveBeenCalledWith(
      'background',
      'gradeo_marking_session_csv_failed',
      expect.objectContaining({ markingSessionId: 'marking-session-2' }),
    )
  })

  it('times out a stalled backend request instead of waiting forever', async () => {
    vi.useFakeTimers()
    ;(globalThis as any).KingsTrackExtension = {
      getConfig: vi.fn().mockResolvedValue({
        apiBaseUrl: 'https://kings-track.test/api',
        extensionApiKey: 'extension-key',
        apiTimeoutMs: 1000,
      }),
    }

    globalThis.fetch = vi.fn((_url: string, options?: RequestInit) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        reject(options.signal?.reason || new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })) as typeof fetch

    await import('../../../extension/src/shared/auth.js')
    const ext = (globalThis as any).KingsTrackExtension

    const request = ext.fetchApi('/auth/me', { timeoutMs: 1000 })
    const rejection = expect(request).rejects.toThrow(/timed out/i)

    await vi.advanceTimersByTimeAsync(1100)

    await rejection
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://kings-track.test/api/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Extension-Api-Key': 'extension-key',
        }),
      }),
    )
  })
})

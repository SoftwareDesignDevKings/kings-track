// Paste into the browser console on https://platform.gradeo.com.au/.
// It stores output in window.__gradeoDiagnostics.gradeoSourceData and tries to copy JSON for easy sharing.
(async () => {
  const markingSessionId = String(prompt('Gradeo marking_session_id from Kings Track report?') || '').trim()
  const studentNameFilter = String(prompt('Student name contains?', '') || '').toLowerCase()

  if (!markingSessionId) {
    throw new Error('A marking session id is required.')
  }

  function parseCsv(text) {
    const rows = []
    let row = []
    let cell = ''
    let quoted = false

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]
      const next = text[index + 1]

      if (char === '"') {
        if (quoted && next === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = !quoted
        }
      } else if (char === ',' && !quoted) {
        row.push(cell)
        cell = ''
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') {
          index += 1
        }
        row.push(cell)
        if (row.some(Boolean)) {
          rows.push(row)
        }
        row = []
        cell = ''
      } else {
        cell += char
      }
    }

    if (cell || row.length) {
      row.push(cell)
      rows.push(row)
    }

    const [header, ...data] = rows
    if (!header) {
      return []
    }
    return data.map(values => Object.fromEntries(header.map((key, index) => [key, values[index] || ''])))
  }

  async function getJson(path) {
    const response = await fetch(path, { credentials: 'include' })
    if (!response.ok) {
      return { error: `${path} failed with ${response.status}`, text: await response.text() }
    }
    return response.json()
  }

  const [csvResponse, studentState, aggregate, metadata] = await Promise.all([
    fetch(`/api/statistics-marking-session/download-csv/${encodeURIComponent(markingSessionId)}/`, {
      credentials: 'include',
    }),
    getJson(`/api/exam-process/aggregated/state/marking/student/${encodeURIComponent(markingSessionId)}`),
    getJson(`/api/exam-process/aggregated/state/marking/${encodeURIComponent(markingSessionId)}`),
    getJson(`/api/marking-session/summary/metadata/${encodeURIComponent(markingSessionId)}`),
  ])

  const csvText = await csvResponse.text()
  if (!csvResponse.ok) {
    throw new Error(`CSV download failed with ${csvResponse.status}: ${csvText}`)
  }

  const csvRows = parseCsv(csvText)
  const rows = csvRows
    .filter(row => !studentNameFilter || String(row.Student || '').toLowerCase().includes(studentNameFilter))
    .map(row => ({
      student: row.Student,
      student_id: row['Student ID'],
      exam: row.Exam,
      exam_id: row['Exam ID'],
      marking_session_link: row['Marking session link'],
      question_part_id: row['Question part ID'],
      question: row.Question,
      part: row['Question part'],
      answer_submitted: row['Answer submitted?'],
      mark: row.Mark,
      marks_available: row['Marks available'],
      exam_mark: row['Exam mark'],
      marker: row['Marker name'],
    }))

  const byStudent = Object.values(rows.reduce((grouped, row) => {
    const key = `${row.student} (${row.student_id})`
    grouped[key] ||= {
      student: key,
      rows: 0,
      submitted: 0,
      unmarked_submitted: 0,
      computed_mark: 0,
      computed_available: 0,
      marks: [],
    }
    const summary = grouped[key]
    const submitted = /^yes|true|1|submitted$/i.test(String(row.answer_submitted || ''))
    const mark = row.mark === '' ? null : Number(row.mark)
    const available = row.marks_available === '' ? null : Number(row.marks_available)

    summary.rows += 1
    if (submitted) {
      summary.submitted += 1
    }
    if (submitted && mark == null && (available == null || available > 0)) {
      summary.unmarked_submitted += 1
    }
    summary.computed_mark += Number(mark) || 0
    summary.computed_available += Number(available) || 0
    summary.marks.push(`${row.question_part_id}:${row.mark || 'null'}/${row.marks_available || 'null'}`)
    return grouped
  }, {}))

  const output = {
    generated_at: new Date().toISOString(),
    marking_session_id: markingSessionId,
    student_filter: studentNameFilter,
    csv_row_count: csvRows.length,
    filtered_row_count: rows.length,
    by_student: byStudent,
    filtered_csv_rows: rows,
    endpoint_snapshots: {
      student_state: studentState,
      aggregate,
      metadata,
    },
    interpretation_flags: {
      csv_has_filtered_rows: rows.length > 0,
      csv_has_unmarked_submitted_rows: byStudent.some(row => row.unmarked_submitted > 0),
      csv_all_filtered_submitted_rows_marked: byStudent.some(row => row.submitted > 0) &&
        byStudent.every(row => row.unmarked_submitted === 0),
    },
  }

  globalThis.__gradeoDiagnostics ||= {}
  globalThis.__gradeoDiagnostics.gradeoSourceData = output

  console.log('CSV row count:', output.csv_row_count)
  console.table(output.by_student)
  console.log('Filtered CSV rows:', output.filtered_csv_rows)
  console.log('Student state endpoint:', output.endpoint_snapshots.student_state)
  console.log('Aggregate endpoint:', output.endpoint_snapshots.aggregate)
  console.log('Metadata endpoint:', output.endpoint_snapshots.metadata)
  console.log('Interpretation flags:', output.interpretation_flags)
  console.log('Full diagnostic object:', output)

  const json = JSON.stringify(output, null, 2)
  if (typeof copy === 'function') {
    copy(json)
    console.log('Copied diagnostic JSON with DevTools copy().')
  } else if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(json)
    console.log('Copied diagnostic JSON to clipboard.')
  } else {
    console.log('Copy this JSON:', json)
  }
})().catch(error => {
  console.error('Gradeo source diagnostic failed:', error)
})


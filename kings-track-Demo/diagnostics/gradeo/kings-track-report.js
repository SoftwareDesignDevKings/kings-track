// Paste into the browser console on https://kings-track.onrender.com/.
// It stores output in window.__gradeoDiagnostics.kingsTrackReport and tries to copy JSON for easy sharing.
(async () => {
  const API = 'https://kings-track.onrender.com/api'
  const COURSE_ID =
    location.pathname.match(/courses\/(\d+)/)?.[1] ||
    prompt('Canvas/Kings Track course id?', '13504')
  const cycle = String(prompt('Exam name contains?', 'Cycle4') || '').toLowerCase()
  const studentFilter = String(
    prompt('Student name contains? Leave blank for all affected rows.', '') || '',
  ).toLowerCase()

  const tokenKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
  const rawSession = tokenKey ? localStorage.getItem(tokenKey) : null
  const session = rawSession ? JSON.parse(rawSession) : null
  const auth = { Authorization: `Bearer ${session?.access_token || ''}` }

  const fetchJson = async path => {
    const response = await fetch(`${API}${path}`, { headers: auth, cache: 'no-store' })
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok) {
      throw new Error(`${path} failed with ${response.status}: ${await response.text()}`)
    }
    if (!contentType.includes('application/json')) {
      throw new Error(`${path} returned ${contentType || 'unknown content type'}`)
    }
    return response.json()
  }

  const [report, runs] = await Promise.all([
    fetchJson(`/courses/${encodeURIComponent(COURSE_ID)}/gradeo`),
    fetchJson('/admin/gradeo/import-runs'),
  ])

  const exams = (report.exams || []).filter(exam => String(exam.name || '').toLowerCase().includes(cycle))
  const gradeoClassIds = new Set((report.gradeo_classes || []).map(item => item.gradeo_class_id))
  const rows = []

  for (const exam of exams) {
    for (const student of report.students || []) {
      if (studentFilter && !String(student.name || '').toLowerCase().includes(studentFilter)) {
        continue
      }
      const result = student.results?.[exam.id]
      if (!result) {
        continue
      }

      const questions = result.questions || []
      const submitted = questions.filter(question => question.answer_submitted)
      const unmarked = submitted.filter(
        question => question.mark == null && (question.marks_available == null || question.marks_available > 0),
      )
      const computedMark = submitted.reduce((sum, question) => sum + (Number(question.mark) || 0), 0)
      const computedAvailable = questions.reduce((sum, question) => sum + (Number(question.marks_available) || 0), 0)

      rows.push({
        exam: exam.name,
        marking_session_id: exam.id,
        student: student.name,
        api_status: result.status,
        api_exam_mark: result.exam_mark,
        api_marks_available: result.marks_available,
        question_rows: questions.length,
        submitted_rows: submitted.length,
        unmarked_submitted_rows: unmarked.length,
        computed_mark: computedMark,
        computed_available: computedAvailable,
        contradiction:
          result.status === 'awaiting_marking' &&
          result.exam_mark == null &&
          submitted.length > 0 &&
          unmarked.length === 0,
        question_ids: questions.map(question => question.gradeo_question_part_id).join(', '),
      })
    }
  }

  const duplicateExamNames = Object.values(
    (report.exams || []).reduce((grouped, exam) => {
      const key = String(exam.name || '').toLowerCase()
      grouped[key] ||= { exam: exam.name, sessions: [] }
      grouped[key].sessions.push(exam.id)
      return grouped
    }, {}),
  ).filter(group => group.sessions.length > 1)

  const output = {
    generated_at: new Date().toISOString(),
    course_summary: {
      courseId: COURSE_ID,
      mapped: report.mapped,
      gradeo_class_name: report.gradeo_class_name,
      gradeo_classes: report.gradeo_classes,
      last_imported_at: report.last_imported_at,
      hidden_students_count: report.hidden_students_count,
      unmatched_students_count: report.unmatched_students_count,
    },
    recent_matching_import_runs: runs
      .filter(run => gradeoClassIds.has(run.gradeo_class_id))
      .slice(0, 10)
      .map(run => ({
        id: run.id,
        status: run.status,
        class: run.gradeo_class_name,
        processed: run.processed_students,
        matched: run.matched_students,
        exams: run.imported_exams,
        question_results: run.imported_question_results,
        unmatched: run.unmatched_students,
        completed_at: run.completed_at,
        error: run.error_message,
      })),
    duplicate_exam_names: duplicateExamNames,
    affected_report_rows: rows,
    interpretation_flags: {
      api_has_stale_contradiction: rows.some(row => row.contradiction),
      missing_question_rows: rows.some(row => row.question_rows === 0),
      gradeo_still_unmarked: rows.some(row => row.unmarked_submitted_rows > 0),
      api_scored_rows: rows.some(row => row.api_status === 'scored'),
    },
  }

  globalThis.__gradeoDiagnostics ||= {}
  globalThis.__gradeoDiagnostics.kingsTrackReport = output

  console.log('Course summary:', output.course_summary)
  console.log('Recent matching import runs:')
  console.table(output.recent_matching_import_runs)
  console.log('Duplicate exam names:')
  console.table(output.duplicate_exam_names)
  console.log('Affected report rows:')
  console.table(output.affected_report_rows)
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
  console.error('Gradeo Kings Track diagnostic failed:', error)
})


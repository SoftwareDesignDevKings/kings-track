function stripNilValues(object: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value != null)
  )
}

function compactExamSummaryRow(row: Record<string, any>) {
  return stripNilValues({
    exam_name: row.exam_name,
    gradeo_exam_id: row.gradeo_exam_id,
    gradeo_exam_session_id: row.gradeo_exam_session_id || undefined,
    gradeo_marking_session_id: row.gradeo_marking_session_id || undefined,
    exam_mark: row.exam_mark,
    marks_available: row.marks_available,
    status: row.status,
    answer_submitted: row.answer_submitted,
    syllabus_id: row.syllabus_id || undefined,
    syllabus_title: row.syllabus_title || undefined,
    syllabus_grade: row.syllabus_grade || undefined,
    class_average: row.class_average,
    marking_session_id: row.marking_session_id || undefined,
    exam_answer_sheet_id: row.exam_answer_sheet_id || undefined,
    exam_session_start_date: row.exam_session_start_date || undefined,
    exam_session_max_time_seconds: row.exam_session_max_time_seconds,
    student_group_mark_average: row.student_group_mark_average,
    bands: Array.isArray(row.bands) && row.bands.length > 0 ? row.bands : undefined,
    outcomes: Array.isArray(row.outcomes) && row.outcomes.length > 0 ? row.outcomes : undefined,
    topics: Array.isArray(row.topics) && row.topics.length > 0 ? row.topics : undefined,
  })
}

export function compactImportStudent(student: Record<string, any>) {
  const compacted: any = {
    gradeo_student_id: student.gradeo_student_id,
    student_name: student.student_name,
  }
  if (Array.isArray(student.rows) && student.rows.length > 0) {
    compacted.rows = student.rows
  }
  if (Array.isArray(student.exam_rows) && student.exam_rows.length > 0) {
    compacted.exam_rows = student.exam_rows.map(compactExamSummaryRow)
  }
  return compacted
}

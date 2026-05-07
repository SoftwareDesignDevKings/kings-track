(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension

  function parseCsv(text) {
    const rows = []
    let row = []
    let cell = ''
    let inQuotes = false

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]
      const next = text[index + 1]

      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = !inQuotes
        }
        continue
      }

      if (char === ',' && !inQuotes) {
        row.push(cell)
        cell = ''
        continue
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') {
          index += 1
        }
        row.push(cell)
        if (row.some(value => value !== '')) {
          rows.push(row)
        }
        row = []
        cell = ''
        continue
      }

      cell += char
    }

    if (cell !== '' || row.length) {
      row.push(cell)
      rows.push(row)
    }

    const [header, ...dataRows] = rows
    if (!header) {
      return []
    }

    return dataRows.map(values => Object.fromEntries(header.map((key, idx) => [key, values[idx] || ''])))
  }

  function toImportRow(row) {
    const markingSessionLink = row['Marking session link']
    const markingSessionId = String(markingSessionLink || '').split('/').filter(Boolean).pop() || null
    return {
      exam_name: row.Exam,
      gradeo_exam_id: row['Exam ID'],
      gradeo_exam_session_id: null,
      gradeo_marking_session_id: markingSessionId,
      gradeo_class_id: null,
      class_name: row['Class name'],
      class_average: row['Class average'],
      syllabus_id: null,
      question: row.Question,
      gradeo_question_id: row['Question ID'],
      question_part: row['Question part'],
      gradeo_question_part_id: row['Question part ID'],
      question_link: row['Question link'],
      mark: row.Mark,
      marks_available: row['Marks available'],
      answer_submitted: row['Answer submitted?'],
      feedback: row.Feedback,
      marker_name: row['Marker name'],
      marker_id: row['Marker ID'],
      marking_session_link: markingSessionLink,
      exam_mark: row['Exam mark'],
      syllabus_title: row['Syllabus title'],
      syllabus_grade: row['Syllabus grade'],
      bands: row.Bands,
      outcomes: row.Outcomes,
      topics: row.Topics,
      copyright_notice: row.Copyright,
    }
  }

  function buildStudentImportFromRows(rows, fallbackStudent) {
    const firstRow = rows[0] || {}
    return {
      gradeo_student_id: firstRow['Student ID'] || fallbackStudent.id,
      student_name: firstRow.Student || fallbackStudent.name,
      rows: rows.map(toImportRow),
    }
  }

  function buildStudentImport(csvText, fallbackStudent) {
    const rows = parseCsv(csvText)
    return buildStudentImportFromRows(rows, fallbackStudent)
  }

  ext.parseCsv = parseCsv
  ext.toImportRow = toImportRow
  ext.buildStudentImportFromRows = buildStudentImportFromRows
  ext.buildStudentImport = buildStudentImport
})()

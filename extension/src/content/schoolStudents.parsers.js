(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension

  const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
  const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  const ACTION_LABEL_RE = /\b(open|profile|view|edit|details)\b/gi

  function isVisible(node) {
    if (!node || !(node instanceof Element)) {
      return false
    }

    const style = window.getComputedStyle(node)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false
    }

    const rect = node.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0) {
      return true
    }

    const userAgent = node.ownerDocument?.defaultView?.navigator?.userAgent || ''
    return /jsdom/i.test(userAgent)
  }

  function getActiveStudentTable(doc) {
    const tables = Array.from(
      doc.querySelectorAll(
        '.RaDatagrid-table, .RaDatagrid-root table, .RaDatagrid-tableWrapper table, table'
      )
    )

    const ranked = tables
      .map(table => {
        const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
        const visibleRows = bodyRows.filter(isVisible)
        return {
          table,
          score: visibleRows.length || bodyRows.length,
          visibleRows,
        }
      })
      .filter(entry => entry.score > 0 && isVisible(entry.table))
      .sort((left, right) => right.score - left.score)

    return ranked[0]?.table || null
  }

  function getCellTexts(row) {
    const selectorMatches = Array.from(row.querySelectorAll('td, th, [role="cell"], [role="gridcell"]'))
      .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    if (selectorMatches.length > 0) {
      return selectorMatches
    }

    const directChildren = Array.from(row.children)
      .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    if (directChildren.length > 0) {
      return directChildren
    }

    return []
  }

  function extractStudentFromRow(row) {
    const cells = getCellTexts(row)
    if (cells.length === 0) {
      return null
    }

    const headerSignature = cells.join('').toLowerCase()
    if (headerSignature.includes('idemailfirstnamelastname')) {
      return null
    }

    const emailCell = cells.find(value => EMAIL_RE.test(value))
    const emailMatch = emailCell?.match(EMAIL_RE)
    const idCell = cells.find(value => UUID_RE.test(value))
    const idMatch = idCell?.match(UUID_RE) || Array.from(row.querySelectorAll('[href], [data-id], [data-student-id]'))
      .map(node => {
        const values = [
          node.getAttribute('href'),
          node.getAttribute('data-id'),
          node.getAttribute('data-student-id'),
        ].filter(Boolean)
        return values.find(value => UUID_RE.test(value))
      })
      .find(Boolean)
      ?.match(UUID_RE)

    if (!emailMatch || !idMatch) {
      return null
    }

    let name = null
    if (
      cells.length >= 4 &&
      UUID_RE.test(cells[0]) &&
      EMAIL_RE.test(cells[1]) &&
      cells[2] &&
      cells[3]
    ) {
      name = `${cells[2]} ${cells[3]}`.trim()
    }

    if (!name) {
      const emailIndex = cells.findIndex(value => value === emailCell)
      const candidateParts = cells
        .filter((value, index) => (
          index !== emailIndex &&
          !UUID_RE.test(value) &&
          !EMAIL_RE.test(value) &&
          value.toLowerCase() !== 'student' &&
          value.length > 1
        ))
        .slice(0, 2)

      name = candidateParts.join(' ').trim() || null
    }

    if (name) {
      name = name.replace(ACTION_LABEL_RE, '').replace(/\s+/g, ' ').trim()
    }

    if (!name) {
      return null
    }

    return {
      gradeo_student_id: idMatch[0],
      name,
      email: emailMatch[0].toLowerCase(),
    }
  }

  function extractStudentDirectoryFromDocument(doc) {
    const activeTable = getActiveStudentTable(doc)
    const rows = activeTable
      ? Array.from(activeTable.querySelectorAll('tbody tr')).filter(isVisible)
      : Array.from(doc.querySelectorAll('tbody tr')).filter(isVisible)
    const students = []
    const seen = new Set()

    rows.forEach(row => {
      const student = extractStudentFromRow(row)
      if (student && !seen.has(student.gradeo_student_id)) {
        seen.add(student.gradeo_student_id)
        students.push(student)
      }
    })

    return students
  }

  function inspectStudentDirectoryDocument(doc) {
    const activeTable = getActiveStudentTable(doc)
    const rows = activeTable
      ? Array.from(activeTable.querySelectorAll('tbody tr')).filter(isVisible)
      : Array.from(doc.querySelectorAll('tbody tr')).filter(isVisible)
    const allTables = Array.from(doc.querySelectorAll('.RaDatagrid-table, table'))
    const sampleRows = rows
      .slice(0, 5)
      .map(row => (row.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map(text => text.slice(0, 220))

    const emails = Array.from(doc.querySelectorAll('a[href^="mailto:"], [href], td, div, span'))
      .map(node => {
        const text = (node.textContent || '').trim()
        const href = node.getAttribute && node.getAttribute('href')
        return text || href || ''
      })
      .filter(Boolean)
      .map(value => value.match(EMAIL_RE)?.[0] || null)
      .filter(Boolean)

    const uuids = Array.from(doc.querySelectorAll('[href], [data-id], [data-student-id], td, div, span'))
      .map(node => {
        const candidates = [
          node.getAttribute && node.getAttribute('href'),
          node.getAttribute && node.getAttribute('data-id'),
          node.getAttribute && node.getAttribute('data-student-id'),
          node.textContent,
        ].filter(Boolean)
        return candidates.find(value => UUID_RE.test(value)) || null
      })
      .filter(Boolean)
      .map(value => value.match(UUID_RE)?.[0] || null)
      .filter(Boolean)

    return {
      rowCount: rows.length,
      tableCount: allTables.length,
      activeTableFound: Boolean(activeTable),
      sampleRows,
      emailMatches: emails.slice(0, 10),
      uuidMatches: uuids.slice(0, 10),
    }
  }

  ext.extractStudentDirectoryFromDocument = extractStudentDirectoryFromDocument
  ext.inspectStudentDirectoryDocument = inspectStudentDirectoryDocument
})()

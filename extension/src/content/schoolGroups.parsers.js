(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension

  const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

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

  function getActiveSchoolGroupsTable(doc) {
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

    return Array.from(row.children)
      .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }

  function parseCount(value) {
    const digits = String(value || '').replace(/[^\d]/g, '')
    return digits ? Number(digits) : null
  }

  function extractClassFromRow(row) {
    const cells = getCellTexts(row)
    if (cells.length < 2) {
      return null
    }

    const headerSignature = cells.join('').toLowerCase()
    if (headerSignature.includes('idclassname')) {
      return null
    }

    const idMatch = cells[0]?.match(UUID_RE)
    const className = cells[1] ? cells[1].trim() : ''
    if (!idMatch || !className) {
      return null
    }

    return {
      gradeo_class_id: idMatch[0],
      name: className,
      syllabus_title: cells[2] || null,
      teacher_count: parseCount(cells[3]),
      student_count: parseCount(cells[4]),
    }
  }

  function extractSchoolGroupsFromDocument(doc) {
    const activeTable = getActiveSchoolGroupsTable(doc)
    const rows = activeTable
      ? Array.from(activeTable.querySelectorAll('tbody tr')).filter(isVisible)
      : Array.from(doc.querySelectorAll('tbody tr')).filter(isVisible)
    const classes = []
    const seen = new Set()

    rows.forEach(row => {
      const gradeoClass = extractClassFromRow(row)
      if (gradeoClass && !seen.has(gradeoClass.gradeo_class_id)) {
        seen.add(gradeoClass.gradeo_class_id)
        classes.push(gradeoClass)
      }
    })

    return classes
  }

  function inspectSchoolGroupsDocument(doc) {
    const activeTable = getActiveSchoolGroupsTable(doc)
    const rows = activeTable
      ? Array.from(activeTable.querySelectorAll('tbody tr')).filter(isVisible)
      : Array.from(doc.querySelectorAll('tbody tr')).filter(isVisible)

    return {
      rowCount: rows.length,
      activeTableFound: Boolean(activeTable),
      sampleRows: rows
        .slice(0, 5)
        .map(row => (row.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map(text => text.slice(0, 220)),
    }
  }

  ext.extractSchoolGroupsFromDocument = extractSchoolGroupsFromDocument
  ext.inspectSchoolGroupsDocument = inspectSchoolGroupsDocument
})()

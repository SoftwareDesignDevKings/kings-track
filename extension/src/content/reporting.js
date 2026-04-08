(function () {
  const ext = self.KingsTrackExtension
  let csvResolve = null
  let hookInstalled = false

  function installCsvHook() {
    if (hookInstalled) {
      return
    }
    hookInstalled = true

    window.addEventListener('message', event => {
      if (event.source !== window || event.data?.source !== 'kings-track-gradeo') {
        return
      }
      if (event.data.type === 'csv-export' && csvResolve) {
        csvResolve(event.data.text)
        csvResolve = null
      }
    })

    const script = document.createElement('script')
    script.textContent = `
      (() => {
        if (window.__kingsTrackGradeoHookInstalled) return
        window.__kingsTrackGradeoHookInstalled = true
        const blobStore = new Map()
        const originalCreateObjectURL = URL.createObjectURL.bind(URL)
        URL.createObjectURL = function (blob) {
          const url = originalCreateObjectURL(blob)
          if (blob instanceof Blob) blobStore.set(url, blob)
          return url
        }
        const originalClick = HTMLAnchorElement.prototype.click
        HTMLAnchorElement.prototype.click = function () {
          if (this.href && this.href.startsWith('blob:') && blobStore.has(this.href)) {
            const blob = blobStore.get(this.href)
            blob.text().then(text => {
              window.postMessage({ source: 'kings-track-gradeo', type: 'csv-export', text }, '*')
            })
          }
          return originalClick.apply(this, arguments)
        }
      })();
    `
    ;(document.head || document.documentElement).appendChild(script)
    script.remove()
  }

  function wait(ms) {
    return ext.wait ? ext.wait(ms) : new Promise(resolve => setTimeout(resolve, ms))
  }

  async function waitFor(predicate, timeoutMs) {
    if (ext.waitFor) {
      return ext.waitFor(predicate, timeoutMs)
    }

    const timeoutAt = Date.now() + (timeoutMs || 5000)
    while (Date.now() < timeoutAt) {
      const value = predicate()
      if (value) {
        return value
      }
      await wait(100)
    }
    throw new Error('Timed out waiting for Gradeo reporting state')
  }

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
    return rect.width > 0 && rect.height > 0
  }

  function stableText(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
  }

  function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim())
  }

  function parseNumber(value) {
    if (value == null) {
      return null
    }

    const text = String(value).replace(/[^\d.-]/g, '').trim()
    if (!text || text === '-' || text === '.' || text === '-.') {
      return null
    }

    const numeric = Number(text)
    return Number.isFinite(numeric) ? numeric : null
  }

  function getReportingResultsTable() {
    const tables = Array.from(document.querySelectorAll('table'))
    return tables.find(table => {
      if (!isVisible(table)) {
        return false
      }
      const headerText = stableText(table.querySelector('thead'))
      return headerText.includes('Test name') && headerText.includes('Result')
    }) || null
  }

  function getSelectedStudentIdFromCard() {
    const bodyText = stableText(document.body)
    const match = bodyText.match(/Student ID:\s*([0-9a-f-]{36})/i)
    return match ? match[1] : null
  }

  function getSelectedStudent() {
    const selected = ext.getSelectedDropdownOption('Select student')
    return {
      id: getSelectedStudentIdFromCard() || selected.id,
      name: selected.name,
    }
  }

  function getPaginatorRoot() {
    const table = getReportingResultsTable()
    if (!table) {
      return null
    }

    return table.closest('div')?.parentElement?.querySelector('.p-paginator') || document.querySelector('.p-paginator')
  }

  function getCurrentResultsPage() {
    const current = getPaginatorRoot()?.querySelector('[aria-current="true"]')
    const page = Number.parseInt(stableText(current), 10)
    return Number.isFinite(page) && page > 0 ? page : 1
  }

  function getFirstResultsPageButton() {
    return getPaginatorRoot()?.querySelector('.p-paginator-first, [aria-label="First Page"]')
  }

  function getNextResultsPageButton() {
    return getPaginatorRoot()?.querySelector('.p-paginator-next, [aria-label="Next Page"]')
  }

  function isDisabled(button) {
    return Boolean(
      !button ||
      button.disabled ||
      button.getAttribute('aria-disabled') === 'true' ||
      button.classList.contains('p-disabled') ||
      button.classList.contains('Mui-disabled')
    )
  }

  function readResultsPageState() {
    const table = getReportingResultsTable()
    const rows = table ? Array.from(table.querySelectorAll('tbody tr')).filter(isVisible) : []
    const names = rows.map(row => stableText(row.querySelector('td')))

    return {
      page: getCurrentResultsPage(),
      rowCount: rows.length,
      signature: `${getCurrentResultsPage()}|${rows.length}|${names[0] || ''}|${names.at(-1) || ''}`,
    }
  }

  async function waitForStudentView(student) {
    return waitFor(() => {
      const selected = getSelectedStudent()
      if (!getReportingResultsTable()) {
        return null
      }
      if (selected.name !== student.name) {
        return null
      }
      if (isUuidLike(student.id) && isUuidLike(selected.id) && selected.id !== student.id) {
        return null
      }
      return selected
    }, 15000)
  }

  async function waitForResultsPageChange(previousSignature) {
    await waitFor(() => {
      const state = readResultsPageState()
      return state.signature !== previousSignature ? state : null
    }, 15000)
    await wait(700)
    return readResultsPageState()
  }

  async function ensureFirstResultsPage() {
    if (getCurrentResultsPage() <= 1) {
      return
    }

    const firstButton = getFirstResultsPageButton()
    if (!isDisabled(firstButton)) {
      const previousSignature = readResultsPageState().signature
      firstButton.click()
      await waitForResultsPageChange(previousSignature)
      return
    }

    const pageOneButton = getPaginatorRoot()?.querySelector('[aria-label="Page 1"]')
    if (!isDisabled(pageOneButton)) {
      const previousSignature = readResultsPageState().signature
      pageOneButton.click()
      await waitForResultsPageChange(previousSignature)
    }
  }

  function parseResultCell(cell) {
    const text = stableText(cell)
    if (!text || /not submitted/i.test(text)) {
      return { status: 'not_submitted', examMark: null }
    }
    if (/await/i.test(text)) {
      return { status: 'awaiting_marking', examMark: null }
    }

    const primaryValue = Array.from(cell.querySelectorAll('p, span'))
      .map(stableText)
      .find(value => value && !/[+-]\d+%/.test(value))
    const examMark = parseNumber(primaryValue || text)

    if (examMark != null) {
      return { status: 'scored', examMark }
    }

    return { status: 'awaiting_marking', examMark: null }
  }

  function parseCurrentResultsTablePage() {
    const table = getReportingResultsTable()
    if (!table) {
      return []
    }

    return Array.from(table.querySelectorAll('tbody tr'))
      .filter(isVisible)
      .map((row, index) => {
        const cells = Array.from(row.querySelectorAll('td'))
        if (cells.length < 5) {
          return null
        }

        const examName = stableText(cells[0])
        if (!examName) {
          return null
        }

        const result = parseResultCell(cells[1])
        return {
          examName,
          classAverage: parseNumber(stableText(cells[2])),
          date: stableText(cells[3]) || null,
          timeSplit: stableText(cells[4]) || null,
          status: result.status,
          examMark: result.examMark,
          rowIndex: index,
          actionButton: row.querySelector('button'),
        }
      })
      .filter(Boolean)
  }

  async function listAllResultPages(progress) {
    await ensureFirstResultsPage()
    const pages = []
    const seen = new Set()

    while (true) {
      const state = readResultsPageState()
      const rows = parseCurrentResultsTablePage()
      pages.push(...rows)

      if (progress) {
        progress({ reportingPage: state.page, pageRows: rows.length })
      }

      const nextButton = getNextResultsPageButton()
      if (isDisabled(nextButton)) {
        break
      }

      if (seen.has(state.signature)) {
        break
      }
      seen.add(state.signature)

      nextButton.click()
      await waitForResultsPageChange(state.signature)
    }

    return pages
  }

  async function waitForOpenMenu(timeoutMs) {
    return waitFor(() => {
      const panels = Array.from(document.querySelectorAll('[role="menu"], .p-menu-overlay, .p-overlaypanel'))
      return panels.find(panel => isVisible(panel))
    }, timeoutMs || 1200)
  }

  function closeMenus() {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  async function readCsvFromAction(action) {
    const href = action.getAttribute('href')
    const download = action.getAttribute('download')

    if (href && /\.csv(\?|$)/i.test(href)) {
      const response = await fetch(href, { credentials: 'include' })
      if (!response.ok) {
        throw new Error(`Failed to fetch Gradeo CSV export (${response.status})`)
      }
      return response.text()
    }

    if (download && /\.csv$/i.test(download)) {
      installCsvHook()
      const pendingCsv = new Promise((resolve, reject) => {
        csvResolve = resolve
        setTimeout(() => {
          if (csvResolve) {
            csvResolve = null
            reject(new Error('Timed out waiting for Gradeo CSV export'))
          }
        }, 10000)
      })
      action.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return pendingCsv
    }

    installCsvHook()
    const pendingCsv = new Promise((resolve, reject) => {
      csvResolve = resolve
      setTimeout(() => {
        if (csvResolve) {
          csvResolve = null
          reject(new Error('Timed out waiting for Gradeo CSV export'))
        }
      }, 10000)
    })
    action.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return pendingCsv
  }

  async function exportExamCsvFromRow(examRow) {
    if (!examRow.actionButton || !isVisible(examRow.actionButton)) {
      return null
    }

    examRow.actionButton.click()
    const menu = await waitForOpenMenu(1200).catch(() => null)
    if (!menu) {
      return null
    }

    const items = Array.from(menu.querySelectorAll('a, button, [role="menuitem"], .p-menuitem-link'))
      .filter(isVisible)
    const csvAction = items.find(item => /csv|export|download/i.test(stableText(item)))

    if (!csvAction) {
      closeMenus()
      return null
    }

    await ext.logDebug('reporting', 'exam_csv_action_found', {
      examName: examRow.examName,
      actionText: stableText(csvAction),
    })

    try {
      const csvText = await readCsvFromAction(csvAction)
      closeMenus()
      return csvText
    } catch (error) {
      closeMenus()
      await ext.logDebug('reporting', 'exam_csv_action_failed', {
        examName: examRow.examName,
        error: String(error),
      })
      return null
    }
  }

  function filterCsvRowsForExam(rows, examRow) {
    const targetKey = normalizeKey(examRow.examName)
    const filtered = rows.filter(row => normalizeKey(row.Exam) === targetKey)
    return filtered.length > 0 ? filtered : rows
  }

  function buildSyntheticExamId(selectedClass, examRow) {
    return `synthetic:exam:${normalizeKey(selectedClass.id)}:${normalizeKey(examRow.examName)}`
  }

  function buildSyntheticImportRow(selectedClass, student, examRow) {
    const examId = buildSyntheticExamId(selectedClass, examRow)
    return {
      exam_name: examRow.examName,
      gradeo_exam_id: examId,
      class_name: selectedClass.name,
      class_average: examRow.classAverage,
      question: examRow.examName,
      gradeo_question_id: `${examId}:question`,
      question_part: null,
      gradeo_question_part_id: `${examId}:summary`,
      question_link: null,
      mark: examRow.status === 'scored' ? examRow.examMark : null,
      marks_available: null,
      answer_submitted: examRow.status !== 'not_submitted',
      feedback: null,
      marker_name: null,
      marker_id: null,
      marking_session_link: null,
      exam_mark: examRow.status === 'scored' ? examRow.examMark : null,
      syllabus_title: null,
      syllabus_grade: null,
      bands: [],
      outcomes: [],
      topics: [],
      copyright_notice: null,
    }
  }

  async function getSelectedClass() {
    const selected = ext.getSelectedDropdownOption('Select class')
    if (!selected.name) {
      await ext.logDebug('reporting', 'selected_class_missing')
      throw new Error('Choose a Gradeo class before importing.')
    }
    await ext.logDebug('reporting', 'selected_class_read', { id: selected.id, name: selected.name })
    return { id: selected.id, name: selected.name }
  }

  async function listStudents() {
    const options = await ext.listDropdownOptions('Select student')
    await ext.logDebug('reporting', 'student_options_listed', {
      count: options.length,
      sample: options.slice(0, 5).map(option => ({ id: option.id, name: option.name })),
    })
    return options.map(option => ({ id: option.id, name: option.name }))
  }

  async function selectStudent(student) {
    await ext.logDebug('reporting', 'select_student_requested', student)
    await ext.selectDropdownOption('Select student', {
      id: student.id,
      name: student.name,
    })
    await waitForStudentView(student)
    await ext.logDebug('reporting', 'select_student_complete', student)
  }

  async function collectCurrentStudentImport({ selectedClass, student, progress }) {
    const selectedStudent = await waitForStudentView(student)
    let examRows

    try {
      examRows = await listAllResultPages(progress)
    } catch (error) {
      await ext.logDebug('reporting', 'student_exam_page_collection_failed', {
        className: selectedClass.name,
        studentName: selectedStudent.name,
        studentId: selectedStudent.id,
        error: String(error),
      })
      throw new Error(`Failed to collect exam pages for ${selectedStudent.name}: ${error}`)
    }

    const importRows = []

    await ext.logDebug('reporting', 'student_exam_pages_collected', {
      className: selectedClass.name,
      studentName: selectedStudent.name,
      studentId: selectedStudent.id,
      examCount: examRows.length,
    })

    for (let index = 0; index < examRows.length; index += 1) {
      const examRow = examRows[index]
      if (progress) {
        progress({
          currentExam: index + 1,
          totalExams: examRows.length,
          examName: examRow.examName,
        })
      }

      importRows.push(buildSyntheticImportRow(selectedClass, selectedStudent, examRow))
    }

    await ext.logDebug('reporting', 'student_table_rows_built', {
      className: selectedClass.name,
      studentName: selectedStudent.name,
      studentId: selectedStudent.id,
      rowCount: importRows.length,
    })

    return {
      gradeo_student_id: selectedStudent.id,
      student_name: selectedStudent.name,
      rows: importRows,
    }
  }

  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'kings.gradeo.getSelectedClass') {
      return getSelectedClass()
    }
    return undefined
  })
})()

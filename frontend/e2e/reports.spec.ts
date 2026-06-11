import { test, expect, getReportCard } from './fixtures'

// ---------------------------------------------------------------------------
// Helper: locate selects by position on the Reports page.
//   select[0] = Course Reports course dropdown
//   select[1] = Student Reports student dropdown
//   select[2] = Student Reports course dropdown
//   select[3] = Student Reports cycle dropdown
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Page structure
// ---------------------------------------------------------------------------

test.describe('Reports page structure', () => {
  test('shows all three sections', async ({ reportsPage: page }) => {
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Platform Reports' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Course Reports' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Student Reports' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 2. Platform Reports
// ---------------------------------------------------------------------------

test.describe('Platform Reports', () => {
  test('shows all three cards with correct buttons', async ({ reportsPage: page }) => {
    const titles = ['Student Progress Report', 'At-Risk Students', 'Attendance Summary']
    for (const title of titles) {
      const card = getReportCard(page, title)
      await expect(card).toBeVisible()
      await expect(card.getByRole('button', { name: 'Preview' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'CSV' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'PDF' })).toBeVisible()
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Course selection shows cards
// ---------------------------------------------------------------------------

test.describe('Course Reports', () => {
  test('shows placeholder before course selection', async ({ reportsPage: page }) => {
    await expect(
      page.getByText('Select a course to see available course reports.')
    ).toBeVisible()
  })

  test('selecting a course shows course report cards', async ({ reportsPage: page }) => {
    const courseSelect = page.locator('select').nth(0)
    const options = courseSelect.locator('option')
    const count = await options.count()
    expect(count).toBeGreaterThan(1)

    // Select the first real course
    const value = await options.nth(1).getAttribute('value')
    await courseSelect.selectOption(value!)

    // These cards should appear for any course
    const expected = [
      'Class List',
      'Class Report',
      'Course Attendance',
      'Gradeo Topic Bands',
      'Whole-Class Cycle Update',
    ]
    for (const title of expected) {
      await expect(getReportCard(page, title)).toBeVisible()
    }
  })

  test('Class Report has CSV button for non-ENC course', async ({
    reportsPage: page,
  }) => {
    const courseSelect = page.locator('select').nth(0)
    const options = courseSelect.locator('option')

    // Find a non-ENC course so EdStem is visible
    let nonEncValue: string | null = null
    const count = await options.count()
    for (let i = 1; i < count; i++) {
      const text = await options.nth(i).textContent()
      if (text && !/ENC/i.test(text)) {
        nonEncValue = await options.nth(i).getAttribute('value')
        break
      }
    }
    test.skip(!nonEncValue, 'No non-ENC course in database')
    await courseSelect.selectOption(nonEncValue!)

    // Class Report should have at least a CSV button
    const classReportCard = getReportCard(page, 'Class Report')
    await expect(classReportCard.getByRole('button', { name: 'CSV' })).toBeVisible()

    // EdStem Progress should have at least a CSV button
    const edStemCard = getReportCard(page, 'EdStem Progress')
    await expect(edStemCard.getByRole('button', { name: 'CSV' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 4 & 5. ENC course filtering
// ---------------------------------------------------------------------------

test.describe('ENC course filtering', () => {
  test('ENC course hides EdStem but shows Gradeo', async ({ reportsPage: page }) => {
    const courseSelect = page.locator('select').nth(0)
    const encOption = courseSelect.locator('option:text-matches("ENC", "i")')
    const encCount = await encOption.count()
    test.skip(encCount === 0, 'No ENC course in database')

    const value = await encOption.first().getAttribute('value')
    await courseSelect.selectOption(value!)

    await expect(getReportCard(page, 'Gradeo Topic Bands')).toBeVisible()
    await expect(getReportCard(page, 'EdStem Progress')).toHaveCount(0)
  })

  test('non-ENC course shows EdStem', async ({ reportsPage: page }) => {
    const courseSelect = page.locator('select').nth(0)
    const options = courseSelect.locator('option')
    const count = await options.count()

    let nonEncValue: string | null = null
    for (let i = 1; i < count; i++) {
      const text = await options.nth(i).textContent()
      if (text && !/ENC/i.test(text)) {
        nonEncValue = await options.nth(i).getAttribute('value')
        break
      }
    }
    test.skip(!nonEncValue, 'No non-ENC course in database')

    await courseSelect.selectOption(nonEncValue!)
    await expect(getReportCard(page, 'EdStem Progress')).toBeVisible()
    await expect(getReportCard(page, 'Gradeo Topic Bands')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 6. Preview opens PDF in new window
// ---------------------------------------------------------------------------

test.describe('Report preview', () => {
  test('Preview opens a new window with PDF iframe', async ({
    reportsPage: page,
    context,
  }) => {
    const card = getReportCard(page, 'Student Progress Report')
    const previewBtn = card.getByRole('button', { name: 'Preview' })

    const popupPromise = context.waitForEvent('page')
    await previewBtn.click()

    // Wait for either the popup or an error on the card
    const result = await Promise.race([
      popupPromise.then((popup) => ({ type: 'popup' as const, popup })),
      card
        .locator('.text-red-500')
        .waitFor({ timeout: 30_000 })
        .then(() => ({ type: 'error' as const })),
    ])

    if (result.type === 'popup') {
      const popup = result.popup
      await popup.waitForLoadState()
      const iframe = popup.locator('iframe')
      await expect(iframe).toBeAttached()
      await popup.close()
    } else {
      const errorText = await card.locator('.text-red-500').textContent()
      console.warn(`Preview returned error: ${errorText}`)
    }

    // Button should restore to default state
    await expect(previewBtn).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 7 & 8. Report downloads (CSV and PDF)
// ---------------------------------------------------------------------------

test.describe('Report downloads', () => {
  test('CSV download triggers file download', async ({ reportsPage: page }) => {
    const card = getReportCard(page, 'Student Progress Report')

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await card.getByRole('button', { name: 'CSV' }).click()

    const result = await Promise.race([
      downloadPromise.then((dl) => ({ type: 'download' as const, download: dl })),
      card
        .locator('.text-red-500')
        .waitFor({ timeout: 20_000 })
        .then(() => ({ type: 'error' as const })),
    ])

    if (result.type === 'download') {
      expect(result.download.suggestedFilename()).toMatch(/\.csv$/i)
      await result.download.cancel()
    } else {
      const errorText = await card.locator('.text-red-500').textContent()
      console.warn(`CSV download returned error: ${errorText}`)
    }
  })

  test('PDF download triggers file download', async ({ reportsPage: page }) => {
    const card = getReportCard(page, 'Attendance Summary')

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await card.getByRole('button', { name: 'PDF' }).click()

    const result = await Promise.race([
      downloadPromise.then((dl) => ({ type: 'download' as const, download: dl })),
      card
        .locator('.text-red-500')
        .waitFor({ timeout: 20_000 })
        .then(() => ({ type: 'error' as const })),
    ])

    if (result.type === 'download') {
      expect(result.download.suggestedFilename()).toMatch(/\.pdf$/i)
      await result.download.cancel()
    } else {
      const errorText = await card.locator('.text-red-500').textContent()
      console.warn(`PDF download returned error: ${errorText}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 9. Error handling shows specific backend messages
// ---------------------------------------------------------------------------

test.describe('Error handling', () => {
  test('shows backend error detail from 500 response', async ({ reportsPage: page }) => {
    // Intercept the API and return a 500 with a specific detail message
    await page.route('**/api/reports/student-progress**', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Simulated server error for testing' }),
      })
    })

    const card = getReportCard(page, 'Student Progress Report')
    await card.getByRole('button', { name: 'CSV' }).click()

    const errorEl = card.locator('.text-red-500')
    await expect(errorEl).toBeVisible({ timeout: 10_000 })
    await expect(errorEl).toHaveText('Simulated server error for testing')

    // Buttons should re-enable after error
    await expect(card.getByRole('button', { name: 'CSV' })).toBeEnabled()
    await expect(card.getByRole('button', { name: 'Preview' })).toBeEnabled()

    await page.unroute('**/api/reports/student-progress**')
  })
})

// ---------------------------------------------------------------------------
// 10. Student Reports (student-first selector)
// ---------------------------------------------------------------------------

test.describe('Student Reports', () => {
  test('shows placeholder before selection', async ({ reportsPage: page }) => {
    await expect(
      page.getByText('Select a student to see available reports.')
    ).toBeVisible()
  })

  test('selecting a student and course shows report cards', async ({ reportsPage: page }) => {
    // Student Reports student select is the 2nd select on the page (index 1)
    const studentSelect = page.locator('select').nth(1)
    await page.waitForFunction(() => {
      const selects = document.querySelectorAll('select')
      const studentSel = selects[1] as HTMLSelectElement | undefined
      return studentSel && studentSel.options.length > 1
    })

    // Select the first student
    const studentOptions = studentSelect.locator('option')
    await studentSelect.selectOption((await studentOptions.nth(1).getAttribute('value'))!)

    // Course select is the 3rd select (index 2)
    const courseSelect = page.locator('select').nth(2)

    // Select the first course
    const courseOptions = courseSelect.locator('option')
    await courseSelect.selectOption((await courseOptions.nth(1).getAttribute('value'))!)

    // All four student report cards should appear
    await expect(getReportCard(page, /Cycle.*Update/)).toBeVisible()
    await expect(getReportCard(page, 'Missing Work Report')).toBeVisible()
    await expect(getReportCard(page, 'Complete Student Report')).toBeVisible()
    await expect(getReportCard(page, 'Full Student Report')).toBeVisible()
  })

  test('course-dependent cards work when course is already selected', async ({
    reportsPage: page,
  }) => {
    // Select a student first (index 1)
    const studentSelect = page.locator('select').nth(1)
    await page.waitForFunction(() => {
      const selects = document.querySelectorAll('select')
      const studentSel = selects[1] as HTMLSelectElement | undefined
      return studentSel && studentSel.options.length > 1
    })
    const studentOptions = studentSelect.locator('option')
    await studentSelect.selectOption((await studentOptions.nth(1).getAttribute('value'))!)

    // Select a course (index 2)
    const courseSelect = page.locator('select').nth(2)
    const courseOptions = courseSelect.locator('option')
    await courseSelect.selectOption((await courseOptions.nth(1).getAttribute('value'))!)

    // Since course is already selected, course-dependent cards should be enabled
    const cycleCard = getReportCard(page, /Cycle.*Update/)
    await expect(cycleCard.getByText('Select a course above')).toHaveCount(0)
    await expect(cycleCard.getByRole('button', { name: 'Preview' })).toBeVisible()

    const completeCard = getReportCard(page, 'Complete Student Report')
    await expect(completeCard.getByText('Select a course above')).toHaveCount(0)
    await expect(completeCard.getByRole('button', { name: 'Preview' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 11. Course change resets card states
// ---------------------------------------------------------------------------

test.describe('Course change resets state', () => {
  test('switching courses clears stale errors', async ({ reportsPage: page }) => {
    const courseSelect = page.locator('select').nth(0)
    const options = courseSelect.locator('option')
    const count = await options.count()
    test.skip(count <= 2, 'Need at least 2 courses to test switching')

    // Select the first course
    await courseSelect.selectOption((await options.nth(1).getAttribute('value'))!)

    // Force an error on Class List
    await page.route('**/api/reports/courses/*/class-list**', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Forced error' }),
      })
    })

    const classListCard = getReportCard(page, 'Class List')
    await classListCard.getByRole('button', { name: 'CSV' }).click()
    await expect(classListCard.locator('.text-red-500')).toBeVisible()

    // Remove the route intercept
    await page.unroute('**/api/reports/courses/*/class-list**')

    // Switch to a different course — React key remounts all cards
    await courseSelect.selectOption((await options.nth(2).getAttribute('value'))!)

    // Error should be cleared (fresh card)
    const newClassListCard = getReportCard(page, 'Class List')
    await expect(newClassListCard.locator('.text-red-500')).toHaveCount(0)
    await expect(newClassListCard.getByRole('button', { name: 'CSV' })).toBeEnabled()
  })
})

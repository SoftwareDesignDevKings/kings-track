import { test as base, expect, Page } from '@playwright/test'

/**
 * Comprehensive audit of all report previews for every course.
 * - Lists all courses from the dropdown
 * - For each course: selects it, checks which cards appear
 * - For ENC courses: verifies no EdStem card
 * - Previews each report and checks the popup content
 * - Also audits platform reports and student reports
 */

const AUTH_FILE = '.auth/user.json'

const test = base.extend<{ reportsPage: Page }>({
  reportsPage: async ({ page }, use) => {
    await page.goto('/reports')
    await expect(
      page.getByRole('heading', { name: 'Reports', exact: true })
    ).toBeVisible({ timeout: 30_000 })
    await page.waitForFunction(() => {
      const select = document.querySelector('select') as HTMLSelectElement | null
      return select && select.options.length > 1
    }, null, { timeout: 30_000 })
    await use(page)
  },
})

function getReportCard(page: Page, title: string | RegExp) {
  return page.locator('div.bg-white.rounded-xl', {
    has: page.locator('h3', { hasText: title }),
  })
}

// ---------------------------------------------------------------------------
// 1. Platform Reports audit
// ---------------------------------------------------------------------------

test.describe('Platform Reports audit', () => {
  test.setTimeout(120_000) // 2 minutes for platform report previews

  const platformReports = ['Student Progress Report', 'At-Risk Students', 'Attendance Summary']

  for (const reportName of platformReports) {
    test(`Preview "${reportName}"`, async ({ reportsPage: page, context }) => {
      const card = getReportCard(page, reportName)
      await expect(card).toBeVisible()

      const previewBtn = card.getByRole('button', { name: 'Preview' })
      await expect(previewBtn).toBeVisible()

      const popupPromise = context.waitForEvent('page')
      await previewBtn.click()

      const result = await Promise.race([
        popupPromise.then((popup) => ({ type: 'popup' as const, popup })),
        card
          .locator('.text-red-500')
          .waitFor({ timeout: 30_000 })
          .then(() => ({ type: 'error' as const })),
        new Promise<{ type: 'timeout' }>((resolve) =>
          setTimeout(() => resolve({ type: 'timeout' }), 35_000)
        ),
      ])

      if (result.type === 'popup') {
        const popup = result.popup
        await popup.waitForLoadState('domcontentloaded')
        const iframe = popup.locator('iframe')
        await expect(iframe).toBeAttached({ timeout: 15_000 })
        console.log(`  ✓ Platform "${reportName}" preview opened successfully`)
        await popup.close()
      } else if (result.type === 'error') {
        const errorText = await card.locator('.text-red-500').textContent()
        console.error(`  ✗ Platform "${reportName}" preview ERROR: ${errorText}`)
      } else {
        console.error(`  ✗ Platform "${reportName}" preview TIMEOUT`)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// 2. Course Reports audit — enumerate all courses
// ---------------------------------------------------------------------------

test.describe('Course Reports audit', () => {
  test.setTimeout(300_000) // 5 minutes — iterates through many courses

  test('Audit all courses and their report cards', async ({
    reportsPage: page,
    context,
  }) => {
    const courseSelect = page.locator('select').nth(0)
    const options = courseSelect.locator('option')
    const count = await options.count()

    console.log(`\n${'='.repeat(60)}`)
    console.log(`  COURSE REPORTS AUDIT — ${count - 1} courses found`)
    console.log(`${'='.repeat(60)}`)

    // Collect all course info
    const courses: { value: string; text: string }[] = []
    for (let i = 1; i < count; i++) {
      const value = await options.nth(i).getAttribute('value')
      const text = await options.nth(i).textContent()
      if (value && text) courses.push({ value, text: text.trim() })
    }

    for (const course of courses) {
      console.log(`\n--- Course: ${course.text} (${course.value}) ---`)

      const isEnc = /ENC/i.test(course.text)
      if (isEnc) console.log(`  [ENC COURSE — EdStem should NOT appear]`)

      // Select course
      await courseSelect.selectOption(course.value)
      await page.waitForTimeout(1000) // Allow cards to render

      // Check which cards are visible
      const expectedCards = [
        'Class List',
        'Class Report',
        'Course Attendance',
        'Gradeo Topic Bands',
        'Whole-Class Cycle Update',
      ]

      const visibleCards: string[] = []
      for (const cardTitle of expectedCards) {
        const card = getReportCard(page, cardTitle)
        const isVisible = (await card.count()) > 0
        if (isVisible) {
          visibleCards.push(cardTitle)
          console.log(`  ✓ Card visible: "${cardTitle}"`)
        } else {
          console.log(`  ✗ Card MISSING: "${cardTitle}"`)
        }
      }

      // Check EdStem card
      const edStemCard = getReportCard(page, 'EdStem Progress')
      const edStemVisible = (await edStemCard.count()) > 0

      if (isEnc) {
        if (edStemVisible) {
          console.error(`  ✗✗ FAIL: EdStem Progress card is VISIBLE for ENC course "${course.text}"!`)
          expect(edStemVisible).toBe(false) // This will fail the test
        } else {
          console.log(`  ✓ EdStem Progress correctly hidden for ENC course`)
        }
      } else {
        if (edStemVisible) {
          console.log(`  ✓ EdStem Progress visible (non-ENC course)`)
          visibleCards.push('EdStem Progress')
        } else {
          console.log(`  ⚠ EdStem Progress not visible for non-ENC course "${course.text}"`)
        }
      }

      // Now preview each visible report card
      for (const cardTitle of visibleCards) {
        const card = getReportCard(page, cardTitle)
        const previewBtn = card.getByRole('button', { name: 'Preview' })
        const hasPreview = (await previewBtn.count()) > 0

        if (!hasPreview) {
          console.log(`  → "${cardTitle}" has no Preview button, skipping`)
          continue
        }

        // Click preview
        const popupPromise = context.waitForEvent('page')
        await previewBtn.click()

        const result = await Promise.race([
          popupPromise.then((popup) => ({ type: 'popup' as const, popup })),
          card
            .locator('.text-red-500')
            .waitFor({ timeout: 30_000 })
            .then(() => ({ type: 'error' as const })),
          new Promise<{ type: 'timeout' }>((resolve) =>
            setTimeout(() => resolve({ type: 'timeout' }), 35_000)
          ),
        ])

        if (result.type === 'popup') {
          const popup = result.popup
          await popup.waitForLoadState('domcontentloaded')

          // Wait briefly for PDF iframe
          const iframe = popup.locator('iframe')
          const hasIframe = await iframe.count()

          if (hasIframe > 0) {
            console.log(`  ✓ Preview "${cardTitle}" opened — iframe present`)
          } else {
            // Maybe it's HTML content directly
            const bodyText = await popup.locator('body').textContent()
            if (bodyText && bodyText.trim().length > 50) {
              console.log(`  ✓ Preview "${cardTitle}" opened — HTML content (${bodyText.trim().length} chars)`)

              // For ENC courses, check that no EdStem content appears in the preview
              if (isEnc) {
                const lowerBody = bodyText.toLowerCase()
                if (lowerBody.includes('edstem')) {
                  console.error(`  ✗✗ FAIL: EdStem content found in "${cardTitle}" preview for ENC course!`)
                  expect(lowerBody).not.toContain('edstem')
                } else {
                  console.log(`  ✓ No EdStem content in preview (ENC course check passed)`)
                }
              }
            } else {
              console.log(`  ⚠ Preview "${cardTitle}" opened but content seems empty/short`)
            }
          }

          await popup.close()
        } else if (result.type === 'error') {
          const errorText = await card.locator('.text-red-500').textContent()
          console.error(`  ✗ Preview "${cardTitle}" ERROR: ${errorText}`)
        } else {
          console.error(`  ✗ Preview "${cardTitle}" TIMEOUT: no popup or error after 35s`)
        }

        // Wait for button to restore
        await expect(previewBtn).toBeVisible({ timeout: 5_000 })
        await page.waitForTimeout(500) // Small delay between previews
      }
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`  AUDIT COMPLETE`)
    console.log(`${'='.repeat(60)}\n`)
  })
})

// ---------------------------------------------------------------------------
// 3. Student Reports audit
// ---------------------------------------------------------------------------

test.describe('Student Reports audit', () => {
  test.setTimeout(300_000) // 5 minutes — iterates through students with previews

  test('Audit student reports for first 3 students', async ({
    reportsPage: page,
    context,
  }) => {
    // New UI: Course first (index 1), then Student (index 2), then Cycle (index 3)
    const courseSelect = page.locator('select').nth(1)

    // Wait for the Student Reports course dropdown to populate
    await page.waitForFunction(
      () => {
        const selects = document.querySelectorAll('select')
        const courseSel = selects[1] as HTMLSelectElement | undefined
        return courseSel && courseSel.options.length > 1
      },
      null,
      { timeout: 30_000 }
    )

    // Select the first course to populate the student list
    const courseOptions = courseSelect.locator('option')
    const firstCourseValue = await courseOptions.nth(1).getAttribute('value')
    const firstCourseText = await courseOptions.nth(1).textContent()
    console.log(`\n${'='.repeat(60)}`)
    console.log(`  STUDENT REPORTS AUDIT`)
    console.log(`  Course: ${firstCourseText?.trim()}`)
    console.log(`${'='.repeat(60)}`)

    await courseSelect.selectOption(firstCourseValue!)

    // Wait for student dropdown to populate (index 2)
    const studentSelect = page.locator('select').nth(2)
    await page.waitForFunction(
      () => {
        const selects = document.querySelectorAll('select')
        const studentSel = selects[2] as HTMLSelectElement | undefined
        return studentSel && studentSel.options.length > 1
      },
      null,
      { timeout: 15_000 }
    )

    const studentOptions = studentSelect.locator('option')
    const studentCount = await studentOptions.count()
    console.log(`  ${studentCount - 1} students found in this course`)

    // Audit first 3 students (or fewer if not enough)
    const maxStudents = Math.min(studentCount - 1, 3)

    const expectedStudentCards = [
      { title: /Cycle.*Update/, label: 'Cycle Update' },
      { title: 'Missing Work Report', label: 'Missing Work Report' },
      { title: 'Complete Student Report', label: 'Complete Student Report' },
      { title: 'Full Student Report', label: 'Full Student Report' },
    ]

    for (let s = 1; s <= maxStudents; s++) {
      const studentValue = await studentOptions.nth(s).getAttribute('value')
      const studentText = await studentOptions.nth(s).textContent()
      console.log(`\n--- Student ${s}: ${studentText?.trim()} ---`)

      await studentSelect.selectOption(studentValue!)
      await page.waitForTimeout(1000)

      // Check which student report cards appear
      for (const { title, label } of expectedStudentCards) {
        const card = getReportCard(page, title)
        const isVisible = (await card.count()) > 0
        if (isVisible) {
          console.log(`  ✓ Card visible: "${label}"`)
        } else {
          console.log(`  ✗ Card MISSING: "${label}"`)
        }
      }

      // Course is already selected, so course-dependent cards should be enabled
      // Preview each card that has a Preview button
      for (const { title, label } of expectedStudentCards) {
        const card = getReportCard(page, title)
        if ((await card.count()) === 0) continue

        const previewBtn = card.getByRole('button', { name: 'Preview' })
        if ((await previewBtn.count()) === 0) {
          console.log(`  → "${label}" has no Preview button (CSV-only), skipping`)
          continue
        }
        if (!(await previewBtn.isEnabled())) {
          console.log(`  → "${label}" Preview button disabled, skipping`)
          continue
        }

        const popupPromise = context.waitForEvent('page')
        await previewBtn.click()

        const result = await Promise.race([
          popupPromise.then((popup) => ({ type: 'popup' as const, popup })),
          card
            .locator('.text-red-500')
            .waitFor({ timeout: 30_000 })
            .then(() => ({ type: 'error' as const })),
          new Promise<{ type: 'timeout' }>((resolve) =>
            setTimeout(() => resolve({ type: 'timeout' }), 35_000)
          ),
        ])

        if (result.type === 'popup') {
          const popup = result.popup
          await popup.waitForLoadState('domcontentloaded')
          const iframe = popup.locator('iframe')
          const hasIframe = (await iframe.count()) > 0
          console.log(`  ✓ Preview "${label}" opened${hasIframe ? ' (iframe)' : ' (HTML)'}`)
          await popup.close()
        } else if (result.type === 'error') {
          const errorText = await card.locator('.text-red-500').textContent()
          console.error(`  ✗ Preview "${label}" ERROR: ${errorText}`)
        } else {
          console.error(`  ✗ Preview "${label}" TIMEOUT`)
        }

        await expect(previewBtn).toBeVisible({ timeout: 5_000 })
        await page.waitForTimeout(500)
      }
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`  STUDENT AUDIT COMPLETE`)
    console.log(`${'='.repeat(60)}\n`)
  })
})

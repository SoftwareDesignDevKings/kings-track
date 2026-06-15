import { test as base, expect, Page } from '@playwright/test'

/**
 * Gradeo data integrity tests for reports.
 *
 * These tests verify that Gradeo exam results shown on the course page
 * (which is the source of truth) also appear correctly in the generated
 * PDF reports. Specifically guards against deduplication bugs where stale
 * "not_submitted" rows override correct "scored" results.
 */

const AUTH_FILE = '.auth/user.json'

const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    // Apply auth state
    await use(page)
  },
})
test.use({ storageState: AUTH_FILE })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GradeoStudent {
  id: number
  name: string
  results: Record<string, { status: string; exam_mark: number | null; marks_available: number | null } | null>
}

interface GradeoExam {
  id: string
  exam_name: string
}

interface GradeoResponse {
  mapped: boolean
  exams: GradeoExam[]
  students: GradeoStudent[]
}

/** Fetch Gradeo data for a course from the API. */
async function fetchGradeoData(page: Page, courseId: string): Promise<GradeoResponse | null> {
  const resp = await page.request.get(`/api/courses/${courseId}/gradeo`)
  if (!resp.ok()) return null
  const data = await resp.json()
  if (!data.mapped) return null
  return data
}

/** Find an ENC course ID from the Reports page course dropdown. */
async function findEncCourseId(page: Page): Promise<{ id: string; text: string } | null> {
  await page.goto('/reports')
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible({ timeout: 30_000 })

  const courseSelect = page.locator('select').nth(0)
  await page.waitForFunction(() => {
    const select = document.querySelector('select') as HTMLSelectElement | null
    return select && select.options.length > 1
  }, null, { timeout: 30_000 })

  const options = courseSelect.locator('option')
  const count = await options.count()

  for (let i = 1; i < count; i++) {
    const text = await options.nth(i).textContent()
    if (text && /ENC/i.test(text)) {
      const value = await options.nth(i).getAttribute('value')
      if (value) return { id: value, text: text.trim() }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 1. Gradeo data exists on course page (baseline check)
// ---------------------------------------------------------------------------

test.describe('Gradeo data baseline', () => {
  test.setTimeout(60_000)

  test('ENC course has students with scored Gradeo exams', async ({ authedPage: page }) => {
    const enc = await findEncCourseId(page)
    test.skip(!enc, 'No ENC course found')

    const data = await fetchGradeoData(page, enc!.id)
    expect(data).not.toBeNull()
    expect(data!.exams.length).toBeGreaterThan(0)

    // At least one student should have a "scored" result
    const studentsWithScored = data!.students.filter((s) =>
      Object.values(s.results).some((r) => r?.status === 'scored')
    )

    console.log(`  Course: ${enc!.text}`)
    console.log(`  Total students: ${data!.students.length}`)
    console.log(`  Students with scored results: ${studentsWithScored.length}`)
    console.log(`  Total exams: ${data!.exams.length}`)

    expect(studentsWithScored.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Student report PDF contains correct Gradeo status
// ---------------------------------------------------------------------------

test.describe('Gradeo in student reports', () => {
  test.setTimeout(120_000)

  test('Complete Student Report PDF reflects scored Gradeo exams from course page', async ({
    authedPage: page,
  }) => {
    const enc = await findEncCourseId(page)
    test.skip(!enc, 'No ENC course found')

    const data = await fetchGradeoData(page, enc!.id)
    test.skip(!data || data.exams.length === 0, 'No Gradeo data for ENC course')

    // Find a student with at least one scored exam
    const student = data!.students.find((s) =>
      Object.values(s.results).some((r) => r?.status === 'scored')
    )
    test.skip(!student, 'No student with scored Gradeo results')

    const scoredCount = Object.values(student!.results).filter(
      (r) => r?.status === 'scored'
    ).length
    console.log(`  Testing student: ${student!.name} (id=${student!.id})`)
    console.log(`  Scored exams on course page: ${scoredCount}`)

    // Generate the Complete Student Report PDF via API
    const pdfResp = await page.request.get(
      `/api/reports/students/${student!.id}/student-report-pdf?course_id=${enc!.id}&preview=1`
    )

    expect(pdfResp.ok()).toBe(true)
    expect(pdfResp.headers()['content-type']).toContain('pdf')

    // Download the PDF bytes and check for Gradeo content
    const pdfBytes = await pdfResp.body()
    const pdfText = pdfBytes.toString('latin1') // PDF text is often readable in latin1

    // The PDF should contain "Gradeo Results" section header
    expect(pdfText).toContain('Gradeo Results')

    // Check for "scored" status text in the PDF
    // ReportLab renders table text that should include the status
    const hasScoredText = pdfText.includes('scored')
    const hasNotSubmittedOnly =
      !hasScoredText && pdfText.includes('not_submitted')

    console.log(`  PDF contains "scored": ${hasScoredText}`)
    console.log(`  PDF contains "not_submitted": ${pdfText.includes('not_submitted')}`)

    if (hasNotSubmittedOnly) {
      // This is the exact bug we're guarding against:
      // course page shows scored, but report shows not_submitted
      expect.soft(hasScoredText).toBe(true)
      console.error(
        `  FAIL: Student has ${scoredCount} scored exams on course page ` +
        `but report PDF only shows not_submitted!`
      )
    }

    expect(hasScoredText).toBe(true)
  })

  test('Cycle Update PDF reflects scored Gradeo exams from course page', async ({
    authedPage: page,
  }) => {
    const enc = await findEncCourseId(page)
    test.skip(!enc, 'No ENC course found')

    const data = await fetchGradeoData(page, enc!.id)
    test.skip(!data || data.exams.length === 0, 'No Gradeo data for ENC course')

    // Find a student with scored results
    const student = data!.students.find((s) =>
      Object.values(s.results).some((r) => r?.status === 'scored')
    )
    test.skip(!student, 'No student with scored Gradeo results')

    console.log(`  Testing Cycle Update for: ${student!.name} (id=${student!.id})`)

    // Generate Cycle Update PDF
    const pdfResp = await page.request.get(
      `/api/reports/students/${student!.id}/cycle-update-pdf?course_id=${enc!.id}&preview=1`
    )

    // Cycle update needs course_id — check the actual endpoint path
    if (!pdfResp.ok()) {
      console.log(`  Cycle update response status: ${pdfResp.status()}`)
      const body = await pdfResp.text()
      console.log(`  Response body: ${body.substring(0, 200)}`)
    }
    expect(pdfResp.ok()).toBe(true)

    const pdfBytes = await pdfResp.body()
    const pdfText = pdfBytes.toString('latin1')

    // The cycle update includes Gradeo sections for each cycle
    // Check that marks appear (e.g., "8/10" or similar score patterns)
    const scoredExams = Object.entries(student!.results)
      .filter(([, r]) => r?.status === 'scored' && r.exam_mark != null)

    if (scoredExams.length > 0) {
      // At least one scored exam should have its mark in the PDF
      let foundMark = false
      for (const [, result] of scoredExams) {
        if (result && result.exam_mark != null && result.marks_available != null) {
          // Check for the mark pattern like "8.0/10" or "8/10"
          const markInt = Math.round(result.exam_mark)
          const totalInt = Math.round(result.marks_available)
          if (
            pdfText.includes(`${result.exam_mark}/${result.marks_available}`) ||
            pdfText.includes(`${markInt}/${totalInt}`) ||
            pdfText.includes(`${result.exam_mark}`)
          ) {
            foundMark = true
            break
          }
        }
      }
      console.log(`  Found mark values in PDF: ${foundMark}`)
      expect(foundMark).toBe(true)
    }
  })

  test('Missing Work Report does not flag scored exams as missing', async ({
    authedPage: page,
  }) => {
    const enc = await findEncCourseId(page)
    test.skip(!enc, 'No ENC course found')

    const data = await fetchGradeoData(page, enc!.id)
    test.skip(!data || data.exams.length === 0, 'No Gradeo data for ENC course')

    // Find a student where ALL Gradeo exams are scored (fully completed)
    const fullyScored = data!.students.find((s) => {
      const results = Object.values(s.results).filter((r) => r !== null)
      return results.length > 0 && results.every((r) => r!.status === 'scored')
    })

    if (!fullyScored) {
      // Fallback: find student with most scored exams
      const student = data!.students.reduce((best, s) => {
        const scored = Object.values(s.results).filter((r) => r?.status === 'scored').length
        const bestScored = Object.values(best.results).filter((r) => r?.status === 'scored').length
        return scored > bestScored ? s : best
      })

      const scoredExams = Object.values(student.results)
        .filter((r) => r?.status === 'scored')
        .map((r) => r!)

      test.skip(scoredExams.length === 0, 'No scored exams found')

      console.log(`  Testing Missing Work for: ${student.name} (id=${student.id})`)
      console.log(`  Scored exams: ${scoredExams.length}`)

      // Get the exam names that are scored
      const scoredExamIds = new Set<string>()
      for (const [examId, result] of Object.entries(student.results)) {
        if (result?.status === 'scored') scoredExamIds.add(examId)
      }
      const scoredExamNames = data!.exams
        .filter((e) => scoredExamIds.has(e.id))
        .map((e) => e.exam_name)

      // Generate Missing Work Report
      const pdfResp = await page.request.get(
        `/api/reports/students/${student.id}/missing-report-pdf?preview=1`
      )
      expect(pdfResp.ok()).toBe(true)

      const pdfBytes = await pdfResp.body()
      const pdfText = pdfBytes.toString('latin1')

      // Scored exams should NOT appear in the missing work report
      for (const examName of scoredExamNames) {
        const isInMissingReport = pdfText.includes(examName)
        if (isInMissingReport) {
          console.error(
            `  FAIL: Exam "${examName}" is scored on course page but appears in Missing Work Report!`
          )
        }
        expect.soft(
          isInMissingReport,
          `Scored exam "${examName}" should not be in Missing Work Report`
        ).toBe(false)
      }
    } else {
      console.log(`  Testing fully-scored student: ${fullyScored.name} (id=${fullyScored.id})`)
      const totalScored = Object.values(fullyScored.results).filter((r) => r?.status === 'scored').length
      console.log(`  All ${totalScored} exams scored`)

      // Generate Missing Work Report
      const pdfResp = await page.request.get(
        `/api/reports/students/${fullyScored.id}/missing-report-pdf?preview=1`
      )
      expect(pdfResp.ok()).toBe(true)

      const pdfBytes = await pdfResp.body()
      const pdfText = pdfBytes.toString('latin1')

      // None of the scored exam names should appear in the missing work report
      for (const exam of data!.exams) {
        const isInMissing = pdfText.includes(exam.exam_name)
        if (isInMissing) {
          console.error(
            `  FAIL: Exam "${exam.exam_name}" is scored but appears in Missing Work Report!`
          )
        }
        expect.soft(
          isInMissing,
          `Scored exam "${exam.exam_name}" should not be in Missing Work Report`
        ).toBe(false)
      }
    }
  })
})

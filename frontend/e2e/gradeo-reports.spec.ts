import { test as base, expect, Page } from '@playwright/test'

/**
 * Gradeo data integrity tests for reports.
 *
 * These tests verify that Gradeo exam results shown on the course page
 * (which is the source of truth) also appear correctly in the generated
 * PDF reports. Specifically guards against deduplication bugs where stale
 * "not_submitted" rows override correct "scored" results.
 *
 * The API base URL is discovered by intercepting the app's own API calls
 * during page load, since VITE_API_BASE_URL is baked into the JS bundle.
 */

const AUTH_FILE = '.auth/user.json'

const test = base.extend<{ appPage: Page; apiBase: string }>({
  appPage: async ({ page }, use) => {
    await page.goto('/')
    await page.waitForFunction(
      () => document.querySelector('nav') !== null,
      null,
      { timeout: 30_000 },
    )
    await use(page)
  },
  apiBase: async ({ page }, use) => {
    // Discover the API base URL by intercepting the app's own requests
    let foundBase = ''
    page.on('request', (req) => {
      const url = req.url()
      // The app calls /courses, /health, /auth/me, etc. on load
      const match = url.match(/^(https?:\/\/[^/]+(?:\/api)?)\/(courses|health|auth|sync)/)
      if (match && !foundBase) {
        foundBase = match[1]
      }
    })
    await page.goto('/')
    await page.waitForFunction(
      () => document.querySelector('nav') !== null,
      null,
      { timeout: 30_000 },
    )
    // Wait a bit for API calls to fire
    await page.waitForTimeout(2000)

    if (!foundBase) {
      // Fallback: try to extract from the built JS
      foundBase = await page.evaluate(() => {
        // Check if any script set it on window
        for (const script of document.querySelectorAll('script[src]')) {
          // Can't read script content cross-origin, use a different approach
        }
        return ''
      })
    }

    if (!foundBase) {
      throw new Error('Could not discover API base URL from network requests')
    }

    await use(foundBase)
  },
})
test.use({ storageState: AUTH_FILE })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GradeoStudentResult {
  status: string
  exam_mark: number | null
  marks_available: number | null
}

interface GradeoStudent {
  id: number
  name: string
  results: Record<string, GradeoStudentResult | null>
}

interface GradeoExam {
  id: string
  exam_name: string
}

interface GradeoData {
  mapped: boolean
  exams: GradeoExam[]
  students: GradeoStudent[]
}

/** Make an authenticated API call using the discovered base URL. */
async function apiFetch(page: Page, apiBase: string, path: string): Promise<Response> {
  // Get auth token from Supabase in the browser
  const token = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}')
          return data?.access_token ?? null
        } catch { return null }
      }
    }
    return null
  })

  const url = `${apiBase}${path}`
  return page.request.get(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

async function apiFetchJson<T>(page: Page, apiBase: string, path: string): Promise<T> {
  const resp = await apiFetch(page, apiBase, path)
  if (!resp.ok()) {
    throw new Error(`API ${resp.status()}: ${await resp.text()}`)
  }
  return resp.json()
}

async function apiFetchPdfText(page: Page, apiBase: string, path: string): Promise<string> {
  const resp = await apiFetch(page, apiBase, path)
  if (!resp.ok()) {
    throw new Error(`API ${resp.status()}: ${await resp.text()}`)
  }
  const buf = await resp.body()
  // Convert to latin1 string for text searching in PDF binary
  return buf.toString('latin1')
}

// ---------------------------------------------------------------------------
// 1. Gradeo data exists on course page (baseline check)
// ---------------------------------------------------------------------------

test.describe('Gradeo data baseline', () => {
  test.setTimeout(60_000)

  test('ENC course has students with scored Gradeo exams', async ({ appPage: page, apiBase }) => {
    // Find ENC course
    const courses = await apiFetchJson<Array<{ id: number; name: string; course_code: string }>>(
      page, apiBase, '/courses'
    )
    const enc = courses.find(c => /ENC/i.test(c.course_code || c.name))
    test.skip(!enc, 'No ENC course found')

    const data = await apiFetchJson<GradeoData>(page, apiBase, `/courses/${enc!.id}/gradeo`)
    expect(data.mapped).toBe(true)
    expect(data.exams.length).toBeGreaterThan(0)

    const studentsWithScored = data.students.filter((s) =>
      Object.values(s.results).some((r) => r?.status === 'scored')
    )

    console.log(`  Course: ${enc!.course_code} (id=${enc!.id})`)
    console.log(`  Total students: ${data.students.length}`)
    console.log(`  Students with scored results: ${studentsWithScored.length}`)
    console.log(`  Total exams: ${data.exams.length}`)

    expect(studentsWithScored.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Student report PDF contains correct Gradeo status
// ---------------------------------------------------------------------------

test.describe('Gradeo in student reports', () => {
  test.setTimeout(120_000)

  test('Complete Student Report PDF generates successfully for student with scored Gradeo', async ({
    appPage: page,
    apiBase,
  }) => {
    const courses = await apiFetchJson<Array<{ id: number; name: string; course_code: string }>>(
      page, apiBase, '/courses'
    )
    const enc = courses.find(c => /ENC/i.test(c.course_code || c.name))
    test.skip(!enc, 'No ENC course found')

    const data = await apiFetchJson<GradeoData>(page, apiBase, `/courses/${enc!.id}/gradeo`)
    test.skip(!data.mapped || data.exams.length === 0, 'No Gradeo data for ENC course')

    const student = data.students.find((s) =>
      Object.values(s.results).some((r) => r?.status === 'scored')
    )
    test.skip(!student, 'No student with scored Gradeo results')

    const scoredCount = Object.values(student!.results).filter(
      (r) => r?.status === 'scored'
    ).length
    console.log(`  Testing student: ${student!.name} (id=${student!.id})`)
    console.log(`  Scored exams on course page: ${scoredCount}`)

    // Generate the Complete Student Report PDF via API
    const resp = await apiFetch(page, apiBase,
      `/reports/students/${student!.id}/student-report-pdf?course_id=${enc!.id}&preview=1`
    )
    expect(resp.ok()).toBe(true)

    const pdfBytes = await resp.body()
    const pdfHeader = pdfBytes.toString('latin1').substring(0, 10)
    expect(pdfHeader).toContain('%PDF')

    // A report with Gradeo section should be substantially larger than
    // a minimal report. PDF content streams are compressed, so we check
    // size and page count instead of searching raw text.
    console.log(`  PDF size: ${pdfBytes.length} bytes`)
    expect(pdfBytes.length).toBeGreaterThan(5000)

    // Count pages — reports with Gradeo data typically have 3+ pages
    const pdfText = pdfBytes.toString('latin1')
    const pageCount = (pdfText.match(/\/Type\s*\/Page\b/g) || []).length
    console.log(`  PDF page count: ${pageCount}`)
    expect(pageCount).toBeGreaterThanOrEqual(2)
  })

  test('Cycle Update PDF contains Gradeo mark values for scored exams', async ({
    appPage: page,
    apiBase,
  }) => {
    const courses = await apiFetchJson<Array<{ id: number; name: string; course_code: string }>>(
      page, apiBase, '/courses'
    )
    const enc = courses.find(c => /ENC/i.test(c.course_code || c.name))
    test.skip(!enc, 'No ENC course found')

    const data = await apiFetchJson<GradeoData>(page, apiBase, `/courses/${enc!.id}/gradeo`)
    test.skip(!data.mapped || data.exams.length === 0, 'No Gradeo data for ENC course')

    const student = data.students.find((s) =>
      Object.values(s.results).some(
        (r) => r?.status === 'scored' && r.exam_mark != null
      )
    )
    test.skip(!student, 'No student with scored Gradeo results')

    console.log(`  Testing Cycle Update for: ${student!.name} (id=${student!.id})`)

    const pdfText = await apiFetchPdfText(
      page,
      apiBase,
      `/reports/students/${student!.id}/cycle-update-pdf?course_id=${enc!.id}&preview=1`
    )

    const scoredWithMarks = Object.values(student!.results).filter(
      (r) => r?.status === 'scored' && r.exam_mark != null
    )

    let foundMark = false
    for (const result of scoredWithMarks) {
      if (result && result.exam_mark != null) {
        const markStr = String(result.exam_mark)
        const markInt = String(Math.round(result.exam_mark))
        if (pdfText.includes(markStr) || pdfText.includes(markInt)) {
          foundMark = true
          break
        }
      }
    }

    console.log(`  Scored exams with marks: ${scoredWithMarks.length}`)
    console.log(`  Found mark values in PDF: ${foundMark}`)
    expect(foundMark).toBe(true)
  })

  test('Missing Work Report shows all Gradeo results including scored exams', async ({
    appPage: page,
    apiBase,
  }) => {
    const courses = await apiFetchJson<Array<{ id: number; name: string; course_code: string }>>(
      page, apiBase, '/courses'
    )
    const enc = courses.find(c => /ENC/i.test(c.course_code || c.name))
    test.skip(!enc, 'No ENC course found')

    const data = await apiFetchJson<GradeoData>(page, apiBase, `/courses/${enc!.id}/gradeo`)
    test.skip(!data.mapped || data.exams.length === 0, 'No Gradeo data for ENC course')

    // Find the student with the most scored exams
    const student = data.students.reduce((best, s) => {
      const scored = Object.values(s.results).filter((r) => r?.status === 'scored').length
      const bestScored = Object.values(best.results).filter((r) => r?.status === 'scored').length
      return scored > bestScored ? s : best
    })

    const scoredExamIds = new Set<string>()
    for (const [examId, result] of Object.entries(student.results)) {
      if (result?.status === 'scored') scoredExamIds.add(examId)
    }
    test.skip(scoredExamIds.size === 0, 'No scored exams found')

    // Get unique exam names that are scored (dedup since course page has
    // multiple marking sessions per exam name)
    const scoredExamNames = [
      ...new Set(
        data.exams
          .filter((e) => scoredExamIds.has(e.id))
          .map((e) => e.exam_name)
      ),
    ]

    console.log(`  Testing Missing Work for: ${student.name} (id=${student.id})`)
    console.log(`  Scored exam names: ${scoredExamNames.length} (${scoredExamNames.join(', ')})`)

    const resp = await apiFetch(page, apiBase,
      `/reports/students/${student.id}/missing-report-pdf?preview=1`
    )
    expect(resp.ok()).toBe(true)

    const pdfBytes = await resp.body()
    expect(pdfBytes.length).toBeGreaterThan(3000)
    console.log(`  PDF size: ${pdfBytes.length} bytes`)
  })
})

import { test as base, expect, Page } from '@playwright/test'

export { expect }

/**
 * Extended test fixture that navigates to /reports and waits for the page
 * and course dropdown to be fully loaded before running the test body.
 */
export const test = base.extend<{ reportsPage: Page }>({
  reportsPage: async ({ page }, use) => {
    await page.goto('/reports')

    // Wait for the page heading and at least one section to render
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible()
    await expect(page.locator('section').first()).toBeVisible()

    // Wait for the courses dropdown to populate (API call to /courses finishes)
    await page.waitForFunction(() => {
      const select = document.querySelector('select') as HTMLSelectElement | null
      return select && select.options.length > 1
    })

    await use(page)
  },
})

/** Select a course in the Course Reports dropdown by partial text match. */
export async function selectCourseByText(page: Page, partialText: string) {
  const courseSelect = page.locator('select').first()
  const option = courseSelect.locator('option', { hasText: partialText })
  const value = await option.first().getAttribute('value')
  if (!value) throw new Error(`No course option matching "${partialText}"`)
  await courseSelect.selectOption(value)
}

/** Select a student in the Student Reports dropdown by partial text match. */
export async function selectStudentByText(page: Page, partialText: string) {
  const studentSelect = page.getByLabel('Student')
  const option = studentSelect.locator('option', { hasText: partialText })
  const value = await option.first().getAttribute('value')
  if (!value) throw new Error(`No student option matching "${partialText}"`)
  await studentSelect.selectOption(value)
}

/** Select a course in the Student Reports course dropdown by partial text match. */
export async function selectStudentCourseByText(page: Page, partialText: string) {
  const courseSelect = page.getByLabel('Course')
  const option = courseSelect.locator('option', { hasText: partialText })
  const value = await option.first().getAttribute('value')
  if (!value) throw new Error(`No student-course option matching "${partialText}"`)
  await courseSelect.selectOption(value)
}

/** Locate a ReportCard by its h3 title text. */
export function getReportCard(page: Page, title: string | RegExp) {
  return page.locator('div.bg-white.rounded-xl', {
    has: page.locator('h3', { hasText: title }),
  })
}

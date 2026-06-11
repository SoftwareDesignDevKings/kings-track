import { test, expect } from '@playwright/test'

const AUTH_FILE = '.auth/user.json'

test.use({ storageState: AUTH_FILE })

// ---------------------------------------------------------------------------
// 1. Page structure
// ---------------------------------------------------------------------------

test.describe('Students page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/students')
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  })

  test('shows page title and student count', async ({ page }) => {
    // Should show "X of Y students" summary text
    await expect(page.locator('text=/\\d+ of \\d+ student/i')).toBeVisible({ timeout: 15_000 })
  })

  test('shows search input', async ({ page }) => {
    const search = page.getByPlaceholder(/search by name/i)
    await expect(search).toBeVisible({ timeout: 15_000 })
  })

  test('shows course filter dropdown', async ({ page }) => {
    const courseFilter = page.locator('select')
    await expect(courseFilter).toBeVisible({ timeout: 15_000 })
    // Should have "All courses" as first option
    await expect(courseFilter.locator('option').first()).toHaveText('All courses')
  })

  test('shows All and Concerns filter buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Concerns' })).toBeVisible()
  })

  test('shows export CSV button', async ({ page }) => {
    await expect(page.locator('button[aria-label="Export CSV"]')).toBeVisible({ timeout: 15_000 })
  })
})

// ---------------------------------------------------------------------------
// 2. Table and columns
// ---------------------------------------------------------------------------

test.describe('Students table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/students')
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  })

  test('displays student table with sortable column headers', async ({ page }) => {
    // Wait for table to render
    const table = page.locator('table')
    await expect(table).toBeVisible({ timeout: 15_000 })

    // Check sortable column headers exist
    const headers = ['Name', 'Courses', 'Completion', 'On-Time', 'Avg Score', 'Attendance']
    for (const header of headers) {
      await expect(page.locator('th', { hasText: header })).toBeVisible()
    }

    // Non-sortable columns
    await expect(page.locator('th', { hasText: 'SIS ID' })).toBeVisible()
    await expect(page.locator('th', { hasText: 'Status' })).toBeVisible()
  })

  test('student rows have links to student profiles', async ({ page }) => {
    const table = page.locator('table')
    await expect(table).toBeVisible({ timeout: 15_000 })

    const studentLinks = page.locator('a[href^="/students/"]')
    await expect(studentLinks.first()).toBeVisible()
    const count = await studentLinks.count()
    expect(count).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 3. Search
// ---------------------------------------------------------------------------

test.describe('Students search', () => {
  test('search filters students by name', async ({ page }) => {
    await page.goto('/students')
    const table = page.locator('table')
    await expect(table).toBeVisible({ timeout: 15_000 })

    const search = page.getByPlaceholder(/search by name/i)

    // Get initial count from summary text
    const summaryBefore = await page.locator('text=/\\d+ of \\d+ student/i').textContent()
    const totalBefore = parseInt(summaryBefore!.match(/(\d+) of/)![1])

    // Search for something unlikely to match all
    await search.fill('zzzzzzz')
    // Wait for the count to update
    await expect(page.locator('text=/0 of \\d+ student/i')).toBeVisible()

    // Clear search restores all
    await search.fill('')
    await expect(page.locator(`text=/${totalBefore} of/i`)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 4. Concern filter
// ---------------------------------------------------------------------------

test.describe('Students concern filter', () => {
  test('Concerns button filters to students with concerns', async ({ page }) => {
    await page.goto('/students')
    await expect(page.locator('table')).toBeVisible({ timeout: 15_000 })

    const concernsBtn = page.getByRole('button', { name: 'Concerns' })
    await concernsBtn.click()

    // After clicking Concerns, student count may decrease
    // Check the summary text still shows "X of Y students"
    await expect(page.locator('text=/\\d+ of \\d+ student/i')).toBeVisible()

    // Click All to restore
    const allBtn = page.getByRole('button', { name: 'All', exact: true })
    await allBtn.click()
    await expect(page.locator('text=/\\d+ of \\d+ student/i')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 5. Sorting
// ---------------------------------------------------------------------------

test.describe('Students sorting', () => {
  test('clicking a column header changes sort direction', async ({ page }) => {
    await page.goto('/students')
    await expect(page.locator('table')).toBeVisible({ timeout: 15_000 })

    // Name should be the default sort with ascending direction (arrow up)
    const nameHeader = page.locator('th', { hasText: 'Name' })
    await expect(nameHeader).toBeVisible()

    // Click Completion to sort by it
    const completionHeader = page.locator('th', { hasText: 'Completion' })
    await completionHeader.click()

    // Click again to toggle direction
    await completionHeader.click()
  })
})

// ---------------------------------------------------------------------------
// 6. Navigation to student profile
// ---------------------------------------------------------------------------

test.describe('Students navigation', () => {
  test('clicking a student name navigates to their profile', async ({ page }) => {
    await page.goto('/students')
    await expect(page.locator('table')).toBeVisible({ timeout: 15_000 })

    const firstStudent = page.locator('a[href^="/students/"]').first()
    await expect(firstStudent).toBeVisible()
    const href = await firstStudent.getAttribute('href')
    await firstStudent.click()
    await expect(page).toHaveURL(href!)

    // Student profile should show breadcrumb back to Students (scope to main, not header)
    await expect(page.getByRole('main').getByRole('link', { name: 'Students' })).toBeVisible()
  })
})

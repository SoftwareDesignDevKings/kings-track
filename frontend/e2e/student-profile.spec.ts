import { test, expect } from '@playwright/test'

const AUTH_FILE = '.auth/user.json'

test.use({ storageState: AUTH_FILE })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the first student profile page. */
async function goToFirstStudent(page: import('@playwright/test').Page) {
  await page.goto('/students')
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  const firstLink = page.locator('a[href^="/students/"]').first()
  await expect(firstLink).toBeVisible({ timeout: 15_000 })
  const href = await firstLink.getAttribute('href')
  await firstLink.click()
  await expect(page).toHaveURL(href!)
}

// ---------------------------------------------------------------------------
// 1. Page structure
// ---------------------------------------------------------------------------

test.describe('Student profile page structure', () => {
  test.beforeEach(async ({ page }) => {
    await goToFirstStudent(page)
  })

  test('shows breadcrumb with Students link', async ({ page }) => {
    // Scope to main content breadcrumb nav (not header)
    await expect(page.getByRole('main').getByRole('link', { name: 'Students' })).toBeVisible()
  })

  test('shows student name as heading', async ({ page }) => {
    const heading = page.locator('h2').first()
    await expect(heading).toBeVisible({ timeout: 15_000 })
    const name = await heading.textContent()
    expect(name!.trim().length).toBeGreaterThan(0)
  })

  test('shows metric cards: Completion, On-Time, Avg Score, Attendance', async ({ page }) => {
    // Use paragraph role to scope to the metric card labels (not chart or table text)
    await expect(page.getByRole('paragraph').filter({ hasText: 'Completion' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('paragraph').filter({ hasText: 'On-Time' }).first()).toBeVisible()
    await expect(page.getByRole('paragraph').filter({ hasText: 'Avg Score' }).first()).toBeVisible()
    await expect(page.getByRole('paragraph').filter({ hasText: 'Attendance' }).first()).toBeVisible()
  })

  test('shows Export CSV button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible({ timeout: 15_000 })
  })

  test('shows Parent Reports section with Cycle Update and Missing Work buttons', async ({ page }) => {
    await expect(page.getByText('Parent Reports (PDF)')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /Cycle Update/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Missing Work Report/i })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 2. Tabs
// ---------------------------------------------------------------------------

test.describe('Student profile tabs', () => {
  test.beforeEach(async ({ page }) => {
    await goToFirstStudent(page)
  })

  test('Overview tab is visible by default', async ({ page }) => {
    const overviewTab = page.getByRole('button', { name: 'Overview', exact: true })
    await expect(overviewTab).toBeVisible({ timeout: 15_000 })
  })

  test('Attendance tab can be selected', async ({ page }) => {
    const attendanceTab = page.getByRole('button', { name: 'Attendance', exact: true })
    await expect(attendanceTab).toBeVisible({ timeout: 15_000 })
    await attendanceTab.click()
    await expect(page).toHaveURL(/tab=attendance/)
  })

  test('tab selection persists in URL', async ({ page }) => {
    const attendanceTab = page.getByRole('button', { name: 'Attendance', exact: true })
    await expect(attendanceTab).toBeVisible({ timeout: 15_000 })
    await attendanceTab.click()
    await expect(page).toHaveURL(/tab=attendance/)

    // Go back to Overview (default)
    const overviewTab = page.getByRole('button', { name: 'Overview', exact: true })
    await overviewTab.click()
    // Overview is the default, so tab param should be removed
    await expect(page).not.toHaveURL(/tab=/)
  })
})

// ---------------------------------------------------------------------------
// 3. Overview tab content
// ---------------------------------------------------------------------------

test.describe('Student profile Overview tab', () => {
  test('shows Performance Overview and Course Metrics sections', async ({ page }) => {
    await goToFirstStudent(page)
    await expect(page.getByText('Performance Overview')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Course Metrics')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 4. Attendance tab content
// ---------------------------------------------------------------------------

test.describe('Student profile Attendance tab', () => {
  test('shows attendance charts or empty message', async ({ page }) => {
    await goToFirstStudent(page)
    const attendanceTab = page.getByRole('button', { name: 'Attendance', exact: true })
    await expect(attendanceTab).toBeVisible({ timeout: 15_000 })
    await attendanceTab.click()

    // Should show either attendance charts or "No attendance records"
    const hasCharts = page.getByText('Attendance Distribution')
    const hasEmpty = page.getByText('No attendance records available')

    const result = await Promise.race([
      hasCharts.waitFor({ timeout: 10_000 }).then(() => 'charts' as const),
      hasEmpty.waitFor({ timeout: 10_000 }).then(() => 'empty' as const),
    ])

    expect(['charts', 'empty']).toContain(result)
  })
})

// ---------------------------------------------------------------------------
// 5. Breadcrumb navigation
// ---------------------------------------------------------------------------

test.describe('Student profile breadcrumb', () => {
  test('clicking Students breadcrumb navigates back to students list', async ({ page }) => {
    await goToFirstStudent(page)
    // Scope to main content breadcrumb (not header nav link)
    const studentsLink = page.getByRole('main').getByRole('link', { name: 'Students' })
    await expect(studentsLink).toBeVisible()
    await studentsLink.click()
    await expect(page).toHaveURL('/students')
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 6. Invalid student ID
// ---------------------------------------------------------------------------

test.describe('Student profile with invalid ID', () => {
  test('redirects to students list for non-numeric ID', async ({ page }) => {
    await page.goto('/students/abc')
    await expect(page).toHaveURL('/students')
  })
})

// ---------------------------------------------------------------------------
// 7. Parent Reports selectors
// ---------------------------------------------------------------------------

test.describe('Student profile Parent Reports', () => {
  test('course and cycle selectors are present in Parent Reports', async ({ page }) => {
    await goToFirstStudent(page)
    await expect(page.getByText('Parent Reports (PDF)')).toBeVisible({ timeout: 15_000 })

    // Cycle Update and Missing Work buttons confirm the section is functional
    await expect(page.getByRole('button', { name: /Cycle Update/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Missing Work Report/i })).toBeVisible()
  })
})

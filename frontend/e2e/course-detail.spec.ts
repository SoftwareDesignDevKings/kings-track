import { test, expect } from '@playwright/test'

const AUTH_FILE = '.auth/user.json'

test.use({ storageState: AUTH_FILE })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the first course detail page via clicking a course card button. */
async function goToFirstCourse(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
  // Course cards are <button> elements (not links)
  const firstCard = page.locator('main button').filter({ has: page.locator('h2') }).first()
  await expect(firstCard).toBeVisible({ timeout: 15_000 })
  await firstCard.click()
  await expect(page).toHaveURL(/\/courses\/\d+/)
}

// ---------------------------------------------------------------------------
// 1. Page structure
// ---------------------------------------------------------------------------

test.describe('Course detail page structure', () => {
  test.beforeEach(async ({ page }) => {
    await goToFirstCourse(page)
  })

  test('shows breadcrumb with Courses link', async ({ page }) => {
    // Scope to main to avoid matching header nav link
    const coursesLink = page.getByRole('main').getByRole('link', { name: 'Courses' })
    await expect(coursesLink).toBeVisible()
  })

  test('shows course name heading', async ({ page }) => {
    // Wait for loading to complete — course name appears as h2
    const heading = page.locator('main h2').first()
    await expect(heading).toBeVisible({ timeout: 15_000 })
    const text = await heading.textContent()
    expect(text!.length).toBeGreaterThan(0)
  })

  test('shows stats: Students, Activities, Avg completion', async ({ page }) => {
    await expect(page.getByText('Students')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Activities')).toBeVisible()
    await expect(page.getByText('Avg completion')).toBeVisible()
  })

  test('shows Class List export button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Class List/i })).toBeVisible({ timeout: 15_000 })
  })
})

// ---------------------------------------------------------------------------
// 2. Tabs
// ---------------------------------------------------------------------------

test.describe('Course detail tabs', () => {
  test.beforeEach(async ({ page }) => {
    await goToFirstCourse(page)
  })

  test('Canvas tab is visible by default', async ({ page }) => {
    // Canvas is the default/first tab
    const canvasTab = page.getByRole('button', { name: 'Canvas', exact: true })
    await expect(canvasTab).toBeVisible({ timeout: 15_000 })
  })

  test('Engagement tab can be selected', async ({ page }) => {
    const engagementTab = page.getByRole('button', { name: 'Engagement', exact: true })
    await expect(engagementTab).toBeVisible({ timeout: 15_000 })
    await engagementTab.click()
    await expect(page).toHaveURL(/tab=engagement/)
  })

  test('tab selection persists in URL query params', async ({ page }) => {
    // Wait for tabs to load
    const engagementTab = page.getByRole('button', { name: 'Engagement', exact: true })
    await expect(engagementTab).toBeVisible({ timeout: 15_000 })
    await engagementTab.click()
    await expect(page).toHaveURL(/tab=engagement/)

    // Navigate back to Canvas
    const canvasTab = page.getByRole('button', { name: 'Canvas', exact: true })
    await canvasTab.click()
    // Canvas is the default tab, so ?tab= should be removed
    await expect(page).not.toHaveURL(/tab=/)
  })
})

// ---------------------------------------------------------------------------
// 3. Breadcrumb navigation
// ---------------------------------------------------------------------------

test.describe('Course detail breadcrumb', () => {
  test('clicking Courses breadcrumb navigates back to overview', async ({ page }) => {
    await goToFirstCourse(page)
    // Scope to main breadcrumb to avoid matching header nav link
    const coursesLink = page.getByRole('main').getByRole('link', { name: 'Courses' })
    await expect(coursesLink).toBeVisible()
    await coursesLink.click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 4. Invalid course ID
// ---------------------------------------------------------------------------

test.describe('Course detail with invalid ID', () => {
  test('redirects to overview for non-numeric course ID', async ({ page }) => {
    await page.goto('/courses/abc')
    await expect(page).toHaveURL('/')
  })
})

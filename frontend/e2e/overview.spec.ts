import { test, expect } from '@playwright/test'

const AUTH_FILE = '.auth/user.json'

test.use({ storageState: AUTH_FILE })

// ---------------------------------------------------------------------------
// Courses overview page (/)
// ---------------------------------------------------------------------------

test.describe('Courses overview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
  })

  test('shows page title and course count', async ({ page }) => {
    // Should show "X current, Y archived" or "X courses synced"
    await expect(page.locator('text=/\\d+ (current|course)/i')).toBeVisible()
  })

  test('displays course cards as clickable buttons', async ({ page }) => {
    // Course cards are rendered as <button> elements (not links)
    const cards = page.locator('main button').filter({ has: page.locator('h2') })
    await expect(cards.first()).toBeVisible({ timeout: 15_000 })
    const count = await cards.count()
    expect(count).toBeGreaterThan(0)
  })

  test('course cards show stats', async ({ page }) => {
    // Wait for cards to load — cards contain "Students" stat text
    const firstCard = page.locator('main button').filter({ has: page.locator('h2') }).first()
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    // Cards should have student count and completion stats
    await expect(firstCard.getByText('Students')).toBeVisible()
  })

  test('clicking a course card navigates to course detail', async ({ page }) => {
    const firstCard = page.locator('main button').filter({ has: page.locator('h2') }).first()
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    await firstCard.click()
    // Should navigate to /courses/:id
    await expect(page).toHaveURL(/\/courses\/\d+/)
    // Should show breadcrumb with "Courses" link (scope to main, not header)
    await expect(page.getByRole('main').getByRole('link', { name: 'Courses' })).toBeVisible()
  })

  test('archived courses section exists if there are archived courses', async ({ page }) => {
    // Check if "Archived" heading exists (may not if no archived courses)
    const archivedSection = page.getByRole('heading', { name: 'Archived' })
    const hasArchived = (await archivedSection.count()) > 0
    if (hasArchived) {
      // Should have a collapse/expand button
      const toggleBtn = page.locator('button[aria-expanded]')
      await expect(toggleBtn).toBeVisible()
    }
  })
})

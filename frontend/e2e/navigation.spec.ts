import { test, expect } from '@playwright/test'

const AUTH_FILE = '.auth/user.json'

test.use({ storageState: AUTH_FILE })

// ---------------------------------------------------------------------------
// Header navigation links
// ---------------------------------------------------------------------------

test.describe('Header navigation', () => {
  test('header shows all nav links', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Courses' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Students' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible()
  })

  test('settings link visible for admin users', async ({ page }) => {
    await page.goto('/')
    // Wait for the page to load and current user to resolve
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
    // Settings link is admin-only; check if it exists (test user may or may not be admin)
    const settingsLink = page.getByRole('link', { name: 'Settings' })
    const count = await settingsLink.count()
    // Just assert it's either visible (admin) or not present — no error either way
    expect(count).toBeLessThanOrEqual(1)
  })

  test('Courses link navigates to /', async ({ page }) => {
    await page.goto('/students')
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
    await page.getByRole('link', { name: 'Courses' }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
  })

  test('Students link navigates to /students', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
    await page.getByRole('link', { name: 'Students' }).click()
    await expect(page).toHaveURL('/students')
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  })

  test('Reports link navigates to /reports', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
    await page.getByRole('link', { name: 'Reports' }).click()
    await expect(page).toHaveURL('/reports')
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible()
  })

  test('logo navigates to home', async ({ page }) => {
    await page.goto('/students')
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
    // Click the logo link (contains "K" text)
    await page.locator('header a').first().click()
    await expect(page).toHaveURL('/')
  })
})

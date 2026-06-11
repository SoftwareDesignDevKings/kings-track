import { test, expect } from '@playwright/test'

const AUTH_FILE = '.auth/user.json'

test.use({ storageState: AUTH_FILE })

/** Locate the settings tab navigation bar. */
function tabNav(page: import('@playwright/test').Page) {
  return page.getByRole('navigation', { name: 'Settings sections' })
}

// ---------------------------------------------------------------------------
// 1. Page structure and tabs
// ---------------------------------------------------------------------------

test.describe('Settings page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin')
  })

  test('shows Settings heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 })
  })

  test('shows all four tab buttons: Sync, Users, Courses, Integrations', async ({ page }) => {
    const nav = tabNav(page)
    await expect(nav).toBeVisible({ timeout: 15_000 })
    await expect(nav.getByRole('button', { name: 'Sync' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Users' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Courses' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Integrations' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 2. Sync tab
// ---------------------------------------------------------------------------

test.describe('Settings Sync tab', () => {
  test('shows sync status and trigger button', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 })

    // Sync is the default tab — look for sync-related content
    const syncBtn = page.getByRole('button', { name: /Sync Now|Syncing/i })
    await expect(syncBtn).toBeVisible({ timeout: 15_000 })
  })

  test('shows sync description blurb', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByText(/Monitor Canvas sync status/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ---------------------------------------------------------------------------
// 3. Users tab
// ---------------------------------------------------------------------------

test.describe('Settings Users tab', () => {
  test('shows user management form', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 })

    await tabNav(page).getByRole('button', { name: 'Users' }).click()

    // Should show blurb and email input for adding users
    await expect(page.getByText(/Control who can access/i).first()).toBeVisible()
    await expect(page.getByPlaceholder('user@example.com')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 4. Courses tab
// ---------------------------------------------------------------------------

test.describe('Settings Courses tab', () => {
  test('shows course whitelist management', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 })

    await tabNav(page).getByRole('button', { name: 'Courses' }).click()

    // Should show the courses blurb
    await expect(page.getByText(/Choose which courses are visible/i)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 5. Integrations tab
// ---------------------------------------------------------------------------

test.describe('Settings Integrations tab', () => {
  test('shows EdStem and Gradeo mapping sections', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 })

    await tabNav(page).getByRole('button', { name: 'Integrations' }).click()

    // Should show integrations blurb
    await expect(page.getByText(/Connect the Gradeo extension/i)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 6. Tab switching
// ---------------------------------------------------------------------------

test.describe('Settings tab switching', () => {
  test('switching tabs changes displayed content', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 })
    const nav = tabNav(page)

    // Start on Sync (default)
    await expect(page.getByText(/Monitor Canvas sync status/i)).toBeVisible()

    // Switch to Users
    await nav.getByRole('button', { name: 'Users' }).click()
    await expect(page.getByText(/Control who can access/i).first()).toBeVisible()

    // Switch to Courses
    await nav.getByRole('button', { name: 'Courses' }).click()
    await expect(page.getByText(/Choose which courses are visible/i)).toBeVisible()

    // Switch to Integrations
    await nav.getByRole('button', { name: 'Integrations' }).click()
    await expect(page.getByText(/Connect the Gradeo extension/i)).toBeVisible()

    // Switch back to Sync
    await nav.getByRole('button', { name: 'Sync' }).click()
    await expect(page.getByText(/Monitor Canvas sync status/i)).toBeVisible()
  })
})

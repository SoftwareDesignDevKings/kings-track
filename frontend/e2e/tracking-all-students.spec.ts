import { test, expect } from '@playwright/test'

const AUTH_FILE = '.auth/user.json'

test.use({ storageState: AUTH_FILE })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the first course group page via clicking a course card. */
async function goToFirstCourseGroup(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
  // Course group cards are <button> elements containing an h2
  const firstCard = page.locator('main button').filter({ has: page.locator('h2') }).first()
  await expect(firstCard).toBeVisible({ timeout: 15_000 })
  await firstCard.click()
  // Should navigate to either /courses/group/:code or /courses/:id
  await expect(page).toHaveURL(/\/courses\//)
}

/** Count student rows visible in the currently active table (tbody rows). */
async function countTableStudentRows(page: import('@playwright/test').Page) {
  // Wait for table to render
  const tbody = page.locator('table tbody, [role="table"] [role="rowgroup"]').first()
  await expect(tbody).toBeVisible({ timeout: 15_000 })
  // Count rows excluding summary rows (Total, Average, Std Dev)
  const rows = tbody.locator('tr:not([class*="font-medium"])')
  return rows.count()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Tracking tab shows all students', () => {
  test('course group tracking tab includes students from all classes', async ({ page }) => {
    await goToFirstCourseGroup(page)

    // If this is a course group page (/courses/group/...), check tracking
    const url = page.url()
    const isGroup = url.includes('/courses/group/')

    if (!isGroup) {
      // Single course — skip this test variant
      test.skip()
      return
    }

    // Go to the Canvas tab first and count students
    const canvasTab = page.getByRole('button', { name: 'Canvas', exact: true })
    await expect(canvasTab).toBeVisible({ timeout: 15_000 })
    await canvasTab.click()
    const canvasStudentCount = await countTableStudentRows(page)
    expect(canvasStudentCount).toBeGreaterThan(0)

    // Now switch to the Tracking tab
    const trackingTab = page.getByRole('button', { name: 'Tracking', exact: true })
    // Tracking tab may not be visible if no trackable assignments exist
    const trackingVisible = (await trackingTab.count()) > 0
    if (!trackingVisible) {
      test.skip()
      return
    }
    await trackingTab.click()

    // Wait for the tracking grid to load — it should have a table with students
    const trackingTable = page.locator('table').first()
    await expect(trackingTable).toBeVisible({ timeout: 15_000 })

    // Count student rows in the tracking table (first column cells in tbody)
    const trackingTbody = trackingTable.locator('tbody')
    await expect(trackingTbody).toBeVisible()
    const trackingStudentRows = await trackingTbody.locator('tr').count()
    expect(trackingStudentRows).toBeGreaterThan(0)

    // The tracking tab should have the same number of students as the canvas tab
    // (or at least as many — canvas may have summary rows we filtered out)
    expect(trackingStudentRows).toBeGreaterThanOrEqual(canvasStudentCount)
  })

  test('single course tracking tab shows all enrolled students', async ({ page }) => {
    // Navigate to a single course page
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()

    // Find and click a course card
    const firstCard = page.locator('main button').filter({ has: page.locator('h2') }).first()
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    await firstCard.click()
    await expect(page).toHaveURL(/\/courses\//)

    // If this landed on a group page, navigate into a specific class
    const url = page.url()
    if (url.includes('/courses/group/')) {
      // Click the first class link/button in the breadcrumb or class selector
      // Navigate to a direct course URL from the classes section
      const classLinks = page.locator('a[href*="/courses/"]').filter({ hasNot: page.locator('[href*="/group/"]') })
      const classCount = await classLinks.count()
      if (classCount === 0) {
        test.skip()
        return
      }
      await classLinks.first().click()
      await expect(page).toHaveURL(/\/courses\/\d+/)
    }

    // Count students on the Canvas tab
    const canvasTab = page.getByRole('button', { name: 'Canvas', exact: true })
    await expect(canvasTab).toBeVisible({ timeout: 15_000 })
    await canvasTab.click()
    const canvasStudentCount = await countTableStudentRows(page)

    if (canvasStudentCount === 0) {
      test.skip()
      return
    }

    // Switch to Tracking tab
    const trackingTab = page.getByRole('button', { name: 'Tracking', exact: true })
    const trackingVisible = (await trackingTab.count()) > 0
    if (!trackingVisible) {
      test.skip()
      return
    }
    await trackingTab.click()

    // Wait for tracking table
    const trackingTable = page.locator('table').first()
    await expect(trackingTable).toBeVisible({ timeout: 15_000 })

    const trackingTbody = trackingTable.locator('tbody')
    await expect(trackingTbody).toBeVisible()
    const trackingStudentRows = await trackingTbody.locator('tr').count()

    // All students from the Canvas tab should also appear in the Tracking tab
    expect(trackingStudentRows).toBeGreaterThanOrEqual(canvasStudentCount)
  })
})

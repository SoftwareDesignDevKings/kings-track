import { test as setup, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_FILE = path.join(__dirname, '..', '.auth', 'user.json')

setup('authenticate', async ({ page }) => {
  // If a valid auth file exists and is recent, skip re-auth
  if (fs.existsSync(AUTH_FILE)) {
    const stat = fs.statSync(AUTH_FILE)
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60_000
    if (ageMinutes < 30) {
      console.log(`Auth state is ${ageMinutes.toFixed(0)}m old — reusing.`)
      return
    }
  }

  await page.goto('/')

  // Wait for the page to settle: either the login form or authenticated nav appears.
  // ProtectedRoute renders null while loading, then either redirects to /login or
  // renders children. We need to wait for one of these outcomes.
  const loginButton = page.getByRole('button', { name: /sign in with google/i })
  const reportsLink = page.getByRole('link', { name: 'Reports' })

  const outcome = await Promise.race([
    loginButton.waitFor({ timeout: 15_000 }).then(() => 'login' as const),
    reportsLink.waitFor({ timeout: 15_000 }).then(() => 'authenticated' as const),
  ])

  if (outcome === 'login') {
    console.log('')
    console.log('='.repeat(50))
    console.log('  Manual login required.')
    console.log('  Click "Sign in with Google" in the browser')
    console.log('  and complete the OAuth flow.')
    console.log('='.repeat(50))
    console.log('')

    // Wait for the user to complete Google OAuth.
    // After successful auth, ProtectedRoute renders the app with the nav links.
    await reportsLink.waitFor({ timeout: 120_000 })
  }

  // Verify auth worked
  await expect(reportsLink).toBeVisible()

  // Ensure .auth directory exists
  const authDir = path.dirname(AUTH_FILE)
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true })
  }

  // Save storage state (cookies + localStorage including Supabase session)
  await page.context().storageState({ path: AUTH_FILE })
  console.log(`Auth state saved to ${AUTH_FILE}`)
})

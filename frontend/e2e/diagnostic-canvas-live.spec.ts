import { test as base, expect, Page } from '@playwright/test'

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
    let foundBase = ''
    page.on('request', (req) => {
      const url = req.url()
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
    await page.waitForTimeout(2000)
    if (!foundBase) {
      throw new Error('Could not discover API base URL')
    }
    await use(foundBase)
  },
})
test.use({ storageState: AUTH_FILE })

async function apiFetch(page: Page, apiBase: string, path: string) {
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
  return page.request.get(`${apiBase}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

test('Compare live Canvas vs DB for Adrienne in 11ENCX', async ({ appPage: page, apiBase }) => {
  test.setTimeout(120_000)

  const resp = await apiFetch(page, apiBase,
    '/reports/students/17727/debug-canvas-live?course_id=13504'
  )
  console.log(`  Live comparison endpoint status: ${resp.status()}`)

  if (!resp.ok()) {
    console.log(`  Error: ${await resp.text()}`)
    return
  }

  const data = await resp.json() as {
    student_id: number
    course_id: number
    total_assignments: number
    canvas_submissions_returned: number
    mismatches: number
    recent_syncs: Array<{ type: string; status: string; completed_at: string | null }>
    comparisons: Array<{
      assignment_id: number
      name: string
      db: {
        submission_id: number | null
        score: number | null
        grade: string | null
        workflow_state: string | null
        submitted_at: string | null
        graded_at: string | null
        synced_at: string | null
      } | null
      canvas_live: {
        id: number | null
        score: number | null
        grade: string | null
        workflow_state: string | null
        submitted_at: string | null
        graded_at: string | null
        grader_id: number | null
        submission_type: string | null
      } | null
      score_match: boolean | null
    }>
  }

  console.log(`\n  === RECENT SYNCS ===`)
  for (const s of data.recent_syncs) {
    console.log(`  ${s.type.padEnd(20)} | ${s.status.padEnd(10)} | ${s.completed_at ?? '—'}`)
  }

  console.log(`\n  === COMPARISON: ${data.total_assignments} assignments, ${data.canvas_submissions_returned} Canvas subs, ${data.mismatches} MISMATCHES ===\n`)

  for (const c of data.comparisons) {
    const dbScore = c.db?.score
    const canvasScore = c.canvas_live?.score
    const dbState = c.db?.workflow_state ?? '—'
    const canvasState = c.canvas_live?.workflow_state ?? '—'
    const match = c.score_match
    const marker = match === false ? '!!!' : (c.name.match(/^2\.\d/) ? '>>>' : '   ')

    console.log(
      `  ${marker} ${c.name.padEnd(45)} | ` +
      `DB: score=${String(dbScore ?? '—').padEnd(6)} state=${dbState.padEnd(12)} | ` +
      `Canvas: score=${String(canvasScore ?? '—').padEnd(6)} state=${canvasState.padEnd(12)} | ` +
      `grader=${c.canvas_live?.grader_id ?? '—'} | ` +
      `type=${c.canvas_live?.submission_type ?? '—'}`
    )
  }

  if (data.mismatches > 0) {
    console.log(`\n  === MISMATCHES DETAIL ===`)
    const mismatches = data.comparisons.filter(c => c.score_match === false)
    for (const m of mismatches) {
      console.log(`  ${m.name}:`)
      console.log(`    DB score: ${m.db?.score} | Canvas score: ${m.canvas_live?.score}`)
      console.log(`    DB state: ${m.db?.workflow_state} | Canvas state: ${m.canvas_live?.workflow_state}`)
      console.log(`    DB synced: ${m.db?.synced_at}`)
      console.log(`    Canvas graded_at: ${m.canvas_live?.graded_at}`)
      console.log(`    Canvas grader_id: ${m.canvas_live?.grader_id}`)
    }
  }
})

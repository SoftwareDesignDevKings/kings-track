# Gradeo Token Auto-Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect the Gradeo bearer token and school id from an open Gradeo page so admins no longer need to paste request headers.

**Architecture:** Add shared session helpers for safe token/school-id extraction, a Gradeo content bridge that scans page storage and observes page requests, and background storage APIs that prefer captured sessions over manual headers. The popup gains a detect action and displays Gradeo session state without revealing token text.

**Tech Stack:** TypeScript browser extension, Manifest V3, webextension-polyfill, esbuild, Node test runner with JSDOM.

---

### Task 1: Shared Gradeo Session Helpers

**Files:**
- Create: `extension/src/shared/gradeoSession.ts`
- Modify: `extension/build.mjs`
- Modify: `extension/src/global.d.ts`
- Test: `extension/tests/gradeo-extension.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that import `dist/src/shared/gradeoSession.js` and cover:

```javascript
it('extracts Gradeo session details from storage, cookies, and API urls', async () => {
  await importBuilt('src/shared/gradeoSession.js')
  const ext = globalThis.KingsTrackExtension
  const token = makeJwt({
    iss: 'https://gradeo.au.auth0.com/',
    aud: ['https://api.portal.gradeo.com.au'],
    exp: 2000000000,
  })
  const result = ext.extractGradeoSessionFromSources({
    storageItems: [{ key: 'gradeo-auth', value: JSON.stringify({ access_token: token }) }],
    cookie: 'admin_user_schoolId=7572b03a-1507-4309-950e-2a286bdcf0a4',
    urls: ['https://platform.gradeo.com.au/api/school/v2/list/student/7572b03a-1507-4309-950e-2a286bdcf0a4?limit=10'],
  })

  assert.equal(result.authorization, `Bearer ${token}`)
  assert.equal(result.schoolId, '7572b03a-1507-4309-950e-2a286bdcf0a4')
  assert.equal(result.source, 'localStorage')
})

it('redacts captured sessions for diagnostics', async () => {
  await importBuilt('src/shared/gradeoSession.js')
  const ext = globalThis.KingsTrackExtension

  assert.deepEqual(ext.describeGradeoSession({
    authorization: 'Bearer secret',
    schoolId: 'school-1',
    capturedAt: '2026-06-24T00:00:00.000Z',
    source: 'fetch',
  }), {
    hasAuthorization: true,
    schoolId: 'school-1',
    capturedAt: '2026-06-24T00:00:00.000Z',
    source: 'fetch',
    stale: false,
  })
})
```

Add a small local `makeJwt(payload)` helper in the test file that base64url-encodes a dummy header and payload.

- [ ] **Step 2: Run tests to verify red**

Run: `npm test -- tests/gradeo-extension.test.mjs`

Expected: FAIL because `dist/src/shared/gradeoSession.js` does not exist.

- [ ] **Step 3: Implement shared helpers**

Create an IIFE module that attaches these APIs to `self.KingsTrackExtension`:

```typescript
ext.findGradeoBearerTokenFromText(text)
ext.extractGradeoSchoolIdFromText(text)
ext.extractGradeoSessionFromSources({ storageItems, cookie, urls, headers, source })
ext.normalizeGradeoSession(candidate)
ext.describeGradeoSession(session)
```

The implementation must:

- Detect JWT-like strings.
- Decode JWT payloads with base64url fallback.
- Prefer tokens whose issuer/audience mention Gradeo/Auth0.
- Return `Authorization` values as `Bearer <token>`.
- Extract `schoolId` from `admin_user_schoolId` cookies or Gradeo API URL paths.
- Never return cookie text or raw request header blocks.

Add `src/shared/gradeoSession.ts` to the esbuild entry points and add matching global type declarations.

- [ ] **Step 4: Run tests to verify green**

Run: `npm test -- tests/gradeo-extension.test.mjs`

Expected: PASS.

### Task 2: Background Session Store And API Context

**Files:**
- Modify: `extension/src/background/gradeoApi.ts`
- Modify: `extension/src/background/messages.ts`
- Modify: `extension/src/background/index.ts`
- Modify: `extension/src/shared/config.ts`
- Modify: `extension/src/global.d.ts`
- Test: `extension/tests/gradeo-extension.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that verify:

```javascript
it('prefers an automatically captured Gradeo session over manual headers', async () => {
  const mock = setupBrowserMock()
  const token = makeJwt({ iss: 'https://gradeo.au.auth0.com/', aud: ['https://api.portal.gradeo.com.au'] })
  mock.storageData.kingsTrackGradeoSession = {
    authorization: `Bearer ${token}`,
    schoolId: '7572b03a-1507-4309-950e-2a286bdcf0a4',
    capturedAt: new Date().toISOString(),
    source: 'localStorage',
  }
  mock.storageData.kingsTrackConfig = { gradeoApiHeadersJson: '{"Authorization":"Bearer manual"}' }
  await importBuilt('src/shared/config.js')
  await importBuilt('src/shared/logger.js')
  await importBuilt('src/shared/gradeoSession.js')
  await importBuilt('src/background/index.js')

  const ctx = await globalThis.KingsTrackExtension.__gradeoBackgroundTest.getGradeoApiContext()

  assert.equal(ctx.headers.Authorization, `Bearer ${token}`)
  assert.equal(ctx.schoolId, '7572b03a-1507-4309-950e-2a286bdcf0a4')
})

it('stores captured Gradeo sessions without logging token values', async () => {
  const mock = setupBrowserMock()
  const token = makeJwt({ iss: 'https://gradeo.au.auth0.com/', aud: ['https://api.portal.gradeo.com.au'] })
  await importBuilt('src/shared/config.js')
  await importBuilt('src/shared/logger.js')
  await importBuilt('src/shared/gradeoSession.js')
  await importBuilt('src/background/index.js')

  const response = await mock.messageListeners[0]({
    type: 'kings.gradeo.sessionCaptured',
    session: {
      authorization: `Bearer ${token}`,
      schoolId: '7572b03a-1507-4309-950e-2a286bdcf0a4',
      source: 'fetch',
    },
  })

  assert.equal(response.hasAuthorization, true)
  assert.equal(mock.storageData.kingsTrackGradeoSession.authorization, `Bearer ${token}`)
  assert.doesNotMatch(JSON.stringify(mock.storageData.kingsTrackDebugLogs || []), new RegExp(token))
})
```

- [ ] **Step 2: Run tests to verify red**

Run: `npm test -- tests/gradeo-extension.test.mjs`

Expected: FAIL because captured-session APIs and message handling do not exist.

- [ ] **Step 3: Implement background session storage**

Add `GRADEO_SESSION_KEY`, `ext.getGradeoSession`, `ext.saveGradeoSession`, `ext.clearGradeoSession`, and `ext.getGradeoSessionStatus` in `shared/config.ts` or a focused companion if the shared helper needs to stay pure. Update `getGradeoApiContext()` to read the captured session first, then parse `gradeoApiHeadersJson`.

Register these messages in `background/messages.ts`:

- `kings.gradeo.sessionCaptured`
- `kings.popup.detectGradeoSession`
- `kings.popup.clearGradeoSession`

Expose `getGradeoApiContext` in `__gradeoBackgroundTest`.

- [ ] **Step 4: Run tests to verify green**

Run: `npm test -- tests/gradeo-extension.test.mjs`

Expected: PASS.

### Task 3: Gradeo Content Capture Bridge

**Files:**
- Create: `extension/src/content/gradeoSession.ts`
- Modify: `extension/build.mjs`
- Modify: `extension/manifest.json`
- Test: `extension/tests/gradeo-extension.test.mjs`

- [ ] **Step 1: Write failing tests**

Add JSDOM-backed tests that load `dist/src/shared/gradeoSession.js` and `dist/src/content/gradeoSession.js`, populate localStorage with a dummy Gradeo JWT and `document.cookie` with `admin_user_schoolId`, then assert that the content script sends `kings.gradeo.sessionCaptured`.

- [ ] **Step 2: Run tests to verify red**

Run: `npm test -- tests/gradeo-extension.test.mjs`

Expected: FAIL because the content script does not exist and manifest/build do not include it.

- [ ] **Step 3: Implement content bridge**

The content script should:

- Scan `localStorage` and `sessionStorage`.
- Read `document.cookie`.
- Include `window.location.href` in URL sources.
- Monkey-patch page-visible `fetch` and `XMLHttpRequest` where possible in the current execution world.
- Send only normalized session payloads to the background worker.
- Respond to `kings.gradeo.scanSession` from the background by running a fresh scan.

Add it to `build.mjs` and to the manifest for `https://platform.gradeo.com.au/*`.

- [ ] **Step 4: Run tests to verify green**

Run: `npm test -- tests/gradeo-extension.test.mjs`

Expected: PASS.

### Task 4: Popup Detection UX

**Files:**
- Modify: `extension/src/popup/popup.html`
- Modify: `extension/src/popup/popup.ts`
- Test: `extension/tests/gradeo-extension.test.mjs`

- [ ] **Step 1: Write failing tests**

Add a popup DOM test that loads the popup bundle with a context containing an automatic session and verifies the status pill says `Gradeo session detected`. Add a second test where no session/manual headers exist and verify the popup calls `kings.popup.detectGradeoSession` when the new button is clicked.

- [ ] **Step 2: Run tests to verify red**

Run: `npm test -- tests/gradeo-extension.test.mjs`

Expected: FAIL because the button/status do not exist.

- [ ] **Step 3: Implement popup changes**

Add a `Detect Gradeo session` button in settings and update readiness logic to use `context.gradeoSessionStatus` plus manual headers fallback. Keep the manual textarea visible as fallback.

- [ ] **Step 4: Run tests to verify green**

Run: `npm test -- tests/gradeo-extension.test.mjs`

Expected: PASS.

### Task 5: Final Verification

**Files:**
- Verify all modified extension files.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Full extension tests**

Run: `npm test`

Expected: PASS with all extension tests.

- [ ] **Step 3: Inspect build output**

Run: `rg -n "Bearer eyJ|admin_user_name|Cookie:" dist src tests`

Expected: no live token/cookie material in committed sources or generated output.

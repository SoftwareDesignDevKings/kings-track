export const STATE_KEY = 'kingsTrackSyncState'
export const ACTIVE_JOB_STALE_MS = 90 * 1000

const TERMINAL_STATUSES = new Set(['idle', 'completed', 'error', 'blocked'])
const WORKER_INSTANCE_ID = globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`

function nowIso() {
  return new Date().toISOString()
}

function isTerminalStatus(status: string | undefined) {
  return TERMINAL_STATUSES.has(String(status || 'idle'))
}

function isActiveJobState(state: Record<string, any>) {
  return Boolean(state?.activeJob?.action && !isTerminalStatus(state.status))
}

function activeJobIsStale(activeJob: Record<string, any>) {
  const lastHeartbeat = Date.parse(String(activeJob?.lastHeartbeatAt || ''))
  return !Number.isFinite(lastHeartbeat) || Date.now() - lastHeartbeat > ACTIVE_JOB_STALE_MS
}

function buildInterruptedState(state: Record<string, any>, message: string) {
  return {
    status: 'error',
    action: state?.action || state?.activeJob?.action || 'sync',
    message,
    interrupted: true,
    previousStatus: state?.status || null,
    previousActiveJob: state?.activeJob || null,
  }
}

async function readStoredState() {
  const result = await browser.storage.local.get(STATE_KEY)
  return result[STATE_KEY] || { status: 'idle' }
}

export async function setState(state: Record<string, any>) {
  const current = await readStoredState()
  const next = { ...state }
  const activeJob = current?.activeJob

  if (activeJob && !next.activeJob && !isTerminalStatus(next.status)) {
    next.activeJob = activeJob
    next.action = next.action || activeJob.action
  }

  await browser.storage.local.set({ [STATE_KEY]: next })
  return next
}

export async function getState() {
  const state = await readStoredState()
  if (!isActiveJobState(state)) {
    return state
  }

  const activeJob = state.activeJob
  const workerChanged = activeJob.workerInstanceId && activeJob.workerInstanceId !== WORKER_INSTANCE_ID
  const stale = activeJobIsStale(activeJob)
  if (!workerChanged && !stale) {
    return state
  }

  const interrupted = buildInterruptedState(
    state,
    workerChanged
      ? 'The Gradeo sync was interrupted because the extension background worker restarted. Start the import again.'
      : 'The Gradeo sync stopped reporting progress and was marked as interrupted. Start the import again.',
  )
  await browser.storage.local.set({ [STATE_KEY]: interrupted })
  return interrupted
}

export async function beginActiveJob(action: string) {
  const state = await getState()
  if (isActiveJobState(state)) {
    return { started: false, state }
  }

  const timestamp = nowIso()
  const next = {
    status: 'running',
    action,
    activeJob: {
      action,
      startedAt: timestamp,
      lastHeartbeatAt: timestamp,
      workerInstanceId: WORKER_INSTANCE_ID,
    },
  }
  await browser.storage.local.set({ [STATE_KEY]: next })
  return { started: true, state: next }
}

export async function heartbeatActiveJob(action: string) {
  const state = await readStoredState()
  if (!isActiveJobState(state) || state.activeJob.action !== action) {
    return state
  }
  if (state.activeJob.workerInstanceId !== WORKER_INSTANCE_ID) {
    return state
  }

  const next = {
    ...state,
    activeJob: {
      ...state.activeJob,
      lastHeartbeatAt: nowIso(),
    },
  }
  await browser.storage.local.set({ [STATE_KEY]: next })
  return next
}

export const __stateTest = {
  WORKER_INSTANCE_ID,
  activeJobIsStale,
  isActiveJobState,
}

export const STATE_KEY = 'kingsTrackSyncState'

export async function setState(state: Record<string, any>) {
  await browser.storage.local.set({ [STATE_KEY]: state })
  return state
}

export async function getState() {
  const result = await browser.storage.local.get(STATE_KEY)
  return result[STATE_KEY] || { status: 'idle' }
}

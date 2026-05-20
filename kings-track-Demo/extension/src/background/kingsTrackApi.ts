const ext = self.KingsTrackExtension

const SLOW_REQUEST_LOG_MS = 2000

function createRequestId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function summarizeApiResult(result: any) {
  if (Array.isArray(result)) {
    return { type: 'array', count: result.length }
  }
  if (result && typeof result === 'object') {
    const summary: any = { type: 'object', keys: Object.keys(result).slice(0, 10) }
    if (Number.isFinite(Number(result.count))) {
      summary.count = Number(result.count)
    }
    if (Number.isFinite(Number(result.processed_students))) {
      summary.processed_students = Number(result.processed_students)
    }
    if (Number.isFinite(Number(result.matched_students))) {
      summary.matched_students = Number(result.matched_students)
    }
    if (Number.isFinite(Number(result.imported_exams))) {
      summary.imported_exams = Number(result.imported_exams)
    }
    if (Number.isFinite(Number(result.imported_classes))) {
      summary.imported_classes = Number(result.imported_classes)
    }
    if (Number.isFinite(Number(result.skipped_classes))) {
      summary.skipped_classes = Number(result.skipped_classes)
    }
    return summary
  }
  return { type: typeof result }
}

export async function fetchKingsTrackApi(path: string, options?: Record<string, any>, debugDetails?: Record<string, any>) {
  const startedAt = Date.now()
  const method = options?.method || 'GET'
  const timeoutMs = options && Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Number(options.timeoutMs))
    : null
  const requestId = createRequestId('kt')
  await ext.logDebug('background', 'kings_track_request_started', {
    requestId,
    path,
    method,
    timeoutMs,
    ...(debugDetails || {}),
  })
  try {
    const result = await ext.bridgeRequest(path, options || {})
    const durationMs = Date.now() - startedAt
    await ext.logDebug(
      'background',
      durationMs >= SLOW_REQUEST_LOG_MS ? 'kings_track_request_slow' : 'kings_track_request_succeeded',
      {
        requestId,
        path,
        method,
        durationMs,
        timeoutMs,
        ...(debugDetails || {}),
        result: summarizeApiResult(result),
      },
    )
    return result
  } catch (error) {
    await ext.logDebug('background', 'kings_track_request_failed', {
      requestId,
      path,
      method,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      ...(debugDetails || {}),
      error: String(error),
    })
    throw error
  }
}

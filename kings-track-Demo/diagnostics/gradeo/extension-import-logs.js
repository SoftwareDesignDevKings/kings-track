// Paste into the Kings Track extension service worker console.
// Open chrome://extensions, inspect the service worker for the Kings Track extension, then run this.
(async () => {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error('chrome.storage.local is unavailable. Run this in the extension service worker console.')
  }

  const state = await chrome.storage.local.get(null)
  const logs = state.kingsTrackDebugLogs || []
  const gradeoLogs = logs.filter(log =>
    String(log.scope || '').includes('background') ||
    String(log.event || '').includes('gradeo') ||
    String(log.event || '').includes('import')
  )
  const recentLogs = gradeoLogs.slice(-120)
  const importantLogs = recentLogs.filter(log =>
    /csv_failed|exam_skipped|class_import_payload_built|mapped_class_imported|visible_action_failed|class_import_upload/i
      .test(String(log.event || ''))
  )

  const rows = recentLogs.map(log => ({
    time: log.timestamp,
    event: log.event,
    classId: log.details?.classId,
    className: log.details?.className,
    markingSessionId: log.details?.markingSessionId,
    examId: log.details?.examId,
    reason: log.details?.reason,
    confirmedExams: log.details?.confirmedExams,
    uploadStudents: log.details?.uploadStudents,
    processedStudents: log.details?.processedStudents,
    matchedStudents: log.details?.matchedStudents,
    importedExams: log.details?.importedExams,
    payloadKB: log.details?.payloadKilobytes,
    error: log.details?.error,
  }))

  const output = {
    generated_at: new Date().toISOString(),
    sync_state: state.kingsTrackSyncState,
    log_counts: {
      all_logs: logs.length,
      gradeo_logs: gradeoLogs.length,
      recent_gradeo_logs: recentLogs.length,
      important_recent_logs: importantLogs.length,
    },
    recent_gradeo_log_rows: rows,
    important_recent_logs: importantLogs,
    recent_gradeo_logs: recentLogs,
    interpretation_flags: {
      csv_failed: recentLogs.some(log => /csv_failed/i.test(String(log.event || ''))),
      exam_skipped: recentLogs.some(log => /exam_skipped/i.test(String(log.event || ''))),
      payload_built: recentLogs.some(log => log.event === 'class_import_payload_built'),
      mapped_class_imported: recentLogs.some(log => log.event === 'mapped_class_imported'),
      current_state_error: state.kingsTrackSyncState?.status === 'error',
    },
  }

  globalThis.__gradeoDiagnostics ||= {}
  globalThis.__gradeoDiagnostics.extensionImportLogs = output

  console.log('Sync state:', output.sync_state)
  console.log('Log counts:', output.log_counts)
  console.table(output.recent_gradeo_log_rows)
  console.log('Important recent logs:', output.important_recent_logs)
  console.log('Interpretation flags:', output.interpretation_flags)
  console.log('Full diagnostic object:', output)

  const json = JSON.stringify(output, null, 2)
  if (typeof copy === 'function') {
    copy(json)
    console.log('Copied diagnostic JSON with DevTools copy().')
  } else if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(json)
    console.log('Copied diagnostic JSON to clipboard.')
  } else {
    console.log('Copy this JSON:', json)
  }
})().catch(error => {
  console.error('Gradeo extension-log diagnostic failed:', error)
})


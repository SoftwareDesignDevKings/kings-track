import { useSyncStatus, useTriggerSync } from '../services/api'

export default function Header() {
  const { data: syncStatus } = useSyncStatus()
  const triggerSync = useTriggerSync()

  const isRunning = syncStatus?.is_running ?? false
  const lastSync = syncStatus?.logs?.find(l => l.status === 'completed')?.completed_at

  const formatLastSync = (iso: string | null | undefined) => {
    if (!iso) return 'Never'
    const d = new Date(iso)
    const now = new Date()
    const diffMins = Math.floor((now.getTime() - d.getTime()) / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return d.toLocaleDateString()
  }

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo / Title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">K</span>
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900 leading-tight">Kings Analytics</h1>
            <p className="text-xs text-slate-500 leading-tight">Canvas Dashboard</p>
          </div>
        </div>

        {/* Sync controls */}
        <div className="flex items-center gap-4">
          {/* Sync status indicator */}
          <div className="flex items-center gap-2 text-sm text-slate-500">
            {isRunning ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span>Syncing…</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Last sync: {formatLastSync(lastSync)}</span>
              </>
            )}
          </div>

          {/* Sync button */}
          <button
            onClick={() => triggerSync.mutate()}
            disabled={isRunning || triggerSync.isPending}
            className="
              px-3 py-1.5 text-sm font-medium rounded-lg border
              border-slate-300 text-slate-700 bg-white
              hover:bg-slate-50 hover:border-slate-400
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {isRunning ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>
    </header>
  )
}

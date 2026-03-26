import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useSyncStatus, useTriggerSync, useCurrentUser } from '../services/api'
import { signOut, isLocalAuth } from '../lib/auth'

export default function Header() {
  const { data: syncStatus } = useSyncStatus()
  const triggerSync = useTriggerSync()
  const { data: currentUser } = useCurrentUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const handleLogout = async () => {
    await signOut()
    queryClient.clear()
    navigate('/login')
  }

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
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Logo + nav */}
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-3 shrink-0">
              <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">K</span>
              </div>
              <span className="text-base font-semibold text-slate-900 hidden sm:inline">Kings Analytics</span>
            </Link>

            <nav className="flex items-center gap-1">
              <Link
                to="/"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                Courses
              </Link>
              {currentUser?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  Settings
                </Link>
              )}
            </nav>
          </div>

          {/* Right: Sync status + action */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              {isRunning ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="hidden sm:inline">Syncing…</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="hidden sm:inline">Last sync: {formatLastSync(lastSync)}</span>
                </>
              )}
            </div>

            <button
              onClick={() => triggerSync.mutate()}
              disabled={isRunning || triggerSync.isPending}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? 'Syncing…' : 'Sync Now'}
            </button>

            {!isLocalAuth && (
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-400 transition-colors"
              >
                Log Out
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

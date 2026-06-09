import { useEffect, useState } from 'react'
import { useCurrentUser } from '../services/api'
import { installExtensionBridge, type BridgeEvent } from '../lib/extensionBridge'

const MAX_LOG = 50

export default function ExtensionBridge() {
  const { data: currentUser, isLoading } = useCurrentUser()
  const [events, setEvents] = useState<BridgeEvent[]>([])

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => {
    if (!isAdmin) return
    const uninstall = installExtensionBridge(event => {
      setEvents(prev => [event, ...prev].slice(0, MAX_LOG))
    })
    return uninstall
  }, [isAdmin])

  return (
    <div className="h-full w-full overflow-auto">
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Extension Bridge</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Keep this tab open while syncing data from the Gradeo browser extension. The extension
            sends data through this page using your signed-in session — no API key required.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">Checking permissions…</p>
        ) : !isAdmin ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            <p className="font-semibold">Admin access required.</p>
            <p className="mt-1 text-amber-800">
              The bridge only runs for admin users. Sign in with an admin account to use the
              extension.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-sm font-semibold text-emerald-900">Bridge active</p>
              <p className="mt-1 text-xs text-emerald-800/80">
                Signed in as {currentUser?.email}. Leave this tab open while running syncs from the
                extension popup.
              </p>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900">Recent activity</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Last {MAX_LOG} bridge requests handled by this tab.
                </p>
              </div>
              {events.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">
                  No requests yet. Trigger a sync from the extension popup to see activity here.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {events.map(event => (
                    <li
                      key={`${event.requestId}-${event.startedAt}`}
                      className="px-5 py-3 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          <span className="text-xs uppercase tracking-wide text-slate-500 mr-2">
                            {event.method}
                          </span>
                          {event.path}
                        </p>
                        {event.error && (
                          <p className="text-xs text-red-600 mt-0.5 truncate">{event.error}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={`text-xs font-semibold ${
                            event.ok ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {event.ok ? `${event.status} OK` : event.status ? `${event.status} ERR` : 'FAIL'}
                        </p>
                        <p className="text-[11px] text-slate-500">{event.durationMs} ms</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

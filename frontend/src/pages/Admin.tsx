import { useState } from 'react'
import Header from '../components/Header'
import {
  useAdminUsers,
  useAddUser,
  useRemoveUser,
  useWhitelist,
  useAvailableCourses,
  useAddToWhitelist,
  useRemoveFromWhitelist,
  useSyncStatus,
  useTriggerSync,
  useEdStemMappings,
  useEdStemAvailableCourses,
  useCreateEdStemMapping,
  useDeleteEdStemMapping,
  useAutoMatchEdStem,
} from '../services/api'
import { useHealth } from '../services/api'

export default function Admin() {
  const { data: users = [], isLoading: usersLoading } = useAdminUsers()
  const { data: whitelist = [], isLoading: whitelistLoading } = useWhitelist()
  const { data: available = [], isLoading: availableLoading } = useAvailableCourses()

  const addUser = useAddUser()
  const removeUser = useRemoveUser()
  const addToWhitelist = useAddToWhitelist()
  const removeFromWhitelist = useRemoveFromWhitelist()
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

  const { data: health } = useHealth()
  const { data: edStemMappings = [], isLoading: edStemMappingsLoading } = useEdStemMappings()
  const { data: edStemCourses = [], isLoading: edStemCoursesLoading } = useEdStemAvailableCourses()
  const createEdStemMapping = useCreateEdStemMapping()
  const deleteEdStemMapping = useDeleteEdStemMapping()
  const autoMatchEdStem = useAutoMatchEdStem()

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'teacher'>('teacher')
  const [courseSearch, setCourseSearch] = useState('')
  const [edStemCanvasId, setEdStemCanvasId] = useState<number | ''>('')
  const [edStemCourseId, setEdStemCourseId] = useState<number | ''>('')
  const [autoMatchedCourse, setAutoMatchedCourse] = useState<string | null>(null)

  function handleCreateEdStemMapping(e: React.FormEvent) {
    e.preventDefault()
    if (edStemCanvasId === '' || edStemCourseId === '') return
    const selectedCourse = edStemCourses.find(c => c.id === edStemCourseId)
    createEdStemMapping.mutate(
      {
        canvas_course_id: edStemCanvasId as number,
        edstem_course_id: edStemCourseId as number,
        edstem_course_name: selectedCourse?.name ?? '',
      },
      {
        onSuccess: () => {
          setEdStemCanvasId('')
          setEdStemCourseId('')
        },
      },
    )
  }

  const whitelistedIds = new Set(whitelist.map(w => w.course_id))
  const notWhitelisted = available.filter(c => !whitelistedIds.has(c.id))

  const searchLower = courseSearch.toLowerCase()
  const filteredWhitelist = whitelist.filter(
    w => w.name.toLowerCase().includes(searchLower) || (w.course_code ?? '').toLowerCase().includes(searchLower)
  )
  const filteredAvailable = notWhitelisted.filter(
    c => c.name.toLowerCase().includes(searchLower) || (c.course_code ?? '').toLowerCase().includes(searchLower)
  )

  function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim()) return
    addUser.mutate(
      { email: newEmail.trim(), role: newRole },
      { onSuccess: () => setNewEmail('') },
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Settings</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage users and course visibility.
          </p>
        </div>

        <div className="space-y-8">
          {/* ── Data Sync ──────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Data Sync</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Canvas data syncs automatically. Incremental updates run every 30 minutes, with a full sync every 6 hours.
              </p>
            </div>

            <div className="px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isRunning ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-sm text-slate-600">Syncing…</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-sm text-slate-600">
                      Last sync: {formatLastSync(lastSync)}
                    </span>
                  </>
                )}
              </div>

              <button
                onClick={() => triggerSync.mutate()}
                disabled={isRunning || triggerSync.isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isRunning ? 'Syncing…' : 'Sync Now'}
              </button>
            </div>
          </section>

          {/* ── Users ──────────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Users</h3>
              <p className="text-xs text-slate-500 mt-0.5">Control who can access the dashboard.</p>
            </div>

            {usersLoading ? (
              <div className="px-5 py-8 text-sm text-slate-500 text-center">Loading…</div>
            ) : users.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-400 text-center">No users yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[640px] w-full text-sm">
                  <thead className="bg-slate-50/80 text-slate-500 text-left text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Email</th>
                      <th className="px-5 py-2.5 font-medium">Role</th>
                      <th className="px-5 py-2.5 font-medium">Added</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map(u => (
                      <tr key={u.email} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3 text-slate-800">{u.email}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              u.role === 'admin'
                                ? 'bg-brand-100 text-brand-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-500">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => removeUser.mutate(u.email)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
              <form onSubmit={handleAddUser} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  required
                />
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as 'admin' | 'teacher')}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 sm:w-36"
                >
                  <option value="teacher">Teacher</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={addUser.isPending}
                  className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                >
                  Add User
                </button>
              </form>
              {addUser.isError && (
                <p className="text-sm text-red-600 mt-2">{(addUser.error as Error).message}</p>
              )}
            </div>
          </section>

          {/* ── Course Whitelist ───────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-900 flex-1">Course Whitelist</h3>
                <input
                  type="search"
                  placeholder="Search courses…"
                  value={courseSearch}
                  onChange={e => setCourseSearch(e.target.value)}
                  className="sm:w-56 border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            {autoMatchedCourse && (
              <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-100 text-xs text-emerald-700">
                ✓ {autoMatchedCourse}
              </div>
            )}

            {(whitelistLoading || availableLoading) ? (
              <div className="px-5 py-8 text-sm text-slate-500 text-center">Loading…</div>
            ) : available.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">No courses synced yet. Run a sync first.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">

                {/* Left: Whitelisted */}
                <div className="flex flex-col">
                  <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Whitelisted</span>
                    <span className="text-xs text-slate-400">{filteredWhitelist.length}</span>
                  </div>
                  <div className="overflow-y-auto max-h-72 divide-y divide-slate-100">
                    {filteredWhitelist.length === 0 ? (
                      <p className="px-4 py-6 text-xs text-slate-400 text-center">
                        {courseSearch ? 'No matches' : 'No courses whitelisted yet'}
                      </p>
                    ) : filteredWhitelist.map(w => (
                      <div key={w.course_id} className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50 transition-colors">
                        <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">
                          {w.name}
                          {w.course_code && <span className="text-slate-400 ml-1.5">· {w.course_code}</span>}
                        </span>
                        <button
                          onClick={() => removeFromWhitelist.mutate(w.course_id)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Available to add */}
                <div className="flex flex-col">
                  <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">All Courses</span>
                    <span className="text-xs text-slate-400">{filteredAvailable.length}</span>
                  </div>
                  <div className="overflow-y-auto max-h-72 divide-y divide-slate-100">
                    {filteredAvailable.length === 0 ? (
                      <p className="px-4 py-6 text-xs text-slate-400 text-center">
                        {courseSearch ? 'No matches' : 'All courses are whitelisted'}
                      </p>
                    ) : filteredAvailable.map(c => (
                      <div key={c.id} className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50 transition-colors">
                        <span className="flex-1 min-w-0 text-sm text-slate-500 truncate">
                          {c.name}
                          {c.course_code && <span className="text-slate-400 ml-1.5">· {c.course_code}</span>}
                        </span>
                        <button
                          onClick={() => addToWhitelist.mutate(c, {
                            onSuccess: (data) => {
                              if (data?.edstem_matched) {
                                setAutoMatchedCourse(`${c.name} auto-linked to EdStem: ${data.edstem_matched.edstem_course_name}`)
                                setTimeout(() => setAutoMatchedCourse(null), 5000)
                              }
                            }
                          })}
                          disabled={addToWhitelist.isPending}
                          className="text-xs text-brand-600 hover:text-brand-800 font-medium disabled:opacity-50 shrink-0"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </section>

          {/* ── EdStem Course Mapping ───────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">EdStem Course Mapping</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Link Canvas courses to their EdStem counterparts for lesson tracking.
                </p>
              </div>
              {health?.edstem_configured && (
                <button
                  onClick={() => autoMatchEdStem.mutate()}
                  disabled={autoMatchEdStem.isPending}
                  className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                >
                  {autoMatchEdStem.isPending ? 'Matching…' : 'Auto-match'}
                </button>
              )}
            </div>

            {!health?.edstem_configured ? (
              <div className="px-5 py-8 text-sm text-slate-400 text-center">
                EdStem API not configured. Set <code className="text-xs bg-slate-100 px-1 rounded">EDSTEM_API_TOKEN</code> to enable.
              </div>
            ) : edStemMappingsLoading ? (
              <div className="px-5 py-8 text-sm text-slate-500 text-center">Loading…</div>
            ) : (
              <>
                {edStemMappings.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-slate-400 text-center">No mappings yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[480px] w-full text-sm">
                      <thead className="bg-slate-50/80 text-slate-500 text-left text-xs uppercase tracking-wider">
                        <tr>
                          <th className="px-5 py-2.5 font-medium">Canvas Course</th>
                          <th className="px-5 py-2.5 font-medium">EdStem Course</th>
                          <th className="px-5 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {edStemMappings.map(m => (
                          <tr key={m.canvas_course_id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-3 text-slate-800">{m.canvas_course_name}</td>
                            <td className="px-5 py-3 text-slate-600">{m.edstem_course_name || `ID: ${m.edstem_course_id}`}</td>
                            <td className="px-5 py-3 text-right">
                              <button
                                onClick={() => deleteEdStemMapping.mutate(m.canvas_course_id)}
                                className="text-red-500 hover:text-red-700 text-xs font-medium"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                  <form onSubmit={handleCreateEdStemMapping} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <select
                      value={edStemCanvasId}
                      onChange={e => setEdStemCanvasId(e.target.value === '' ? '' : Number(e.target.value))}
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                      required
                    >
                      <option value="">Canvas course…</option>
                      {whitelist.map(w => (
                        <option key={w.course_id} value={w.course_id}>{w.name}</option>
                      ))}
                    </select>
                    <select
                      value={edStemCourseId}
                      onChange={e => setEdStemCourseId(e.target.value === '' ? '' : Number(e.target.value))}
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                      required
                      disabled={edStemCoursesLoading}
                    >
                      <option value="">{edStemCoursesLoading ? 'Loading EdStem courses…' : 'EdStem course…'}</option>
                      {edStemCourses.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={createEdStemMapping.isPending || edStemCanvasId === '' || edStemCourseId === ''}
                      className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                    >
                      Link
                    </button>
                  </form>
                  {createEdStemMapping.isError && (
                    <p className="text-sm text-red-600 mt-2">{(createEdStemMapping.error as Error).message}</p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

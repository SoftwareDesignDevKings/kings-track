import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Header from '../components/Header'
import {
  useAdminUsers,
  useAddUser,
  useRemoveUser,
  useCourses,
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
  useGradeoStudentDirectoryStatus,
  useGradeoClasses,
  useGradeoMappings,
  useCreateGradeoMapping,
  useDeleteGradeoMapping,
  useAutoMatchGradeo,
} from '../services/api'
import { useHealth } from '../services/api'

function StatusBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-brand-500 transition-[width]"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export default function Admin() {
  const queryClient = useQueryClient()
  const { data: users = [], isLoading: usersLoading } = useAdminUsers()
  const { data: syncedCourses = [], isLoading: syncedCoursesLoading } = useCourses()
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
  const { data: gradeoStudentDirectory } = useGradeoStudentDirectoryStatus()
  const { data: gradeoClasses = [], isLoading: gradeoClassesLoading } = useGradeoClasses()
  const { data: gradeoMappings = [], isLoading: gradeoMappingsLoading } = useGradeoMappings()
  const createGradeoMapping = useCreateGradeoMapping()
  const deleteGradeoMapping = useDeleteGradeoMapping()
  const autoMatchGradeo = useAutoMatchGradeo()

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'teacher'>('teacher')
  const [courseSearch, setCourseSearch] = useState('')
  const [edStemCanvasId, setEdStemCanvasId] = useState<number | ''>('')
  const [edStemCourseId, setEdStemCourseId] = useState<number | ''>('')
  const [gradeoCanvasId, setGradeoCanvasId] = useState<number | ''>('')
  const [gradeoClassId, setGradeoClassId] = useState<string>('')
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

  function handleCreateGradeoMapping(e: React.FormEvent) {
    e.preventDefault()
    if (gradeoCanvasId === '' || !gradeoClassId) return
    const selectedClass = gradeoClasses.find(c => c.gradeo_class_id === gradeoClassId)
    if (!selectedClass) return

    createGradeoMapping.mutate(
      {
        canvas_course_id: gradeoCanvasId as number,
        gradeo_class_id: gradeoClassId,
        gradeo_class_name: selectedClass.name,
      },
      {
        onSuccess: () => {
          setGradeoCanvasId('')
          setGradeoClassId('')
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
  const syncedCourseIds = new Set(syncedCourses.map(c => c.id))
  const whitelistedCoursesById = new Map(whitelist.map(course => [course.course_id, course]))
  const syncedWhitelistedCourses = whitelist.filter(w => syncedCourseIds.has(w.course_id))
  const pendingWhitelistedCourses = whitelist.filter(w => !syncedCourseIds.has(w.course_id))
  const syncCoverage = whitelist.length > 0 ? (syncedWhitelistedCourses.length / whitelist.length) * 100 : 0
  const latestSyncLog = syncStatus?.logs?.[0]
  const liveProgress = syncStatus?.progress ?? null
  const hasLiveProgress = isRunning && !!liveProgress
  const liveTotalSteps = liveProgress?.total_steps ?? 0
  const liveCompletedSteps = liveProgress?.completed_steps ?? 0
  const liveRemainingSteps = Math.max(liveTotalSteps - liveCompletedSteps, 0)
  const liveProgressPercent = liveTotalSteps > 0 ? (liveCompletedSteps / liveTotalSteps) * 100 : 0
  const liveCompletedCourses = (liveProgress?.completed_course_ids ?? [])
    .map(courseId => whitelistedCoursesById.get(courseId))
    .filter((course): course is NonNullable<typeof course> => !!course)
  const livePendingCourses = (liveProgress?.pending_course_ids ?? [])
    .map(courseId => whitelistedCoursesById.get(courseId))
    .filter((course): course is NonNullable<typeof course> => !!course)
  const liveCurrentCourse = liveProgress?.current_course_id != null
    ? whitelistedCoursesById.get(liveProgress.current_course_id) ?? null
    : null
  const wasRunningRef = useRef(isRunning)
  const mappedGradeoClassIds = new Set(gradeoMappings.map(mapping => mapping.gradeo_class_id))
  const unmappedGradeoClasses = gradeoClasses.filter(c => !mappedGradeoClassIds.has(c.gradeo_class_id))
  const mappedGradeoCanvasCourseIds = new Set(gradeoMappings.map(mapping => mapping.canvas_course_id))
  const unmappedWhitelistedCourses = whitelist.filter(course => !mappedGradeoCanvasCourseIds.has(course.course_id))
  const gradeoClassesById = new Map(gradeoClasses.map(gradeoClass => [gradeoClass.gradeo_class_id, gradeoClass]))

  const formatCourseLabel = (name: string, code?: string | null) =>
    code ? `${name} · ${code}` : name

  useEffect(() => {
    const wasRunning = wasRunningRef.current
    if (wasRunning && !isRunning) {
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      queryClient.invalidateQueries({ queryKey: ['matrix'] })
      queryClient.invalidateQueries({ queryKey: ['sync-status'] })
    }
    wasRunningRef.current = isRunning
  }, [isRunning, queryClient])

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
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Data Sync</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Canvas data syncs automatically. Incremental updates run every 30 minutes, with a full sync every 6 hours.
                </p>
              </div>
              <button
                onClick={() => triggerSync.mutate()}
                disabled={isRunning || triggerSync.isPending}
                className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isRunning ? 'Syncing…' : 'Sync Now'}
              </button>
            </div>

            <div className="px-5 py-5 border-b border-slate-100 bg-slate-50/60 space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <span className={`h-2.5 w-2.5 rounded-full ${isRunning ? 'bg-amber-400 animate-pulse' : health?.canvas_configured ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                  <span className="font-medium">
                    {isRunning
                      ? liveProgress?.phase ?? 'Syncing now'
                      : health?.canvas_configured
                        ? `Last sync ${formatLastSync(lastSync)}`
                        : 'Canvas not configured'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  {hasLiveProgress ? (
                    <>
                      <span className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                        {liveCompletedSteps}/{liveTotalSteps || '?'} steps
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                        {liveRemainingSteps} left
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                        {syncedWhitelistedCourses.length}/{whitelist.length} synced
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                        {pendingWhitelistedCourses.length} waiting
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {hasLiveProgress ? 'Current sync progress' : 'Sync coverage'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {hasLiveProgress
                        ? liveTotalSteps > 0
                          ? `${liveCompletedSteps} of ${liveTotalSteps} sync steps have finished in this run.`
                          : 'Preparing this sync run now.'
                        : whitelist.length === 0
                          ? 'No courses are whitelisted yet, so there is nothing queued for sync.'
                          : `${syncedWhitelistedCourses.length} of ${whitelist.length} whitelisted courses have been synced into the dashboard.`}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">
                    {hasLiveProgress
                      ? liveTotalSteps > 0 ? `${Math.round(liveProgressPercent)}%` : '…'
                      : whitelist.length === 0 ? '0%' : `${Math.round(syncCoverage)}%`}
                  </p>
                </div>
                <div className="mt-3">
                  <StatusBar value={hasLiveProgress ? liveProgressPercent : syncCoverage} />
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {hasLiveProgress
                    ? liveTotalSteps > 0
                      ? `${liveRemainingSteps} sync step${liveRemainingSteps === 1 ? '' : 's'} left.${liveCurrentCourse ? ` Working on ${formatCourseLabel(liveCurrentCourse.name, liveCurrentCourse.course_code)} now.` : ''}`
                      : 'Fetching the sync plan before the detailed progress starts.'
                    : pendingWhitelistedCourses.length === 0
                      ? 'Everything in the whitelist has been synced.'
                      : `${pendingWhitelistedCourses.length} whitelisted course${pendingWhitelistedCourses.length === 1 ? '' : 's'} still need${pendingWhitelistedCourses.length === 1 ? 's' : ''} to be synced.`}
                </p>
                {hasLiveProgress ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Current step: {liveProgress?.current_step?.replace(/_/g, ' ') ?? 'preparing'}.
                  </p>
                ) : latestSyncLog && (
                  <p className={`mt-3 text-xs ${
                    latestSyncLog.status === 'error' ? 'text-red-600' : 'text-slate-500'
                  }`}>
                    {latestSyncLog.error_message
                      ? latestSyncLog.error_message
                      : `Latest run: ${latestSyncLog.entity_type.replace(/_/g, ' ')} ${latestSyncLog.status}.`}
                  </p>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70">
                  <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
                    <p className="text-sm font-semibold text-emerald-900">
                      {hasLiveProgress ? 'Finished this run' : 'Already synced'}
                    </p>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      {hasLiveProgress ? liveCompletedCourses.length : syncedWhitelistedCourses.length}
                    </span>
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-emerald-100">
                    {hasLiveProgress ? (
                      liveCompletedCourses.length === 0 ? (
                        <p className="px-4 py-5 text-sm text-emerald-700/80">No courses have finished in this run yet.</p>
                      ) : liveCompletedCourses.map(course => (
                        <div key={course.course_id} className="px-4 py-3 text-sm font-medium text-slate-800">
                          {formatCourseLabel(course.name, course.course_code)}
                        </div>
                      ))
                    ) : syncedCoursesLoading ? (
                      <p className="px-4 py-5 text-sm text-emerald-700/80">Loading synced courses…</p>
                    ) : syncedWhitelistedCourses.length === 0 ? (
                      <p className="px-4 py-5 text-sm text-emerald-700/80">No whitelisted courses have been synced yet.</p>
                    ) : syncedWhitelistedCourses.map(course => (
                      <div key={course.course_id} className="px-4 py-3 text-sm font-medium text-slate-800">
                        {formatCourseLabel(course.name, course.course_code)}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/70">
                  <div className="flex items-center justify-between border-b border-amber-100 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-900">
                      {hasLiveProgress ? 'Still queued in this run' : 'Still waiting on sync'}
                    </p>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-700">
                      {hasLiveProgress ? livePendingCourses.length : pendingWhitelistedCourses.length}
                    </span>
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-amber-100">
                    {hasLiveProgress ? (
                      livePendingCourses.length === 0 ? (
                        <p className="px-4 py-5 text-sm text-amber-700/80">No queued courses left in this run.</p>
                      ) : livePendingCourses.map(course => (
                        <div key={course.course_id} className="px-4 py-3 text-sm font-medium text-slate-800">
                          {formatCourseLabel(course.name, course.course_code)}
                        </div>
                      ))
                    ) : whitelistLoading ? (
                      <p className="px-4 py-5 text-sm text-amber-700/80">Loading whitelist…</p>
                    ) : pendingWhitelistedCourses.length === 0 ? (
                      <p className="px-4 py-5 text-sm text-amber-700/80">Nothing is waiting on sync right now.</p>
                    ) : pendingWhitelistedCourses.map(course => (
                      <div key={course.course_id} className="px-4 py-3 text-sm font-medium text-slate-800">
                        {formatCourseLabel(course.name, course.course_code)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
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

          {/* ── Gradeo Class Mapping ───────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Gradeo Import Pipeline</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage the Gradeo student directory, class links, and recent imports from the browser extension.
                </p>
              </div>
              <button
                onClick={() => autoMatchGradeo.mutate()}
                disabled={autoMatchGradeo.isPending}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                {autoMatchGradeo.isPending ? 'Matching…' : 'Auto-match'}
              </button>
            </div>

            <div className="px-5 py-5 border-b border-slate-100 bg-slate-50/60">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Student directory status</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Refresh the directory from Gradeo&apos;s <code className="rounded bg-slate-100 px-1">/admin/schoolStudents</code> page before importing class data.
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      gradeoStudentDirectory?.stale ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {gradeoStudentDirectory?.stale ? 'Refresh needed' : 'Fresh'}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Matched students</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{gradeoStudentDirectory?.matched_students ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last refresh</p>
                      <p className="mt-1 text-sm font-medium text-slate-700">
                        {gradeoStudentDirectory?.last_synced_at
                          ? new Date(gradeoStudentDirectory.last_synced_at).toLocaleString()
                          : 'Never'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-900">Admin workflow</p>
                  <ol className="mt-3 space-y-2 text-sm text-slate-600 list-decimal list-inside">
                    <li>Open Gradeo&apos;s student directory and run the extension refresh.</li>
                    <li>Map discovered Gradeo classes to whitelisted Kings Track courses.</li>
                    <li>Open Gradeo reporting on a selected class and import the full class from the extension.</li>
                  </ol>
                  <p className="mt-3 text-xs text-slate-500">
                    Imports stay separate from Canvas and appear in the Gradeo course tab once a class has been linked and imported.
                  </p>
                </div>
              </div>
            </div>

            {gradeoClassesLoading || gradeoMappingsLoading ? (
              <div className="px-5 py-8 text-sm text-slate-500 text-center">Loading Gradeo classes…</div>
            ) : gradeoClasses.length === 0 && gradeoMappings.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-400 text-center">
                No Gradeo classes discovered yet. Use the extension on Gradeo to refresh the student directory, discover classes from the Classes page, and then import a class from Reporting.
              </div>
            ) : (
              <>
                {gradeoMappings.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-slate-400 text-center">No Gradeo mappings yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[640px] w-full text-sm">
                      <thead className="bg-slate-50/80 text-slate-500 text-left text-xs uppercase tracking-wider">
                        <tr>
                          <th className="px-5 py-2.5 font-medium">Canvas Course</th>
                          <th className="px-5 py-2.5 font-medium">Gradeo Class</th>
                          <th className="px-5 py-2.5 font-medium">Last import</th>
                          <th className="px-5 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {gradeoMappings.map(mapping => {
                          const linkedClass = gradeoClassesById.get(mapping.gradeo_class_id)
                          return (
                            <tr key={mapping.canvas_course_id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-5 py-3 text-slate-800">{formatCourseLabel(mapping.canvas_course_name, mapping.canvas_course_code)}</td>
                              <td className="px-5 py-3 text-slate-600">
                                <div className="font-medium text-slate-800">{mapping.gradeo_class_name}</div>
                                <div className="text-xs text-slate-400 mt-0.5">{mapping.gradeo_class_id}</div>
                              </td>
                              <td className="px-5 py-3 text-slate-500">
                                {linkedClass?.last_imported_at ? new Date(linkedClass.last_imported_at).toLocaleString() : 'Never'}
                              </td>
                              <td className="px-5 py-3 text-right">
                                <button
                                  onClick={() => deleteGradeoMapping.mutate(mapping.canvas_course_id)}
                                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                  <form onSubmit={handleCreateGradeoMapping} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <select
                      value={gradeoCanvasId}
                      onChange={e => setGradeoCanvasId(e.target.value === '' ? '' : Number(e.target.value))}
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                      required
                    >
                      <option value="">Whitelisted course…</option>
                      {unmappedWhitelistedCourses.map(course => (
                        <option key={course.course_id} value={course.course_id}>{course.name}</option>
                      ))}
                    </select>
                    <select
                      value={gradeoClassId}
                      onChange={e => setGradeoClassId(e.target.value)}
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                      required
                    >
                      <option value="">Gradeo class…</option>
                      {unmappedGradeoClasses.map(gradeoClass => (
                        <option key={gradeoClass.gradeo_class_id} value={gradeoClass.gradeo_class_id}>{gradeoClass.name}</option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={createGradeoMapping.isPending || gradeoCanvasId === '' || !gradeoClassId}
                      className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                    >
                      Link
                    </button>
                  </form>
                  <p className="mt-2 text-xs text-slate-500">
                    {unmappedGradeoClasses.length === 0
                      ? 'All discovered Gradeo classes are already linked.'
                      : `${unmappedGradeoClasses.length} discovered Gradeo class${unmappedGradeoClasses.length === 1 ? '' : 'es'} ready to link.`}
                  </p>
                  {createGradeoMapping.isError && (
                    <p className="text-sm text-red-600 mt-2">{(createGradeoMapping.error as Error).message}</p>
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

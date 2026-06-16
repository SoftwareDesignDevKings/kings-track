import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import CanvasOutageBanner from '../components/CanvasOutageBanner'
import { useCourseGroups, useHealth } from '../services/api'
import type { CourseGroup } from '../types'

function SetupBanner() {
  return (
    <div className="max-w-screen-2xl mx-auto px-6 py-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex gap-4 items-start">
        <div className="shrink-0 w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
          <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-amber-800 mb-1">Canvas API not configured</h3>
          <p className="text-sm text-amber-700">
            Set <code className="bg-amber-100 px-1 rounded font-mono text-xs">CANVAS_API_URL</code> and{' '}
            <code className="bg-amber-100 px-1 rounded font-mono text-xs">CANVAS_API_TOKEN</code> in your{' '}
            <code className="bg-amber-100 px-1 rounded font-mono text-xs">.env</code> file, then restart the backend and click Sync Now.
          </p>
        </div>
      </div>
    </div>
  )
}

function CompletionRing({ value }: { value: number | null }) {
  if (value === null)
    return (
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-400">
        —
      </div>
    )
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'text-emerald-500' : pct >= 50 ? 'text-amber-500' : 'text-red-500'
  const strokeColor = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'
  const r = 18
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <div className="relative w-12 h-12">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <circle
          cx="24" cy="24" r={r} fill="none"
          stroke={strokeColor} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-semibold ${color}`}>
        {pct}%
      </span>
    </div>
  )
}

function ragColor(rate: number | null): string {
  if (rate === null) return 'bg-slate-200'
  const pct = rate * 100
  if (pct >= 80) return 'bg-emerald-400'
  if (pct >= 50) return 'bg-amber-400'
  return 'bg-red-400'
}

function formatSync(iso: string | null) {
  if (!iso) return 'Not synced'
  const d = new Date(iso)
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffH = Math.floor(diffMins / 60)
  if (diffH < 24) return `${diffH}h ago`
  return d.toLocaleDateString()
}

function CourseGroupCard({ group }: { group: CourseGroup }) {
  const navigate = useNavigate()

  const handleClick = () => {
    if (group.class_count === 1) {
      navigate(`/courses/${group.classes[0].id}`)
    } else {
      navigate(`/courses/group/${group.group_code}`)
    }
  }

  return (
    <button
      onClick={handleClick}
      className="
        group text-left bg-white rounded-xl border border-slate-200
        p-5 flex flex-col gap-4
        hover:border-brand-500 hover:shadow-md
        transition-all duration-150
        focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2
      "
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`shrink-0 w-2 h-2 rounded-full ${ragColor(group.avg_completion_rate)}`} />
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide truncate">
              {group.group_code}
            </span>
            {group.class_count > 1 && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-slate-100 text-[10px] font-medium text-slate-500">
                {group.class_count} classes
              </span>
            )}
          </div>
          <h2 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-brand-600">
            {group.display_name}
          </h2>
        </div>
        <CompletionRing value={group.avg_completion_rate} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Students</p>
          <p className="text-sm font-semibold text-slate-800">{group.total_students}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">On-time</p>
          <p className="text-sm font-semibold text-slate-800">
            {group.avg_on_time_rate !== null ? `${Math.round(group.avg_on_time_rate * 100)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Avg score</p>
          <p className="text-sm font-semibold text-slate-800">
            {group.avg_current_score !== null ? `${group.avg_current_score}%` : '—'}
          </p>
        </div>
      </div>

      {/* Sync timestamp */}
      <p className="text-xs text-slate-400">Synced {formatSync(group.last_synced)}</p>
    </button>
  )
}

function CourseGroupGrid({ groups }: { groups: CourseGroup[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {groups.map(group => (
        <CourseGroupCard key={group.group_code} group={group} />
      ))}
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export default function Overview() {
  const { data: groups, isLoading, error } = useCourseGroups()
  const { data: health } = useHealth()
  const [archivedOpen, setArchivedOpen] = useState(false)

  const canvasConfigured = health?.canvas_configured ?? true
  const currentGroups = groups?.filter(g => !g.is_archived) ?? []
  const archivedGroups = groups?.filter(g => g.is_archived) ?? []
  const hasArchived = archivedGroups.length > 0
  const totalClasses = groups?.reduce((sum, g) => sum + g.class_count, 0) ?? 0
  const summary = groups
    ? hasArchived
      ? `${currentGroups.length} current, ${archivedGroups.length} archived`
      : `${currentGroups.length} course${currentGroups.length !== 1 ? 's' : ''}, ${totalClasses} class${totalClasses !== 1 ? 'es' : ''} synced`
    : 'Loading\u2026'

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <CanvasOutageBanner />

      <main className="max-w-screen-2xl mx-auto px-6 py-8">
        {health && !canvasConfigured && <SetupBanner />}

        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Courses</h2>
          <p className="text-sm text-slate-500 mt-0.5">{summary}</p>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-1/2 mb-3" />
                <div className="h-5 bg-slate-200 rounded w-3/4 mb-4" />
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100">
                  {[1, 2, 3].map(j => <div key={j} className="h-8 bg-slate-100 rounded" />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
            Failed to load courses. Make sure the backend is running.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && groups && groups.length === 0 && (
          <div className="text-center py-20">
            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-base font-medium text-slate-600 mb-1">No courses yet</h3>
            <p className="text-sm text-slate-400 mb-4">
              Configure your Canvas API credentials and trigger a sync to get started.
            </p>
          </div>
        )}

        {/* Course groups grid */}
        {!isLoading && groups && groups.length > 0 && (
          <>
            {currentGroups.length > 0 && <CourseGroupGrid groups={currentGroups} />}

            {hasArchived && (
              <section className={currentGroups.length > 0 ? 'mt-10' : ''}>
                <div className="mb-4 flex items-center justify-between gap-4 border-t border-slate-200 pt-5">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Archived</h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {archivedGroups.length} course{archivedGroups.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-expanded={archivedOpen}
                    onClick={() => setArchivedOpen(open => !open)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                    title={archivedOpen ? 'Collapse archived courses' : 'Expand archived courses'}
                  >
                    <ChevronIcon open={archivedOpen} />
                    <span className="sr-only">
                      {archivedOpen ? 'Collapse archived courses' : 'Expand archived courses'}
                    </span>
                  </button>
                </div>

                {archivedOpen && <CourseGroupGrid groups={archivedGroups} />}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

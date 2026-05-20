import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import CourseCard from '../components/CourseCard'
import CanvasOutageBanner from '../components/CanvasOutageBanner'
import { useCourses, useHealth } from '../services/api'
import type { Course } from '../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function pct(value: number | null | undefined): string {
  if (value == null) return '—'
  const v = value <= 1 && value > 0 ? Math.round(value * 100) : Math.round(value)
  return `${v}%`
}

function rateColor(rate: number | null | undefined): string {
  if (rate == null) return 'text-slate-400'
  const v = rate <= 1 ? rate * 100 : rate
  if (v >= 80) return 'text-emerald-600'
  if (v >= 60) return 'text-amber-600'
  return 'text-red-600'
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SetupBanner() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex gap-4 items-start mb-6">
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
  )
}

function RateBar({ value, label }: { value: number | null | undefined; label: string }) {
  const raw = value ?? 0
  const v = raw <= 1 ? raw * 100 : raw
  const barColor = v >= 80 ? 'bg-emerald-400' : v >= 60 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-slate-500 w-20 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(v, 100)}%` }} />
      </div>
      <span className={`text-xs font-medium w-10 text-right ${rateColor(value)}`}>{pct(value)}</span>
    </div>
  )
}

function CoursePerformance({ courses }: { courses: Course[] }) {
  const sorted = useMemo(
    () => [...courses].sort((a, b) => (a.avg_completion_rate ?? 100) - (b.avg_completion_rate ?? 100)),
    [courses]
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-800 mb-4">Course Performance Ranking</h3>
      <div className="space-y-3">
        {sorted.map(c => (
          <Link key={c.id} to={`/courses/${c.id}`} className="block hover:bg-slate-50 -mx-2 px-2 py-1.5 rounded-lg transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-700 font-medium truncate mr-4">{c.name}</span>
              <span className="text-xs text-slate-500 shrink-0">{c.student_count} students</span>
            </div>
            <div className="flex gap-4">
              <RateBar value={c.avg_completion_rate} label="Completion" />
              <RateBar value={c.avg_on_time_rate} label="On-time" />
            </div>
          </Link>
        ))}
        {courses.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">No courses synced yet.</p>
        )}
      </div>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function Overview() {
  const { data: courses, isLoading: coursesLoading, error } = useCourses()
  const { data: health } = useHealth()

  const canvasConfigured = health?.canvas_configured ?? true
  const isLoading = coursesLoading

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <CanvasOutageBanner />

      <main className="max-w-screen-2xl mx-auto px-6 py-8">
        {/* Setup banner if Canvas not configured */}
        {health && !canvasConfigured && <SetupBanner />}

        {/* Page title */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Courses & Academic</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {courses ? `${courses.length} course${courses.length !== 1 ? 's' : ''} synced` : 'Loading…'}
          </p>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-1/2 mb-3" />
                  <div className="h-5 bg-slate-200 rounded w-3/4 mb-4" />
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100">
                    {[1,2,3].map(j => <div key={j} className="h-8 bg-slate-100 rounded" />)}
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-8 animate-pulse">
              <div className="space-y-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-16 bg-slate-100 rounded" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
            Failed to load courses. Make sure the backend is running.
          </div>
        )}

        {/* Empty state (no courses yet) */}
        {!isLoading && !error && courses && courses.length === 0 && (
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

        {/* Course grid + academic sections */}
        {!isLoading && courses && courses.length > 0 && (
          <div className="space-y-8">
            {/* Course cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {courses.map(course => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>

            {/* Performance ranking */}
            <CoursePerformance courses={courses} />
          </div>
        )}
      </main>
    </div>
  )
}

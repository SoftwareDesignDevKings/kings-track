import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import CanvasOutageBanner from '../components/CanvasOutageBanner'
import {
  useCourses, useStudents, useAttendanceStats, useHealth,
} from '../services/api'
import type {
  Course, StudentListItem, AttendanceDashboardStats,
} from '../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format a 0-1 decimal rate as a percentage string. */
function pct(value: number | null | undefined): string {
  if (value == null) return '—'
  // If value is 0-1 decimal, convert to percentage; if already >1, treat as percentage
  const v = value <= 1 && value > 0 ? Math.round(value * 100) : Math.round(value)
  return `${v}%`
}

/** Return a color class based on a 0-1 decimal rate. */
function rateColor(rate: number | null | undefined): string {
  if (rate == null) return 'text-slate-400'
  const v = rate <= 1 ? rate * 100 : rate
  if (v >= 80) return 'text-emerald-600'
  if (v >= 60) return 'text-amber-600'
  return 'text-red-600'
}

// ─── Summary Cards ──────────────────────────────────────────────────────────

function SummaryCards({
  courses, students, stats,
}: {
  courses: Course[]
  students: StudentListItem[]
  stats: AttendanceDashboardStats | undefined
}) {
  const totalStudents = students.length
  const totalCourses = courses.length
  const concernCount = students.filter(s => s.concern.is_concern).length

  const avgCompletion = students.length > 0
    ? students.reduce((s, st) => s + (st.avg_completion_rate ?? 0), 0) / Math.max(students.filter(s => s.avg_completion_rate != null).length, 1)
    : null
  const avgAttendance = stats?.attendance_distribution
    ? Math.round((stats.attendance_distribution.present + stats.attendance_distribution.late) / Math.max(stats.attendance_distribution.total, 1) * 100)
    : null

  const cards = [
    { label: 'Total Students', value: String(totalStudents), sub: `across ${totalCourses} courses`, accent: 'text-brand-700', bg: 'bg-brand-50', link: '/students' },
    { label: 'Avg Completion', value: pct(avgCompletion || null), sub: 'assignment completion', accent: 'text-emerald-700', bg: 'bg-emerald-50', link: '/courses' },
    { label: 'Attendance Rate', value: avgAttendance != null ? `${avgAttendance}%` : '—', sub: `${stats?.total_meetings ?? 0} meetings tracked`, accent: 'text-blue-700', bg: 'bg-blue-50', link: '/students' },
    { label: 'Students of Concern', value: String(concernCount), sub: concernCount > 0 ? 'need attention' : 'none flagged', accent: concernCount > 0 ? 'text-red-700' : 'text-slate-600', bg: concernCount > 0 ? 'bg-red-50' : 'bg-slate-50', link: '/students' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {cards.map(c => (
        <Link key={c.label} to={c.link} className="bg-white rounded-xl border border-slate-200 p-5 hover:border-brand-300 hover:shadow-sm transition-all">
          <p className="text-xs font-medium text-slate-500 mb-1">{c.label}</p>
          <p className={`text-2xl font-bold ${c.accent}`}>{c.value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{c.sub}</p>
        </Link>
      ))}
    </div>
  )
}

// ─── Completion Distribution Chart ──────────────────────────────────────────

function CompletionDistribution({ students }: { students: StudentListItem[] }) {
  const buckets = useMemo(() => {
    const ranges = [
      { label: '90-100%', min: 90, max: 101, color: 'bg-emerald-500' },
      { label: '70-89%', min: 70, max: 90, color: 'bg-emerald-300' },
      { label: '50-69%', min: 50, max: 70, color: 'bg-amber-400' },
      { label: '30-49%', min: 30, max: 50, color: 'bg-orange-400' },
      { label: '0-29%', min: 0, max: 30, color: 'bg-red-400' },
    ]
    const maxCount = Math.max(
      ...ranges.map(r =>
        students.filter(s => {
          const raw = s.avg_completion_rate ?? 0
          const v = raw <= 1 && raw > 0 ? raw * 100 : raw
          return v >= r.min && v < r.max
        }).length
      ),
      1
    )
    return ranges.map(r => ({
      ...r,
      count: students.filter(s => {
        const raw = s.avg_completion_rate ?? 0
        const v = raw <= 1 && raw > 0 ? raw * 100 : raw
        return v >= r.min && v < r.max
      }).length,
      maxCount,
    }))
  }, [students])

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-800">Completion Distribution</h3>
        <Link to="/courses" className="text-xs text-brand-600 hover:text-brand-700 font-medium">View Courses →</Link>
      </div>
      <div className="space-y-2.5">
        {buckets.map(b => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="text-xs text-slate-500 w-14 shrink-0 text-right tabular-nums">{b.label}</span>
            <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
              <div
                className={`h-full rounded ${b.color} transition-all`}
                style={{ width: `${(b.count / b.maxCount) * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium text-slate-600 w-8 tabular-nums">{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Attendance Distribution Chart ──────────────────────────────────────────

function AttendanceDistribution({ stats }: { stats: AttendanceDashboardStats | undefined }) {
  const dist = stats?.attendance_distribution
  if (!dist || dist.total === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Attendance Overview</h3>
        <p className="text-sm text-slate-400 text-center py-6">No attendance data yet. Import Teams CSV files to see attendance stats.</p>
      </div>
    )
  }

  const segments = [
    { label: 'Present', count: dist.present, color: 'bg-emerald-500' },
    { label: 'Late', count: dist.late, color: 'bg-amber-400' },
    { label: 'Partial', count: dist.partial, color: 'bg-orange-400' },
    { label: 'Absent', count: dist.absent, color: 'bg-red-400' },
  ]
  const total = dist.total

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-800">Attendance Overview</h3>
        <span className="text-xs text-slate-400">{stats?.total_meetings ?? 0} meetings</span>
      </div>
      {/* Stacked bar */}
      <div className="flex h-6 rounded-lg overflow-hidden mb-4">
        {segments.map(seg => seg.count > 0 && (
          <div
            key={seg.label}
            className={`${seg.color} transition-all`}
            style={{ width: `${(seg.count / total) * 100}%` }}
            title={`${seg.label}: ${seg.count} (${Math.round(seg.count / total * 100)}%)`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {segments.map(seg => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${seg.color}`} />
            <span className="text-xs text-slate-600">{seg.label}</span>
            <span className="text-xs font-medium text-slate-800 tabular-nums">{Math.round(seg.count / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Course Performance ─────────────────────────────────────────────────────

function CoursePerformance({ courses }: { courses: Course[] }) {
  const sorted = useMemo(
    () => [...courses].sort((a, b) => (a.avg_completion_rate ?? 100) - (b.avg_completion_rate ?? 100)).slice(0, 6),
    [courses]
  )

  if (courses.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Course Performance</h3>
        <p className="text-sm text-slate-400 text-center py-6">No courses synced yet. Go to Settings to add courses and sync data.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-800">Course Performance</h3>
        <Link to="/courses" className="text-xs text-brand-600 hover:text-brand-700 font-medium">All Courses →</Link>
      </div>
      <div className="space-y-3">
        {sorted.map(c => {
          const raw = c.avg_completion_rate ?? 0
          const completion = raw <= 1 && raw > 0 ? raw * 100 : raw
          const barColor = completion >= 80 ? 'bg-emerald-400' : completion >= 60 ? 'bg-amber-400' : 'bg-red-400'
          return (
            <Link key={c.id} to={`/courses/${c.id}`} className="block hover:bg-slate-50 -mx-2 px-2 py-1.5 rounded-lg transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-slate-700 font-medium truncate mr-4">{c.name}</span>
                <span className={`text-xs font-semibold tabular-nums ${rateColor(c.avg_completion_rate)}`}>{pct(c.avg_completion_rate)}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(completion, 100)}%` }} />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ─── Students of Concern ────────────────────────────────────────────────────

function ConcernList({ students }: { students: StudentListItem[] }) {
  const concerns = useMemo(
    () => students
      .filter(s => s.concern.is_concern)
      .sort((a, b) => {
        if (a.concern.level === 'high' && b.concern.level !== 'high') return -1
        if (a.concern.level !== 'high' && b.concern.level === 'high') return 1
        return (a.avg_completion_rate ?? 0) - (b.avg_completion_rate ?? 0)
      })
      .slice(0, 8),
    [students]
  )

  if (concerns.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Students of Concern</h3>
        <p className="text-sm text-slate-400 text-center py-6">No students flagged as concerns.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-red-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-red-700">Students of Concern</h3>
        <Link to="/students" className="text-xs text-brand-600 hover:text-brand-700 font-medium">View All Students →</Link>
      </div>
      <div className="space-y-2">
        {concerns.map(s => {
          const badge = s.concern.level === 'high'
            ? 'bg-red-100 text-red-700 border-red-200'
            : 'bg-amber-100 text-amber-700 border-amber-200'
          return (
            <Link
              key={s.id}
              to={`/students/${s.id}`}
              className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg hover:bg-red-50/50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                <p className="text-xs text-slate-400">{s.course_count} courses</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className={`text-xs font-semibold ${rateColor(s.avg_completion_rate)}`}>{pct(s.avg_completion_rate)}</p>
                  <p className="text-[10px] text-slate-400">completion</p>
                </div>
                <div className="text-right">
                  <p className={`text-xs font-semibold ${rateColor(s.attendance_rate)}`}>{pct(s.attendance_rate)}</p>
                  <p className="text-[10px] text-slate-400">attendance</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${badge}`}>
                  {s.concern.level === 'high' ? 'High' : 'Moderate'}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ─── Setup Prompt ───────────────────────────────────────────────────────────

function SetupPrompt() {
  return (
    <div className="bg-white rounded-xl border border-amber-200 p-6 text-center">
      <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
        <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-slate-800 mb-1">Set up Canvas Connection</h3>
      <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
        Set CANVAS_API_URL and CANVAS_API_TOKEN in your .env file, then restart the backend and click Sync Now.
      </p>
      <Link
        to="/admin"
        className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
      >
        Go to Settings
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
        </svg>
      </Link>
    </div>
  )
}

// ─── Main Dashboard ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: courses, isLoading: coursesLoading } = useCourses()
  const { data: students, isLoading: studentsLoading } = useStudents()
  const { data: stats } = useAttendanceStats()
  const { data: health } = useHealth()

  const isLoading = coursesLoading || studentsLoading
  const hasData = (courses?.length ?? 0) > 0 || (students?.length ?? 0) > 0

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <CanvasOutageBanner />

      <main className="max-w-screen-2xl mx-auto px-6 py-8">
        {/* Page title */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Dashboard</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {hasData
              ? `${courses?.length ?? 0} courses, ${students?.length ?? 0} students`
              : 'Overview of student engagement and course performance'}
          </p>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                <div className="h-3 bg-slate-200 rounded w-20 mb-2" />
                <div className="h-7 bg-slate-200 rounded w-16 mb-1" />
                <div className="h-3 bg-slate-100 rounded w-24" />
              </div>
            ))}
          </div>
        )}

        {/* Setup prompt when Canvas not configured or no data */}
        {!isLoading && !hasData && health && !health.canvas_configured && (
          <SetupPrompt />
        )}

        {/* Summary cards + graphs */}
        {!isLoading && courses && students && (
          <>
            <SummaryCards courses={courses} students={students} stats={stats} />

            {/* Graphs row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <CompletionDistribution students={students} />
              <AttendanceDistribution stats={stats} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CoursePerformance courses={courses} />
              <ConcernList students={students} />
            </div>
          </>
        )}

        {/* No data but canvas is configured — prompt to sync */}
        {!isLoading && !hasData && health?.canvas_configured && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
            <h3 className="text-base font-semibold text-slate-800 mb-1">No data yet</h3>
            <p className="text-sm text-slate-500 mb-4">Canvas is connected. Go to Settings and add courses to the whitelist, then trigger a sync.</p>
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
            >
              Go to Settings
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

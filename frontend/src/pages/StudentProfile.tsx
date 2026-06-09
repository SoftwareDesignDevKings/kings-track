import { useMemo } from 'react'
import { useParams, Link, Navigate, useSearchParams } from 'react-router-dom'
import {
  OverviewRadarChart,
  CanvasGroupChart,
  CanvasScoreChart,
  EdStemModuleChart,
  GradeoExamChart,
  AttendanceDonutChart,
  AttendanceByClassChart,
} from '../components/charts'
import { useStudentProfile, useStudentLearningOverview } from '../services/api'

type TabId = 'overview' | 'canvas' | 'edstem' | 'gradeo' | 'attendance'

interface Tab {
  id: TabId
  label: string
}

const ALL_TABS: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'edstem', label: 'EdStem' },
  { id: 'gradeo', label: 'Gradeo' },
  { id: 'attendance', label: 'Attendance' },
]

function getTabFromSearch(value: string | null): TabId {
  if (value === 'canvas' || value === 'edstem' || value === 'gradeo' || value === 'attendance') return value
  return 'overview'
}

function formatPct(value: number | null, scale: number = 100): string {
  if (value === null) return '-'
  return `${Math.round(value * scale)}%`
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'present': return 'bg-emerald-100 text-emerald-700'
    case 'late': return 'bg-amber-100 text-amber-700'
    case 'partial': return 'bg-amber-50 text-amber-600'
    case 'absent': return 'bg-red-100 text-red-700'
    default: return 'bg-slate-100 text-slate-600'
  }
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  )
}

export default function StudentProfile() {
  const { userId } = useParams<{ userId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const id = Number(userId)
  const activeTab = getTabFromSearch(searchParams.get('tab'))

  const { data: profile, isLoading: profileLoading, error: profileError } = useStudentProfile(id)
  const { data: learning, isLoading: learningLoading } = useStudentLearningOverview(id)

  const tabs = useMemo(() => {
    if (!learning) return ALL_TABS.filter(t => t.id === 'overview' || t.id === 'attendance')
    return ALL_TABS.filter(tab => {
      if (tab.id === 'edstem') return Object.keys(learning.edstem).length > 0
      if (tab.id === 'gradeo') return Object.keys(learning.gradeo).length > 0
      if (tab.id === 'canvas') return Object.keys(learning.canvas).length > 0
      return true
    })
  }, [learning])

  function setTab(tab: TabId) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (tab === 'overview') {
        next.delete('tab')
      } else {
        next.set('tab', tab)
      }
      return next
    }, { replace: true })
  }

  if (!userId || isNaN(id)) {
    return <Navigate to="/students" replace />
  }

  return (
    <div className="h-full w-full overflow-auto">

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Breadcrumb */}
        <nav className="mb-5 flex items-center gap-2 text-sm text-slate-400">
          <Link to="/students" className="hover:text-brand-600 transition-colors">Students</Link>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-slate-600">
            {profileLoading ? '...' : (profile?.student.name ?? 'Student')}
          </span>
        </nav>

        {/* Loading */}
        {profileLoading && (
          <div className="space-y-4 animate-pulse">
            <div className="h-8 bg-slate-200 rounded w-60" />
            <div className="h-4 bg-slate-200 rounded w-40" />
            <div className="grid grid-cols-4 gap-4 mt-6">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-slate-100 rounded-xl" />)}
            </div>
          </div>
        )}

        {/* Error */}
        {profileError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
            Failed to load student profile. The student may not exist or the backend may be unavailable.
          </div>
        )}

        {profile && (
          <>
            {/* Header */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-slate-900 leading-tight">{profile.student.name}</h2>
                  {profile.concern.is_concern && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      profile.concern.level === 'high'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {profile.concern.level === 'high' ? 'High Concern' : 'Moderate Concern'}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-0.5">{profile.student.email}</p>
                {profile.student.sis_id && (
                  <p className="text-xs text-slate-400 mt-0.5">SIS: {profile.student.sis_id}</p>
                )}
              </div>

              <div className="grid grid-cols-4 gap-3 text-sm shrink-0 sm:flex sm:items-center sm:gap-5">
                <MetricCard label="Completion" value={formatPct(profile.overview.avg_completion_rate)} />
                <MetricCard label="On-Time" value={formatPct(profile.overview.avg_on_time_rate)} />
                <MetricCard label="Avg Score" value={profile.overview.avg_score !== null ? `${Math.round(profile.overview.avg_score)}%` : '-'} />
                <MetricCard label="Attendance" value={profile.overview.attendance_rate !== null ? `${profile.overview.attendance_rate}%` : '-'} />
              </div>
            </div>

            {/* Tabs */}
            <div className="mb-6 overflow-x-auto overflow-y-hidden border-b border-slate-200">
              <div className="flex min-w-max items-center gap-1">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setTab(tab.id)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-brand-500 text-brand-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <section>
              {activeTab === 'overview' && (
                <OverviewTab profile={profile} learning={learning} learningLoading={learningLoading} />
              )}
              {activeTab === 'canvas' && learning && <CanvasTab learning={learning} />}
              {activeTab === 'edstem' && learning && <EdStemTab learning={learning} />}
              {activeTab === 'gradeo' && learning && <GradeoTab learning={learning} />}
              {activeTab === 'attendance' && <AttendanceTab profile={profile} />}
            </section>
          </>
        )}
      </main>
    </div>
  )
}


// ─── Tab components ──────────────────────────────────────────────────────────

function OverviewTab({
  profile,
  learning,
  learningLoading,
}: {
  profile: NonNullable<ReturnType<typeof useStudentProfile>['data']>
  learning: ReturnType<typeof useStudentLearningOverview>['data']
  learningLoading: boolean
}) {
  return (
    <div className="space-y-6">
      {/* Top row: Radar + Course metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-600 mb-2">Performance Overview</h3>
          <OverviewRadarChart overview={profile.overview} />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-600 mb-3">Course Metrics</h3>
          {profile.courses.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No course data available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 uppercase tracking-wide">
                    <th className="text-left py-2">Course</th>
                    <th className="text-right py-2">Completion</th>
                    <th className="text-right py-2">On-Time</th>
                    <th className="text-right py-2">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {profile.courses.map(c => (
                    <tr key={c.course_id}>
                      <td className="py-2 text-slate-800 font-medium">
                        {c.course_name}
                        {c.course_code && <span className="text-xs text-slate-400 ml-2">{c.course_code}</span>}
                      </td>
                      <td className="py-2 text-right text-slate-600">{formatPct(c.completion_rate)}</td>
                      <td className="py-2 text-right text-slate-600">{formatPct(c.on_time_rate)}</td>
                      <td className="py-2 text-right text-slate-600">
                        {c.current_score !== null ? `${Math.round(c.current_score)}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Concern reasons */}
      {profile.concern.is_concern && profile.concern.reasons.length > 0 && (
        <div className={`rounded-xl border p-4 ${
          profile.concern.level === 'high'
            ? 'bg-red-50 border-red-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <h3 className={`text-sm font-medium mb-2 ${
            profile.concern.level === 'high' ? 'text-red-800' : 'text-amber-800'
          }`}>
            Concern Indicators
          </h3>
          <ul className="space-y-1">
            {profile.concern.reasons.map((reason, i) => (
              <li key={i} className={`text-sm ${
                profile.concern.level === 'high' ? 'text-red-700' : 'text-amber-700'
              }`}>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Struggling areas */}
      {learningLoading && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
          <div className="h-4 bg-slate-200 rounded w-40 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-slate-100 rounded" />)}
          </div>
        </div>
      )}
      {learning && learning.struggling_areas.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-600 mb-3">Areas Needing Attention</h3>
          <div className="space-y-2">
            {learning.struggling_areas.map((area, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className={`w-1 self-stretch rounded-full shrink-0 ${
                  area.score_pct < 30 ? 'bg-red-400' : 'bg-amber-400'
                }`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{area.area}</p>
                  <p className="text-xs text-slate-500">
                    {area.course_name}
                    <span className="mx-1.5 text-slate-300">|</span>
                    <span className={`capitalize ${
                      area.source === 'canvas' ? 'text-brand-600' :
                      area.source === 'edstem' ? 'text-violet-600' :
                      'text-emerald-600'
                    }`}>{area.source}</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{area.detail}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                  area.score_pct < 30 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {area.score_pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submission stats */}
      {Object.keys(profile.submission_stats).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-600 mb-3">Submission Summary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {profile.courses.map(course => {
              const stats = profile.submission_stats[String(course.course_id)]
              if (!stats) return null
              return (
                <div key={course.course_id} className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-sm font-medium text-slate-800 mb-2 truncate">{course.course_name}</p>
                  <div className="grid grid-cols-5 gap-1 text-center text-xs">
                    <div>
                      <p className="font-bold text-slate-700">{stats.total}</p>
                      <p className="text-slate-400">Total</p>
                    </div>
                    <div>
                      <p className="font-bold text-emerald-600">{stats.submitted}</p>
                      <p className="text-slate-400">Submitted</p>
                    </div>
                    <div>
                      <p className="font-bold text-brand-600">{stats.graded}</p>
                      <p className="text-slate-400">Graded</p>
                    </div>
                    <div>
                      <p className="font-bold text-amber-600">{stats.late}</p>
                      <p className="text-slate-400">Late</p>
                    </div>
                    <div>
                      <p className="font-bold text-red-600">{stats.missing}</p>
                      <p className="text-slate-400">Missing</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}


function CanvasTab({ learning }: { learning: NonNullable<ReturnType<typeof useStudentLearningOverview>['data']> }) {
  const entries = Object.entries(learning.canvas)

  if (entries.length === 0) {
    return <div className="text-center py-16 text-slate-400 text-sm">No Canvas data available</div>
  }

  return (
    <div className="space-y-8">
      {entries.map(([courseId, course]) => (
        <div key={courseId}>
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            {course.course_name}
            {course.course_code && <span className="text-sm text-slate-400 ml-2">{course.course_code}</span>}
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-medium text-slate-600 mb-4">Submission Status by Group</h4>
              <CanvasGroupChart groups={course.groups} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-medium text-slate-600 mb-4">Scores by Group</h4>
              <CanvasScoreChart groups={course.groups} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}


function EdStemTab({ learning }: { learning: NonNullable<ReturnType<typeof useStudentLearningOverview>['data']> }) {
  const entries = Object.entries(learning.edstem)

  if (entries.length === 0) {
    return <div className="text-center py-16 text-slate-400 text-sm">No EdStem data available</div>
  }

  return (
    <div className="space-y-8">
      {entries.map(([courseId, course]) => (
        <div key={courseId}>
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            {course.course_name}
            {course.course_code && <span className="text-sm text-slate-400 ml-2">{course.course_code}</span>}
          </h3>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h4 className="text-sm font-medium text-slate-600 mb-4">Module Progress</h4>
            <EdStemModuleChart modules={course.modules} />
          </div>
        </div>
      ))}
    </div>
  )
}


function GradeoTab({ learning }: { learning: NonNullable<ReturnType<typeof useStudentLearningOverview>['data']> }) {
  const entries = Object.entries(learning.gradeo)

  if (entries.length === 0) {
    return <div className="text-center py-16 text-slate-400 text-sm">No Gradeo data available</div>
  }

  return (
    <div className="space-y-8">
      {entries.map(([courseId, course]) => (
        <div key={courseId}>
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            {course.course_name}
            {course.course_code && <span className="text-sm text-slate-400 ml-2">{course.course_code}</span>}
          </h3>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h4 className="text-sm font-medium text-slate-600 mb-4">Exam Scores vs Class Average</h4>
            <GradeoExamChart exams={course.exams} />
          </div>
        </div>
      ))}
    </div>
  )
}


function AttendanceTab({ profile }: { profile: NonNullable<ReturnType<typeof useStudentProfile>['data']> }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-600 mb-2">Attendance Distribution</h3>
          <AttendanceDonutChart summary={profile.attendance_summary} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-600 mb-2">Attendance by Class</h3>
          <AttendanceByClassChart classes={profile.attendance_by_class} />
        </div>
      </div>

      {/* Recent attendance table */}
      {profile.recent_attendance.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-600 mb-3">Recent Attendance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase tracking-wide">
                  <th className="text-left py-2 pr-3">Date</th>
                  <th className="text-left py-2 pr-3">Meeting</th>
                  <th className="text-left py-2 pr-3">Class</th>
                  <th className="text-left py-2 pr-3">Duration</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profile.recent_attendance.map((r) => (
                  <tr key={`${r.meeting_id}-${r.join_time}`}>
                    <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="py-2 pr-3 text-slate-800">{r.meeting_title}</td>
                    <td className="py-2 pr-3 text-slate-500">{r.class_code ?? '-'}</td>
                    <td className="py-2 pr-3 text-slate-500">{r.duration_minutes ? `${r.duration_minutes}m` : '-'}</td>
                    <td className="py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(r.status)}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {profile.recent_attendance.length === 0 && profile.attendance_summary.total_meetings === 0 && (
        <div className="text-center py-16 text-slate-400 text-sm">
          No attendance records available
        </div>
      )}
    </div>
  )
}

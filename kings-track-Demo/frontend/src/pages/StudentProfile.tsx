import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Header from '../components/Header'
import { useStudentProfile, useStudentLearningOverview, useStudentAcademicBreakdown } from '../services/api'
import { StrugglingAreas, CanvasBreakdown, EdStemBreakdown, GradeoBreakdown } from '../components/LearningOverview'
import type { StudentProfile as StudentProfileType, StudentLearningOverview, StudentAcademicBreakdown, AcademicCourse, AcademicUnit, AcademicAssignment, AcademicEdStemModule, AcademicGradeoExam, AttendanceByClass, RecentAttendance, StudentCourseData } from '../types'

type TabId = 'overview' | 'attendance' | 'academic'

// ─── Helpers ────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  const n = v <= 1 && v > 0 ? Math.round(v * 100) : Math.round(v)
  return `${n}%`
}

function toPercent(v: number): number {
  return v <= 1 ? v * 100 : v
}

function rateColor(v: number | null | undefined): string {
  if (v == null) return 'text-slate-400'
  const n = toPercent(v)
  if (n >= 80) return 'text-emerald-600'
  if (n >= 60) return 'text-amber-600'
  return 'text-red-600'
}

function rateBg(v: number | null | undefined): string {
  if (v == null) return 'bg-slate-200'
  const n = toPercent(v)
  if (n >= 80) return 'bg-emerald-400'
  if (n >= 60) return 'bg-amber-400'
  return 'bg-red-400'
}

function statusDot(status: string) {
  const map: Record<string, string> = {
    present: 'bg-emerald-400',
    late: 'bg-amber-400',
    partial: 'bg-orange-400',
    absent: 'bg-red-400',
  }
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${map[status] || 'bg-slate-300'}`} />
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
}

// ─── Concern Banner ─────────────────────────────────────────────────────────

function ConcernBanner({ concern }: { concern: StudentProfileType['concern'] }) {
  if (!concern.is_concern) return null

  const isHigh = concern.level === 'high'
  const borderColor = isHigh ? 'border-red-300' : 'border-amber-300'
  const bgColor = isHigh ? 'bg-red-50' : 'bg-amber-50'
  const textColor = isHigh ? 'text-red-800' : 'text-amber-800'
  const subColor = isHigh ? 'text-red-600' : 'text-amber-600'
  const iconBg = isHigh ? 'bg-red-100' : 'bg-amber-100'
  const iconColor = isHigh ? 'text-red-600' : 'text-amber-600'

  return (
    <div className={`${bgColor} border ${borderColor} rounded-xl p-4 mb-6`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-8 h-8 ${iconBg} rounded-full flex items-center justify-center`}>
          <svg className={`w-4 h-4 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div>
          <h3 className={`text-sm font-semibold ${textColor}`}>
            Student of Concern — {isHigh ? 'High Priority' : 'Moderate'}
          </h3>
          <ul className={`mt-1 text-sm ${subColor} space-y-0.5`}>
            {concern.reasons.map((r, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ─── Metric Card ────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-slate-800'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Mini bar chart (horizontal) ────────────────────────────────────────────

function HorizontalBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  )
}

// ─── Overview Tab ───────────────────────────────────────────────────────────

function OverviewTab({ profile, learningOverview, learningLoading }: {
  profile: StudentProfileType
  learningOverview: StudentLearningOverview | undefined
  learningLoading: boolean
}) {
  const { overview, courses, attendance_summary, submission_stats } = profile

  return (
    <div className="space-y-6">
      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Attendance Rate" value={pct(overview.attendance_rate)} color={rateColor(overview.attendance_rate)} sub={`${attendance_summary.total_meetings} meetings`} />
        <MetricCard label="Avg Completion" value={pct(overview.avg_completion_rate)} color={rateColor(overview.avg_completion_rate)} sub={`${overview.total_courses} courses`} />
        <MetricCard label="Avg On-Time" value={pct(overview.avg_on_time_rate)} color={rateColor(overview.avg_on_time_rate)} />
        <MetricCard label="Avg Score" value={overview.avg_score != null ? overview.avg_score.toFixed(1) : '—'} color={rateColor(overview.avg_score)} />
      </div>

      {/* Course performance summary */}
      {courses.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Course Performance</h3>
          <div className="space-y-4">
            {courses.map((c: StudentCourseData) => {
              const stats = submission_stats[c.course_id]
              const totalAssignments = stats?.total ?? 0
              const submitted = (stats?.submitted ?? 0) + (stats?.graded ?? 0)
              const missing = stats?.missing ?? 0
              const lateCount = stats?.late ?? 0

              return (
                <div key={c.course_id} className="border border-slate-100 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0">
                      <Link to={`/courses/${c.course_id}`} className="text-sm font-semibold text-slate-800 hover:text-brand-600 transition-colors">
                        {c.course_name}
                      </Link>
                      {c.course_code && <p className="text-xs text-slate-400 font-mono">{c.course_code}</p>}
                    </div>
                    <div className="shrink-0 text-right ml-3">
                      <p className={`text-lg font-bold ${rateColor(c.current_score)}`}>
                        {c.current_score != null ? c.current_score.toFixed(1) : '—'}
                      </p>
                      <p className="text-xs text-slate-400">score</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-2">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-500">Completion</span>
                        <span className={`text-xs font-bold ${rateColor(c.completion_rate)}`}>{pct(c.completion_rate)}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${rateBg(c.completion_rate)}`} style={{ width: `${Math.min(toPercent(c.completion_rate ?? 0), 100)}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-500">On-Time</span>
                        <span className={`text-xs font-bold ${rateColor(c.on_time_rate)}`}>{pct(c.on_time_rate)}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${rateBg(c.on_time_rate)}`} style={{ width: `${Math.min(toPercent(c.on_time_rate ?? 0), 100)}%` }} />
                      </div>
                    </div>
                  </div>
                  {totalAssignments > 0 && (
                    <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-xs">
                      <span className="text-slate-500">{totalAssignments} assignments</span>
                      <span className="text-emerald-600">{submitted} submitted</span>
                      {lateCount > 0 && <span className="text-amber-600">{lateCount} late</span>}
                      {missing > 0 && <span className="text-red-600">{missing} missing</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Platform breakdowns & struggling areas */}
      {learningLoading && (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="h-4 bg-slate-200 rounded w-48 mb-4" />
              <div className="space-y-3">
                {[1, 2].map(j => <div key={j} className="h-8 bg-slate-100 rounded" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {learningOverview && (
        <>
          <StrugglingAreas areas={learningOverview.struggling_areas} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CanvasBreakdown data={learningOverview.canvas} />
            <EdStemBreakdown data={learningOverview.edstem} />
          </div>
          <GradeoBreakdown data={learningOverview.gradeo} />
        </>
      )}
    </div>
  )
}

// ─── Attendance Tab ─────────────────────────────────────────────────────────

function AttendanceTab({ profile }: { profile: StudentProfileType }) {
  const { attendance_summary, attendance_by_class, recent_attendance } = profile
  const total = attendance_summary.total_meetings || 1

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Attendance Distribution</h3>
        <div className="flex h-6 rounded-full overflow-hidden bg-slate-100 mb-3">
          {attendance_summary.present > 0 && (
            <div className="bg-emerald-400" style={{ width: `${(attendance_summary.present / total) * 100}%` }} title={`Present: ${attendance_summary.present}`} />
          )}
          {attendance_summary.late > 0 && (
            <div className="bg-amber-400" style={{ width: `${(attendance_summary.late / total) * 100}%` }} title={`Late: ${attendance_summary.late}`} />
          )}
          {attendance_summary.partial > 0 && (
            <div className="bg-orange-400" style={{ width: `${(attendance_summary.partial / total) * 100}%` }} title={`Partial: ${attendance_summary.partial}`} />
          )}
        </div>
        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-lg font-bold text-emerald-600">{attendance_summary.present}</p>
            <p className="text-xs text-slate-400">Present</p>
          </div>
          <div>
            <p className="text-lg font-bold text-amber-600">{attendance_summary.late}</p>
            <p className="text-xs text-slate-400">Late</p>
          </div>
          <div>
            <p className="text-lg font-bold text-orange-600">{attendance_summary.partial}</p>
            <p className="text-xs text-slate-400">Partial</p>
          </div>
          <div>
            <p className={`text-lg font-bold ${rateColor(attendance_summary.attendance_rate)}`}>
              {pct(attendance_summary.attendance_rate)}
            </p>
            <p className="text-xs text-slate-400">Rate</p>
          </div>
        </div>
      </div>

      {/* By class */}
      {attendance_by_class.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Attendance by Class</h3>
          <div className="space-y-3">
            {attendance_by_class.map((c: AttendanceByClass) => (
              <div key={c.class_code} className="flex items-center gap-3">
                <span className="text-sm font-mono text-slate-600 w-20 shrink-0">{c.class_code}</span>
                <HorizontalBar value={c.present + c.late} max={c.total} color="bg-emerald-400" />
                <span className={`text-sm font-bold w-12 text-right ${rateColor(c.rate)}`}>{pct(c.rate)}</span>
                <span className="text-xs text-slate-400 w-16 text-right">{c.total} meetings</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent records */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Meeting History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Date</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Meeting</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Class</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Status</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Joined</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent_attendance.map((r: RecentAttendance, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-600">{formatDate(r.date)}</td>
                  <td className="px-4 py-2.5 text-slate-800 max-w-xs truncate">{r.meeting_title || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-500 text-xs">{r.class_code || '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="inline-flex items-center gap-1.5">
                      {statusDot(r.status)}
                      <span className="capitalize text-xs">{r.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-slate-500">{formatTime(r.join_time)}</td>
                  <td className="px-4 py-2.5 text-center text-slate-500">{r.duration_minutes != null ? `${r.duration_minutes}m` : '—'}</td>
                </tr>
              ))}
              {recent_attendance.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">No attendance records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Academic Tab ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  graded: { label: 'Graded', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  submitted: { label: 'Submitted', bg: 'bg-blue-100', text: 'text-blue-700' },
  missing: { label: 'Missing', bg: 'bg-red-100', text: 'text-red-700' },
  not_submitted: { label: 'Not Submitted', bg: 'bg-amber-100', text: 'text-amber-700' },
  upcoming: { label: 'Upcoming', bg: 'bg-slate-100', text: 'text-slate-500' },
}

function StatusBadge({ status, late }: { status: string; late?: boolean }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.upcoming
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
      {late && <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Late</span>}
    </span>
  )
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function UnitSection({ unit }: { unit: AcademicUnit }) {
  const [expanded, setExpanded] = useState(false)
  const completionPct = unit.total > 0 ? Math.round((unit.completed / unit.total) * 100) : 0
  const scorePct = unit.avg_score != null && unit.avg_possible != null && unit.avg_possible > 0
    ? Math.round((unit.avg_score / unit.avg_possible) * 100)
    : null

  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        {/* Completion ring */}
        <div className="relative w-9 h-9 shrink-0">
          <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
            <circle cx="18" cy="18" r="15" fill="none" stroke={completionPct >= 80 ? '#34d399' : completionPct >= 50 ? '#fbbf24' : '#f87171'} strokeWidth="3" strokeDasharray={`${completionPct * 0.94} 100`} strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-600">{completionPct}%</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{unit.unit_name}</p>
          <p className="text-xs text-slate-400">{unit.completed}/{unit.total} completed{scorePct != null ? ` · Avg ${scorePct}%` : ''}</p>
        </div>
        <svg className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-slate-50">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-4 py-2 font-medium text-slate-500">Assignment</th>
                <th className="px-4 py-2 font-medium text-slate-500 text-center w-20">Due</th>
                <th className="px-4 py-2 font-medium text-slate-500 text-center w-20">Score</th>
                <th className="px-4 py-2 font-medium text-slate-500 text-right w-28">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {unit.assignments.map((a: AcademicAssignment, i: number) => {
                const scorePctA = a.score != null && a.points_possible != null && a.points_possible > 0
                  ? Math.round((a.score / a.points_possible) * 100)
                  : null
                return (
                  <tr key={i} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 text-slate-700 font-medium max-w-[260px] truncate">{a.name}</td>
                    <td className="px-4 py-2.5 text-center text-slate-400">{formatShortDate(a.due_at)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {a.score != null ? (
                        <span className={`font-semibold ${scorePctA != null && scorePctA >= 80 ? 'text-emerald-600' : scorePctA != null && scorePctA >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                          {a.score % 1 === 0 ? a.score : a.score.toFixed(1)}/{a.points_possible}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <StatusBadge status={a.status} late={a.late} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function EdStemModuleRow({ mod }: { mod: AcademicEdStemModule }) {
  const [expanded, setExpanded] = useState(false)
  const pctDone = mod.total > 0 ? Math.round((mod.completed / mod.total) * 100) : 0
  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-700 truncate">{mod.module_name}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pctDone >= 80 ? 'bg-emerald-400' : pctDone >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pctDone}%` }} />
          </div>
          <span className={`text-xs font-semibold w-14 text-right ${pctDone >= 80 ? 'text-emerald-600' : pctDone >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {mod.completed}/{mod.total}
          </span>
        </div>
        <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-slate-50 px-4 py-2 space-y-1">
          {mod.lessons.map((l, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${l.status === 'completed' ? 'bg-emerald-400' : l.status === 'viewed' ? 'bg-amber-400' : 'bg-slate-300'}`} />
              <span className="text-xs text-slate-600 truncate">{l.title}</span>
              <span className="text-xs text-slate-400 ml-auto shrink-0 capitalize">{l.status === 'not_started' ? 'Not started' : l.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GradeoExamRow({ exam }: { exam: AcademicGradeoExam }) {
  const pctE = exam.exam_mark != null && exam.marks_available != null && exam.marks_available > 0
    ? Math.round((exam.exam_mark / exam.marks_available) * 100)
    : null
  const classAvgPct = exam.class_average != null && exam.marks_available != null && exam.marks_available > 0
    ? Math.round((exam.class_average / exam.marks_available) * 100)
    : null
  const vsAvg = pctE != null && classAvgPct != null ? pctE - classAvgPct : null

  return (
    <div className="border border-slate-100 rounded-lg p-3">
      <div className="flex items-start justify-between mb-1">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-800 truncate">{exam.exam_name}</p>
          {exam.syllabus_title && <p className="text-xs text-slate-400">{exam.syllabus_title}</p>}
        </div>
        <div className="shrink-0 text-right ml-3">
          {pctE != null ? (
            <span className={`text-sm font-bold ${pctE >= 80 ? 'text-emerald-600' : pctE >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{pctE}%</span>
          ) : (
            <span className="text-xs text-slate-400">{exam.status === 'not_submitted' ? 'Not submitted' : exam.status === 'awaiting_marking' ? 'Awaiting marking' : '—'}</span>
          )}
        </div>
      </div>
      {pctE != null && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pctE >= 80 ? 'bg-emerald-400' : pctE >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.min(pctE, 100)}%` }} />
          </div>
          <span className="text-xs text-slate-400">{exam.exam_mark}/{exam.marks_available}</span>
          {vsAvg != null && (
            <span className={`text-xs ${vsAvg >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{vsAvg >= 0 ? '+' : ''}{vsAvg}% vs avg</span>
          )}
        </div>
      )}
      {exam.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {exam.topics.map((t, j) => (
            <span key={j} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function AcademicTab({ academicData, academicLoading }: {
  academicData: StudentAcademicBreakdown | undefined
  academicLoading: boolean
}) {
  if (academicLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="h-5 bg-slate-200 rounded w-48 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map(j => <div key={j} className="h-12 bg-slate-100 rounded" />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!academicData || academicData.courses.length === 0) {
    return <div className="text-center py-12 text-slate-400">No academic data available</div>
  }

  return (
    <div className="space-y-6">
      {academicData.courses.map((course: AcademicCourse) => {
        const totalAssignments = course.units.reduce((s, u) => s + u.total, 0)
        const completedAssignments = course.units.reduce((s, u) => s + u.completed, 0)
        const overallPct = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0

        return (
          <div key={course.course_id} className="space-y-4">
            {/* Course header */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Link to={`/courses/${course.course_id}`} className="text-sm font-semibold text-slate-800 hover:text-brand-600 transition-colors">
                    {course.course_name}
                  </Link>
                  {course.course_code && <p className="text-xs text-slate-400 font-mono">{course.course_code}</p>}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-800">{completedAssignments}/{totalAssignments}</p>
                  <p className="text-xs text-slate-400">assignments completed</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${overallPct >= 80 ? 'bg-emerald-400' : overallPct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${overallPct}%` }} />
                </div>
                <span className={`text-sm font-bold ${overallPct >= 80 ? 'text-emerald-600' : overallPct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{overallPct}%</span>
              </div>
            </div>

            {/* Syllabus units */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">Syllabus Progression</h3>
              </div>
              <div className="p-4 space-y-2">
                {course.units.map((u: AcademicUnit, i: number) => (
                  <UnitSection key={i} unit={u} />
                ))}
              </div>
            </div>

            {/* EdStem modules */}
            {course.edstem_modules.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
                  <span className="w-4 h-4 rounded bg-purple-500 flex items-center justify-center text-white text-[9px] font-bold">E</span>
                  <h3 className="text-sm font-semibold text-slate-800">EdStem Lessons</h3>
                </div>
                <div className="p-4 space-y-2">
                  {course.edstem_modules.map((m: AcademicEdStemModule, i: number) => (
                    <EdStemModuleRow key={i} mod={m} />
                  ))}
                </div>
              </div>
            )}

            {/* Gradeo exams */}
            {course.gradeo_exams.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
                  <span className="w-4 h-4 rounded bg-orange-500 flex items-center justify-center text-white text-[9px] font-bold">G</span>
                  <h3 className="text-sm font-semibold text-slate-800">Exam Results</h3>
                </div>
                <div className="p-4 space-y-2">
                  {course.gradeo_exams.map((e: AcademicGradeoExam, i: number) => (
                    <GradeoExamRow key={i} exam={e} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function StudentProfile() {
  const { userId } = useParams<{ userId: string }>()
  const numericUserId = Number(userId)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const { data: profile, isLoading, error } = useStudentProfile(numericUserId)
  const { data: learningOverview, isLoading: learningLoading } = useStudentLearningOverview(numericUserId)
  const { data: academicData, isLoading: academicLoading } = useStudentAcademicBreakdown(numericUserId)

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'academic', label: 'Academic' },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="max-w-screen-2xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-slate-400 mb-4">
          <Link to="/" className="hover:text-brand-600 transition-colors">Dashboard</Link>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <span className="text-slate-600">{profile?.student.name ?? 'Student'}</span>
        </nav>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-4 animate-pulse">
            <div className="h-8 bg-slate-200 rounded w-64" />
            <div className="h-4 bg-slate-200 rounded w-40" />
            <div className="grid grid-cols-4 gap-4 mt-6">
              {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-200 rounded-xl" />)}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
            Failed to load student profile.
          </div>
        )}

        {/* Profile */}
        {profile && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{profile.student.name}</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {profile.student.email}
                  {profile.student.sis_id && <span className="ml-2 text-slate-400">ID: {profile.student.sis_id}</span>}
                </p>
              </div>
              {profile.concern.is_concern && (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  profile.concern.level === 'high'
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : 'bg-amber-100 text-amber-700 border-amber-200'
                }`}>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Student of Concern
                </span>
              )}
            </div>

            {/* Concern details */}
            <ConcernBanner concern={profile.concern} />

            {/* Tabs */}
            <div className="border-b border-slate-200 mb-6">
              <div className="flex gap-0">
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
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
            {activeTab === 'overview' && <OverviewTab profile={profile} learningOverview={learningOverview} learningLoading={learningLoading} />}
            {activeTab === 'attendance' && <AttendanceTab profile={profile} />}
            {activeTab === 'academic' && <AcademicTab academicData={academicData} academicLoading={academicLoading} />}
          </>
        )}
      </main>
    </div>
  )
}

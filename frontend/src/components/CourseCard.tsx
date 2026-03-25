import { useNavigate } from 'react-router-dom'
import type { Course } from '../types'

interface Props {
  course: Course
}

function CompletionRing({ value }: { value: number | null }) {
  if (value === null) return <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-400">—</div>
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

export default function CourseCard({ course }: Props) {
  const navigate = useNavigate()

  const formatSync = (iso: string | null) => {
    if (!iso) return 'Not synced'
    const d = new Date(iso)
    const diffMins = Math.floor((Date.now() - d.getTime()) / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffH = Math.floor(diffMins / 60)
    if (diffH < 24) return `${diffH}h ago`
    return d.toLocaleDateString()
  }

  return (
    <button
      onClick={() => navigate(`/courses/${course.id}`)}
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
            {/* RAG dot */}
            <span className={`shrink-0 w-2 h-2 rounded-full ${ragColor(course.avg_completion_rate)}`} />
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide truncate">
              {course.course_code || 'Course'}
            </span>
          </div>
          <h2 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-brand-600">
            {course.name}
          </h2>
        </div>
        <CompletionRing value={course.avg_completion_rate} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Students</p>
          <p className="text-sm font-semibold text-slate-800">{course.student_count}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">On-time</p>
          <p className="text-sm font-semibold text-slate-800">
            {course.avg_on_time_rate !== null ? `${Math.round(course.avg_on_time_rate * 100)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Avg score</p>
          <p className="text-sm font-semibold text-slate-800">
            {course.avg_current_score !== null ? `${course.avg_current_score}%` : '—'}
          </p>
        </div>
      </div>

      {/* Sync timestamp */}
      <p className="text-xs text-slate-400">Synced {formatSync(course.last_synced)}</p>
    </button>
  )
}

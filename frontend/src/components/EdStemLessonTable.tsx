import type { EdStemMatrix, EdStemModule, EdStemLessonStatus } from '../types'

interface Props {
  matrix: EdStemMatrix
}

function CompletionBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-300 text-xs">—</span>
  const pct = Math.round(value * 100)
  const barColor = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 tabular-nums">{pct}%</span>
    </div>
  )
}

const statusDotConfig: Record<EdStemLessonStatus, { dot: string; ring: string; label: string }> = {
  completed:   { dot: 'bg-emerald-400', ring: 'ring-emerald-200', label: 'Completed' },
  viewed:      { dot: 'bg-amber-400',   ring: 'ring-amber-200',   label: 'Viewed' },
  not_started: { dot: 'bg-slate-200',   ring: 'ring-slate-100',   label: 'Not started' },
}

function StatusDot({ status, lessonTitle, completedAt }: {
  status: EdStemLessonStatus
  lessonTitle: string
  completedAt: string | null
}) {
  const cfg = statusDotConfig[status]
  const tooltipLines = [
    lessonTitle,
    cfg.label,
    completedAt ? `Completed ${new Date(completedAt).toLocaleDateString()}` : null,
  ].filter(Boolean).join('\n')

  return (
    <div
      className={`w-5 h-5 mx-auto rounded-full ${cfg.dot} ring-2 ${cfg.ring} cursor-default`}
      title={tooltipLines}
    />
  )
}

export default function EdStemLessonTable({ matrix }: Props) {
  const modules = matrix.modules ?? []
  const students = matrix.students ?? []

  const allLessons = modules.flatMap(m => m.lessons)

  // Build a title lookup for tooltips
  const lessonTitleById: Record<number, string> = {}
  for (const lesson of allLessons) {
    lessonTitleById[lesson.id] = lesson.title
  }

  if (students.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No students found. Trigger a sync to load data.
      </div>
    )
  }

  if (allLessons.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No lessons found for this EdStem course.
      </div>
    )
  }

  return (
    <div className="activity-table-wrapper border border-slate-200 rounded-xl overflow-hidden">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
        <span className="font-medium">Legend:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-emerald-200 inline-block" />
          Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-400 ring-2 ring-amber-200 inline-block" />
          Viewed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-slate-200 ring-2 ring-slate-100 inline-block" />
          Not started
        </span>
      </div>

      <table className="activity-table w-full text-sm">
        <thead>
          {/* Row 1: Module headers */}
          <tr className="bg-slate-50 border-b border-slate-200">
            <th
              className="sticky-col-header px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[220px]"
              rowSpan={2}
            >
              Student
            </th>
            <th
              className="sticky-col-header px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[130px]"
              rowSpan={2}
            >
              Completion
            </th>
            {modules.map((module: EdStemModule) => (
              <th
                key={module.name}
                colSpan={module.lessons.length}
                className="px-3 py-2 text-center text-xs font-semibold text-slate-600 border-r border-slate-200 bg-slate-50"
              >
                <span className="block truncate max-w-xs" title={module.name}>
                  {module.name}
                </span>
              </th>
            ))}
          </tr>

          {/* Row 2: Individual lesson headers — rotated vertically */}
          <tr className="bg-slate-50 border-b border-slate-200">
            {allLessons.map(lesson => (
              <th
                key={lesson.id}
                className="border-r border-slate-100 last:border-r-slate-200"
                style={{ height: '130px', width: '36px', minWidth: '36px', maxWidth: '36px', verticalAlign: 'bottom', padding: '8px 4px' }}
                title={lesson.title + (lesson.is_interactive ? ' (interactive)' : '')}
              >
                <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', overflow: 'hidden', maxHeight: '120px', textOverflow: 'ellipsis' }}
                  className={`text-xs font-medium mx-auto ${lesson.is_interactive ? 'text-brand-500' : 'text-slate-500'}`}
                >
                  {lesson.title}
                </div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {students.map((student, i) => (
            <tr
              key={student.id}
              className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-brand-50/40 transition-colors`}
            >
              {/* Student name — sticky */}
              <td className={`sticky-col px-4 py-2.5 border-r border-slate-200 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                <span className="font-medium text-slate-800 text-sm">{student.name}</span>
              </td>

              {/* Completion bar */}
              <td className="px-3 py-2.5 border-r border-slate-200">
                <CompletionBar value={student.completion_rate} />
              </td>

              {/* Lesson progress dots */}
              {allLessons.map(lesson => {
                const p = student.progress[String(lesson.id)]
                const status: EdStemLessonStatus = p?.status ?? 'not_started'
                return (
                  <td key={lesson.id} className="px-2 py-2.5 text-center border-r border-slate-100 last:border-r-0">
                    <StatusDot
                      status={status}
                      lessonTitle={lesson.title}
                      completedAt={p?.completed_at ?? null}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

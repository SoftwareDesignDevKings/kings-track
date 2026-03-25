import StatusBadge from './StatusBadge'
import type { CourseMatrix, AssignmentGroup } from '../types'

interface Props {
  matrix: CourseMatrix
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

export default function ActivityTable({ matrix }: Props) {
  const { assignment_groups, students } = matrix

  // Flatten assignments (keep group info for column headers)
  const allAssignments = assignment_groups.flatMap(g => g.assignments)

  if (students.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No students found. Trigger a sync to load data.
      </div>
    )
  }

  if (allAssignments.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No published assignments found in this course.
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
          In progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-slate-200 ring-2 ring-slate-100 inline-block" />
          Not started
        </span>
      </div>

      <table className="activity-table w-full text-sm">
        <thead>
          {/* Row 1: Group headers */}
          <tr className="bg-slate-50 border-b border-slate-200">
            {/* Sticky student column header */}
            <th
              className="sticky-col-header px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[220px]"
              rowSpan={2}
            >
              Student
            </th>
            {/* Completion column */}
            <th className="sticky-col-header px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[130px]" rowSpan={2}>
              Completion
            </th>
            {/* Assignment group spanning headers */}
            {assignment_groups.map((group: AssignmentGroup) => (
              <th
                key={group.name}
                colSpan={group.assignments.length}
                className="px-3 py-2 text-center text-xs font-semibold text-slate-600 border-r border-slate-200 bg-slate-50"
              >
                <span className="block truncate max-w-xs" title={group.name}>
                  {group.name}
                </span>
              </th>
            ))}
          </tr>

          {/* Row 2: Individual assignment headers */}
          <tr className="bg-slate-50 border-b border-slate-200">
            {allAssignments.map(a => (
              <th
                key={a.id}
                className="px-2 py-2 text-center text-xs font-medium text-slate-500 border-r border-slate-100 last:border-r-slate-200 max-w-[52px]"
                title={`${a.name}${a.points_possible != null ? ` (${a.points_possible} pts)` : ''}${a.due_at ? ` · Due ${new Date(a.due_at).toLocaleDateString()}` : ''}`}
              >
                <span className="block w-10 overflow-hidden text-ellipsis mx-auto text-center leading-tight">
                  {/* Show short number from name if it matches pattern like "1.1", "2.3", else abbreviate */}
                  {a.name.match(/^\d+\.\d+/) ? a.name.match(/^(\d+\.\d+)/)?.[1] : a.name.slice(0, 4)}
                </span>
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
                <CompletionBar value={student.metrics.completion_rate} />
              </td>

              {/* Submission status badges */}
              {allAssignments.map(a => {
                const sub = student.submissions[String(a.id)]
                return (
                  <td key={a.id} className="px-2 py-2.5 text-center border-r border-slate-100 last:border-r-0">
                    {sub ? (
                      <StatusBadge
                        status={sub.status}
                        score={sub.score}
                        pointsPossible={a.points_possible}
                        late={sub.late}
                        missing={sub.missing}
                      />
                    ) : (
                      <div className="w-5 h-5 mx-auto rounded-full bg-slate-100" />
                    )}
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

import { useMemo } from 'react'
import type { RubricCriterion, TrackingScores } from '../types'
import MatrixTable from './MatrixTable'
import type { MatrixCell, MatrixTableModel } from './matrixTableTypes'

interface Student {
  id: number
  name: string
  sortable_name: string | null
}

interface Props {
  criteria: RubricCriterion[]
  students: Student[]
  scores: TrackingScores
  onScoreChange: (userId: number, criterionId: string, score: number) => void
}

const SCORE_LABELS: Record<number, string> = {
  0: 'Not Started',
  1: 'Barely',
  2: 'OK',
  3: 'Good',
}

const SCORE_COLORS: Record<number, { bg: string; text: string; ring: string }> = {
  0: { bg: 'bg-red-500', text: 'text-white', ring: 'ring-red-200' },
  1: { bg: 'bg-amber-400', text: 'text-white', ring: 'ring-amber-200' },
  2: { bg: 'bg-green-500', text: 'text-white', ring: 'ring-green-200' },
  3: { bg: 'bg-emerald-600', text: 'text-white', ring: 'ring-emerald-200' },
}

const SCORE_LEGEND_COLORS: Record<number, string> = {
  0: 'bg-red-500 text-white',
  1: 'bg-amber-400 text-white',
  2: 'bg-green-500 text-white',
  3: 'bg-emerald-600 text-white',
}

function ScoreCell({
  value,
  onChange,
}: {
  value: number | undefined
  onChange: (v: number) => void
}) {
  const current = value ?? -1

  return (
    <div className="group relative flex h-full min-h-[40px] w-full items-center justify-center px-1">
      {/* Collapsed summary: the current score as a single pill (or a faint dot when unscored).
          Fades and scales away as the picker reveals on hover. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out group-hover:scale-75 group-hover:opacity-0">
        {current >= 0 ? (
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-2 ${SCORE_COLORS[current].ring} ${SCORE_COLORS[current].bg} ${SCORE_COLORS[current].text}`}
          >
            {current}
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-slate-200 transition-colors group-hover:bg-slate-300" />
        )}
      </div>

      {/* Picker: hidden by default, eases in on hover with a left-to-right stagger. */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {[0, 1, 2, 3].map((s, i) => {
          const isActive = current === s
          const c = SCORE_COLORS[s]
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              title={`${s} – ${SCORE_LABELS[s]}`}
              style={{ transitionDelay: `${i * 40}ms` }}
              className={`flex h-6 w-6 translate-y-1 scale-90 transform items-center justify-center rounded-full text-xs font-bold tabular-nums opacity-0 ring-2 transition duration-200 ease-out hover:-translate-y-0.5 focus:outline-none group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 motion-reduce:transform-none motion-reduce:transition-none ${c.bg} ${c.text} ${
                isActive ? 'ring-slate-900/50' : c.ring
              }`}
            >
              {s}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function AssignmentTrackingTable({ criteria, students, scores, onScoreChange }: Props) {
  const model = useMemo<MatrixTableModel>(() => {
    return {
      title: 'Assignment Tracking',
      showToolbarSummary: false,
      tableClassName: 'activity-table-matrix-wide',
      floatingColumnGroupLabels: false,
      hideCompletionColumn: false,
      supportsMarks: false,
      emptyRowsMessage: 'No students found.',
      emptyColumnsMessage: 'No criteria defined for this assignment.',
      columnGroups: [{
        id: 'criteria',
        label: 'Criteria',
        columns: criteria.map(c => ({
          id: c.id,
          label: c.description,
          tooltip: c.long_description ?? c.description,
          headerVariant: 'wide',
          widthClass: 'w-36 min-w-36 max-w-36',
          cellClassName: '!p-0 !border-r-0 relative overflow-hidden',
        })),
      }],
      rows: students.map(student => {
        const studentScores = scores[String(student.id)] ?? {}
        const scoredCount = criteria.filter(c => studentScores[c.id] !== undefined).length
        const summaryValue = criteria.length > 0 ? scoredCount / criteria.length : 0

        return {
          id: student.id,
          name: student.name,
          sortableName: student.sortable_name,
          summaryValue,
          cells: Object.fromEntries(criteria.map(c => {
            const val = studentScores[c.id]
            return [
              c.id,
              {
                status: 'evidence', // required placeholder for matrix cell
                label: val !== undefined ? String(val) : 'Not scored',
                tooltip: `${student.name} · ${c.description}\n${val !== undefined ? `${val} – ${SCORE_LABELS[val]}` : 'Not scored'}`,
                renderStatus: <ScoreCell value={val} onChange={(v) => onScoreChange(student.id, c.id, v)} />,
                flags: {},
                ariaLabel: `${student.name}, ${c.description}: ${val !== undefined ? val : 'not scored'}`,
              } satisfies MatrixCell
            ]
          }))
        }
      }),
      legends: [0, 1, 2, 3].map(s => ({
        id: `score-${s}`,
        label: '',
        render: (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${SCORE_LEGEND_COLORS[s]}`}>
            {s} — {SCORE_LABELS[s]}
          </span>
        ),
      })),
    }
  }, [criteria, students, scores, onScoreChange])

  return <MatrixTable model={model} />
}

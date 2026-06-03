import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
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
  onClearScore: (userId: number, criterionId: string) => void
  onCommentChange: (userId: number, criterionId: string, comment: string) => void
  readOnly?: boolean
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

export function countsTowardTrackingProgress(score: number | null | undefined): boolean {
  return score !== null && score !== undefined && score > 0
}

// Shared base for the circular action buttons that reveal on hover.
const CIRCLE_BASE =
  'flex h-6 w-6 translate-y-1 scale-90 transform items-center justify-center rounded-full opacity-0 transition duration-200 ease-out hover:-translate-y-0.5 focus:outline-none group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 motion-reduce:transform-none motion-reduce:transition-none'

function XIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 10h8M8 14h5M21 12a8 8 0 0 1-11.5 7.2L4 20l.8-5.5A8 8 0 1 1 21 12Z"
      />
    </svg>
  )
}

interface ScoreCellProps {
  score: number | null
  comment: string | null
  onSelect: (v: number) => void
  onClear: () => void
  onCommentChange: (comment: string) => void
  readOnly?: boolean
}

function ScoreCell({ score, comment, onSelect, onClear, onCommentChange, readOnly = false }: ScoreCellProps) {
  const [commentOpen, setCommentOpen] = useState(false)
  const commentBtnRef = useRef<HTMLButtonElement>(null)
  const hasScore = score !== null
  const hasComment = !!comment

  // Read-only (viewing a committed snapshot): show the static summary, no edit affordances.
  if (readOnly) {
    return (
      <div className="flex h-full min-h-[40px] w-full items-center justify-center px-1">
        {hasScore ? (
          <span
            title={hasComment ? `Comment: ${comment}` : undefined}
            className={`relative flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-2 ${SCORE_COLORS[score].ring} ${SCORE_COLORS[score].bg} ${SCORE_COLORS[score].text}`}
          >
            {score}
            {hasComment && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white" />
            )}
          </span>
        ) : hasComment ? (
          <span
            title={`Comment: ${comment}`}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 ring-1 ring-inset ring-blue-200"
          >
            <ChatIcon />
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />
        )}
      </div>
    )
  }

  const commentButton = (
    <button
      ref={commentBtnRef}
      type="button"
      onClick={() => setCommentOpen(true)}
      title={hasComment ? `Comment: ${comment}` : 'Add comment'}
      style={{ transitionDelay: '80ms' }}
      className={`${CIRCLE_BASE} ring-1 ring-inset ${
        hasComment
          ? 'bg-blue-100 text-blue-600 ring-blue-200 hover:bg-blue-200'
          : 'bg-slate-100 text-slate-400 ring-black/5 hover:bg-slate-200 hover:text-slate-600'
      }`}
    >
      <ChatIcon />
    </button>
  )

  return (
    <div className="group relative flex h-full min-h-[40px] w-full items-center justify-center px-1">
      {/* Collapsed summary: score pill, comment glyph, or faint dot. Fades out on hover. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out group-hover:scale-75 group-hover:opacity-0">
        {hasScore ? (
          <span
            className={`relative flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-2 ${SCORE_COLORS[score].ring} ${SCORE_COLORS[score].bg} ${SCORE_COLORS[score].text}`}
          >
            {score}
            {hasComment && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white" />
            )}
          </span>
        ) : hasComment ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 ring-1 ring-inset ring-blue-200">
            <ChatIcon />
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-slate-200 transition-colors group-hover:bg-slate-300" />
        )}
      </div>

      {/* Hover content. */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {hasScore ? (
          <>
            <button
              type="button"
              onClick={onClear}
              title="Clear score"
              style={{ transitionDelay: '0ms' }}
              className={`${CIRCLE_BASE} bg-slate-100 text-slate-400 ring-1 ring-inset ring-black/5 hover:bg-slate-200 hover:text-slate-700`}
            >
              <XIcon />
            </button>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-2 ${SCORE_COLORS[score].ring} ${SCORE_COLORS[score].bg} ${SCORE_COLORS[score].text}`}
            >
              {score}
            </span>
            {commentButton}
          </>
        ) : (
          <>
            {[0, 1, 2, 3].map((s, i) => {
              const c = SCORE_COLORS[s]
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSelect(s)}
                  title={`${s} – ${SCORE_LABELS[s]}`}
                  style={{ transitionDelay: `${i * 40}ms` }}
                  className={`flex h-6 w-6 translate-y-1 scale-90 transform items-center justify-center rounded-full text-xs font-bold tabular-nums opacity-0 ring-2 transition duration-200 ease-out hover:-translate-y-0.5 focus:outline-none group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 motion-reduce:transform-none motion-reduce:transition-none ${c.bg} ${c.text} ${c.ring}`}
                >
                  {s}
                </button>
              )
            })}
            {hasComment && commentButton}
          </>
        )}
      </div>

      {commentOpen && (
        <CommentPopover
          anchorRef={commentBtnRef}
          initialValue={comment ?? ''}
          onSave={(v) => {
            onCommentChange(v)
            setCommentOpen(false)
          }}
          onClose={() => setCommentOpen(false)}
        />
      )}
    </div>
  )
}

interface CommentPopoverProps {
  anchorRef: React.RefObject<HTMLElement>
  initialValue: string
  onSave: (value: string) => void
  onClose: () => void
}

// Rendered via a portal because the matrix cell uses overflow-hidden, which would
// clip an in-cell popover.
function CommentPopover({ anchorRef, initialValue, onSave, onClose }: CommentPopoverProps) {
  const [value, setValue] = useState(initialValue)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const WIDTH = 256

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    let left = r.left + r.width / 2 - WIDTH / 2
    left = Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8))
    setPos({ top: r.bottom + 6, left })
  }, [anchorRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!cardRef.current?.contains(target) && !anchorRef.current?.contains(target)) onClose()
    }
    const onScrollResize = () => onClose()
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
  }, [onClose, anchorRef])

  if (!pos) return null

  return createPortal(
    <div
      ref={cardRef}
      style={{ top: pos.top, left: pos.left, width: WIDTH }}
      className="fixed z-[200] rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
    >
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a comment for this student on this criterion…"
        rows={4}
        className="w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(value)}
          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
        >
          Save
        </button>
      </div>
    </div>,
    document.body,
  )
}

export default function AssignmentTrackingTable({ criteria, students, scores, onScoreChange, onClearScore, onCommentChange, readOnly = false }: Props) {
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
        const scoredCount = criteria.filter(c => countsTowardTrackingProgress(studentScores[c.id]?.score)).length
        const summaryValue = criteria.length > 0 ? scoredCount / criteria.length : 0

        return {
          id: student.id,
          name: student.name,
          sortableName: student.sortable_name,
          summaryValue,
          cells: Object.fromEntries(criteria.map(c => {
            const cell = studentScores[c.id]
            const score = cell?.score ?? null
            const comment = cell?.comment ?? null
            return [
              c.id,
              {
                status: 'evidence', // required placeholder for matrix cell
                label: score != null ? String(score) : 'Not scored',
                tooltip: `${student.name} · ${c.description}\n${score != null ? `${score} – ${SCORE_LABELS[score]}` : 'Not scored'}${comment ? `\n💬 ${comment}` : ''}`,
                renderStatus: (
                  <ScoreCell
                    score={score}
                    comment={comment}
                    onSelect={(v) => onScoreChange(student.id, c.id, v)}
                    onClear={() => onClearScore(student.id, c.id)}
                    onCommentChange={(text) => onCommentChange(student.id, c.id, text)}
                    readOnly={readOnly}
                  />
                ),
                flags: {},
                ariaLabel: `${student.name}, ${c.description}: ${score != null ? score : 'not scored'}${comment ? ', has comment' : ''}`,
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
  }, [criteria, students, scores, onScoreChange, onClearScore, onCommentChange, readOnly])

  return <MatrixTable model={model} />
}

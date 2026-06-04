import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { RubricCriterion, TrackingScores } from '../types'
import MatrixTable from './MatrixTable'
import type { MatrixCell, MatrixTableModel } from './matrixTableTypes'
import { useTrackingGridNav, getNavCell, NAV_CELL_ATTR, type CellKeyContext } from './trackingGridNav'

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

// Highest possible criterion score (0–3 scale). A criterion's contribution to a
// student's completion is its score as a fraction of this max.
const MAX_TRACKING_SCORE = 3

// Weighted completion contribution for a single criterion score:
// null/0 → 0, 1 → 1/3, 2 → 2/3, 3 → 1. Tracking-table specific; other tables
// compute their own completion and are unaffected.
export function trackingCompletionFraction(score: number | null | undefined): number {
  if (score === null || score === undefined || score <= 0) return 0
  return Math.min(score, MAX_TRACKING_SCORE) / MAX_TRACKING_SCORE
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
  studentId: number
  criterionId: string
  score: number | null
  comment: string | null
  onSelect: (v: number) => void
  onClear: () => void
  onCommentChange: (comment: string) => void
  readOnly?: boolean
  // Keyboard navigation wiring. Absent in read-only (snapshot) mode.
  isActive?: boolean // currently selected → shows the highlight ring
  isTabStop?: boolean // holds the grid's single tabIndex=0 (roving tabindex)
  onActivate?: () => void
  onCellKeyDown?: (e: React.KeyboardEvent<HTMLElement>, ctx: CellKeyContext) => void
}

function ScoreCell({
  studentId,
  criterionId,
  score,
  comment,
  onSelect,
  onClear,
  onCommentChange,
  readOnly = false,
  isActive = false,
  isTabStop = false,
  onActivate,
  onCellKeyDown,
}: ScoreCellProps) {
  const [commentOpen, setCommentOpen] = useState(false)
  const commentBtnRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const hasScore = score !== null
  const hasComment = !!comment

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (commentOpen) return // popover owns the keyboard while open
    onCellKeyDown?.(e, {
      studentId,
      criterionId,
      onScore: onSelect,
      onClear,
      onOpenComment: () => setCommentOpen(true),
    })
  }

  // Return focus to the cell after the comment popover closes, so keyboard users
  // aren't dropped back to the top of the page.
  const closeComment = () => {
    setCommentOpen(false)
    rootRef.current?.focus()
  }

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
    <div
      ref={rootRef}
      {...{ [NAV_CELL_ATTR]: '' }}
      data-row-id={studentId}
      data-col-id={criterionId}
      role="gridcell"
      tabIndex={isTabStop ? 0 : -1}
      onFocus={onActivate}
      // Clicking anywhere in the cell (not just the score buttons) selects it,
      // so it becomes the keyboard target. mousedown focuses before the button click.
      onMouseDown={() => rootRef.current?.focus()}
      onKeyDown={handleKeyDown}
      className={`group relative flex h-full min-h-[40px] w-full items-center justify-center rounded-md px-1 outline-none transition-shadow ${
        isActive ? 'ring-2 ring-inset ring-brand-500' : 'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500'
      }`}
    >
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
          fallbackAnchorRef={rootRef}
          initialValue={comment ?? ''}
          onSave={(v) => {
            onCommentChange(v)
            closeComment()
          }}
          onClose={closeComment}
        />
      )}
    </div>
  )
}

interface CommentPopoverProps {
  anchorRef: React.RefObject<HTMLElement>
  // Used for positioning when the comment button isn't rendered (e.g. opened via
  // keyboard on an empty, unscored cell).
  fallbackAnchorRef?: React.RefObject<HTMLElement>
  initialValue: string
  onSave: (value: string) => void
  onClose: () => void
}

// Rendered via a portal because the matrix cell uses overflow-hidden, which would
// clip an in-cell popover.
function CommentPopover({ anchorRef, fallbackAnchorRef, initialValue, onSave, onClose }: CommentPopoverProps) {
  const [value, setValue] = useState(initialValue)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const WIDTH = 256

  useLayoutEffect(() => {
    const anchor = anchorRef.current ?? fallbackAnchorRef?.current
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    let left = r.left + r.width / 2 - WIDTH / 2
    left = Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8))
    setPos({ top: r.bottom + 6, left })
  }, [anchorRef, fallbackAnchorRef])

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
      data-tracking-comment
      style={{ top: pos.top, left: pos.left, width: WIDTH }}
      className="fixed z-[200] rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
    >
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter saves; Esc is handled by the document listener above.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSave(value)
          }
        }}
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
  const containerRef = useRef<HTMLDivElement>(null)
  const criterionIds = useMemo(() => criteria.map(c => c.id), [criteria])
  const { handleCellKeyDown } = useTrackingGridNav({ containerRef, criterionIds })

  // The selected cell — null until the user clicks or tabs into the grid, so nothing
  // is highlighted on load and arrow keys keep scrolling the page until the grid is in use.
  const [activeCell, setActiveCell] = useState<{ rowId: number; colId: string } | null>(null)

  // The single keyboard tab stop (roving tabindex). Falls back to the first cell so the
  // grid is reachable with Tab even before anything is selected — this only sets tabIndex,
  // it does not select or scroll.
  const firstCell = students.length > 0 && criteria.length > 0
    ? { rowId: students[0].id, colId: criteria[0].id }
    : null
  const tabStop = activeCell ?? firstCell

  const isSelectedCell = useCallback(
    (rowId: number, colId: string) => activeCell?.rowId === rowId && activeCell?.colId === colId,
    [activeCell],
  )
  const isTabStopCell = useCallback(
    (rowId: number, colId: string) => tabStop?.rowId === rowId && tabStop?.colId === colId,
    [tabStop?.rowId, tabStop?.colId],
  )

  // Keyboard "wake up": typing a number or 'c' while no cell is focused applies it to the
  // selected cell (or the first cell if nothing selected yet). We deliberately do NOT
  // intercept arrow keys here, so arrows still scroll the page/table until a cell is focused.
  const wakeTargetRef = useRef(tabStop)
  wakeTargetRef.current = tabStop
  useEffect(() => {
    if (readOnly) return
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const container = containerRef.current
      const active = document.activeElement as HTMLElement | null
      // A cell already has focus → its own handler deals with the key.
      if (container && active && container.contains(active) && active.hasAttribute(NAV_CELL_ATTR)) return
      // Don't hijack typing in inputs/textareas/etc. (e.g. the search box or a comment).
      if (active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable)) return

      const isValueKey = /^[0-3]$/.test(e.key) || e.key === 'c' || e.key === 'C'
      if (!isValueKey) return

      const target = wakeTargetRef.current
      if (!target) return
      const el = getNavCell(container, target.rowId, target.colId)
      if (!el) return

      e.preventDefault()
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      // Replay the press so the cell's own handler applies the score/comment.
      el.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }))
    }
    document.addEventListener('keydown', onDocKeyDown)
    return () => document.removeEventListener('keydown', onDocKeyDown)
  }, [readOnly])

  // Clicking outside the table clears the cell selection. The comment popover is
  // rendered in a portal (outside the container), so it's excluded explicitly.
  useEffect(() => {
    if (readOnly) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      if (target.closest('[data-tracking-comment]')) return
      setActiveCell(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [readOnly])

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
        const totalFraction = criteria.reduce((sum, c) => sum + trackingCompletionFraction(studentScores[c.id]?.score), 0)
        const summaryValue = criteria.length > 0 ? totalFraction / criteria.length : 0

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
                    studentId={student.id}
                    criterionId={c.id}
                    score={score}
                    comment={comment}
                    onSelect={(v) => onScoreChange(student.id, c.id, v)}
                    onClear={() => onClearScore(student.id, c.id)}
                    onCommentChange={(text) => onCommentChange(student.id, c.id, text)}
                    readOnly={readOnly}
                    isActive={isSelectedCell(student.id, c.id)}
                    isTabStop={isTabStopCell(student.id, c.id)}
                    onActivate={() => setActiveCell({ rowId: student.id, colId: c.id })}
                    onCellKeyDown={handleCellKeyDown}
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
      subtitle: readOnly ? undefined : 'Keyboard: type 0–3 to score · arrows to move · click a cell to select · c to comment',
    }
  }, [criteria, students, scores, onScoreChange, onClearScore, onCommentChange, readOnly, isSelectedCell, isTabStopCell, handleCellKeyDown])

  // `display: contents` keeps this wrapper out of the layout/flex flow so it can't affect
  // the table's internal scrolling — it exists only to scope cell queries for navigation.
  return (
    <div ref={containerRef} className="contents">
      <MatrixTable model={model} />
    </div>
  )
}

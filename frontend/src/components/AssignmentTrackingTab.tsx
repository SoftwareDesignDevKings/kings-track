import { useState, useCallback, useEffect, useRef } from 'react'
import { useTrackableAssignments, useTrackingGrid, useSaveTrackingScores, useCommitSnapshot, useSnapshot } from '../services/api'
import type { TrackingScores, TrackingCell, TrackingSnapshotSummary } from '../types'
import AssignmentTrackingTable from './AssignmentTrackingTable'

interface Props {
  courseId: number
}

const AUTO_SAVE_DELAY_MS = 800

function formatSnapshotDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function sameTrackingCell(a: TrackingCell | undefined, b: TrackingCell | undefined): boolean {
  return a?.score === b?.score && a?.comment === b?.comment
}

export function removeSavedTrackingScores(current: TrackingScores, saved: TrackingScores): TrackingScores {
  const next: TrackingScores = {}

  for (const [userId, cells] of Object.entries(current)) {
    const nextCells: TrackingScores[string] = {}
    for (const [criterionId, cell] of Object.entries(cells)) {
      if (!sameTrackingCell(cell, saved[userId]?.[criterionId])) {
        nextCells[criterionId] = cell
      }
    }
    if (Object.keys(nextCells).length > 0) {
      next[userId] = nextCells
    }
  }

  return next
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

interface AssignmentPickerProps {
  assignments: Array<{ id: number; name: string; criteria_count: number }>
  selectedId: number | null
  onChange: (id: number | null) => void
}

function AssignmentPicker({ assignments, selectedId, onChange }: AssignmentPickerProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const selected = assignments.find((a) => a.id === selectedId)

  useEffect(() => {
    if (!open) return

    const handleOutside = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={popoverRef} className="relative w-96">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium shadow-sm transition-colors ${
          open
            ? 'border-brand-300 ring-2 ring-brand-100 text-slate-800'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800'
        }`}
      >
        <span className="flex-1 truncate text-left">
          {selected ? selected.name : 'Select an assignment…'}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+0.4rem)] z-50 w-full origin-top-left rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
          <div className="max-h-64 overflow-y-auto">
            {assignments.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onChange(a.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  a.id === selectedId
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="min-w-0 truncate font-medium">{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface SnapshotPickerProps {
  snapshots: TrackingSnapshotSummary[]
  viewingId: number | null
  onChange: (id: number | null) => void
}

// Compact toolbar selector for switching between the live draft and committed snapshots.
// Keeps the snapshot list bounded (scrollable popover) so it never grows down the page.
function SnapshotPicker({ snapshots, viewingId, onChange }: SnapshotPickerProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const viewing = snapshots.find((s) => s.id === viewingId)

  useEffect(() => {
    if (!open) return
    const handleOutside = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const select = (id: number | null) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div ref={popoverRef} className="relative w-64">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium shadow-sm transition-colors ${
          open
            ? 'border-brand-300 ring-2 ring-brand-100 text-slate-800'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800'
        }`}
      >
        <span className="flex-1 truncate text-left">
          {viewing
            ? `${formatSnapshotDate(viewing.committed_at)}${viewing.label ? ` · ${viewing.label}` : ''}`
            : 'Current draft'}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-full origin-top-right rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => select(null)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                viewingId === null
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="min-w-0 truncate font-medium">Current draft</span>
              <span className="ml-auto text-xs text-slate-400">editing</span>
            </button>
            {snapshots.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => select(s.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  s.id === viewingId
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="min-w-0 flex-1 truncate tabular-nums">{formatSnapshotDate(s.committed_at)}</span>
                {s.label && <span className="min-w-0 truncate font-medium text-slate-700">{s.label}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AssignmentTrackingTab({ courseId }: Props) {
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null)
  const [dirtyScores, setDirtyScores] = useState<TrackingScores>({})
  const [commitLabel, setCommitLabel] = useState('')
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [viewingSnapshotId, setViewingSnapshotId] = useState<number | null>(null)

  const { data: assignments, isLoading: assignmentsLoading } = useTrackableAssignments(courseId)
  const { data: grid, isLoading: gridLoading } = useTrackingGrid(courseId, selectedAssignmentId)
  const { data: viewingSnapshot } = useSnapshot(courseId, selectedAssignmentId, viewingSnapshotId)
  const saveMutation = useSaveTrackingScores(courseId, selectedAssignmentId)
  const commitMutation = useCommitSnapshot(courseId, selectedAssignmentId)

  // Default to the first assignment so the tracking page isn't blank on open.
  useEffect(() => {
    if (selectedAssignmentId === null && assignments && assignments.length > 0) {
      setSelectedAssignmentId(assignments[0].id)
    }
  }, [assignments, selectedAssignmentId])

  const dirtyRef = useRef(dirtyScores)
  dirtyRef.current = dirtyScores
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const pendingFlushRef = useRef(false)

  const flushScores = useCallback(async () => {
    if (saveInFlightRef.current) {
      pendingFlushRef.current = true
      await saveInFlightRef.current
      if (pendingFlushRef.current) {
        pendingFlushRef.current = false
        await flushScores()
      }
      return
    }

    const savedSnapshot = dirtyRef.current
    const entries = Object.entries(savedSnapshot).flatMap(([userId, cells]) =>
      Object.entries(cells).map(([criterionId, cell]) => ({
        user_id: Number(userId),
        criterion_id: criterionId,
        score: cell.score,
        comment: cell.comment,
      }))
    )
    if (entries.length === 0) return

    const savePromise = (async () => {
      await saveMutation.mutateAsync(entries)
      const nextDirtyScores = removeSavedTrackingScores(dirtyRef.current, savedSnapshot)
      dirtyRef.current = nextDirtyScores
      setDirtyScores(nextDirtyScores)
    })()

    saveInFlightRef.current = savePromise
    try {
      await savePromise
    } finally {
      saveInFlightRef.current = null
      if (pendingFlushRef.current && Object.keys(dirtyRef.current).length > 0) {
        pendingFlushRef.current = false
        void flushScores()
      }
    }
  }, [saveMutation])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const hasDirty = Object.keys(dirtyScores).length > 0
    if (!hasDirty) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      flushScores()
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [dirtyScores, flushScores])

  const displayScores: TrackingScores = (() => {
    const base = grid?.draft_snapshot?.scores ?? {}
    const merged: TrackingScores = {}
    const allUserIds = new Set([...Object.keys(base), ...Object.keys(dirtyScores)])
    for (const uid of allUserIds) {
      merged[uid] = { ...(base[uid] ?? {}), ...(dirtyScores[uid] ?? {}) }
    }
    return merged
  })()

  // The current value of a cell = dirty (unsaved) override, else the saved draft, else empty.
  const currentCell = useCallback((userId: number, criterionId: string): TrackingCell => {
    const uid = String(userId)
    const dirty = dirtyRef.current[uid]?.[criterionId]
    const base = grid?.draft_snapshot?.scores?.[uid]?.[criterionId]
    return dirty ?? base ?? { score: null, comment: null }
  }, [grid])

  const setCell = useCallback((userId: number, criterionId: string, cell: TrackingCell) => {
    setDirtyScores((prev) => {
      const next = {
        ...prev,
        [String(userId)]: {
          ...(prev[String(userId)] ?? {}),
          [criterionId]: cell,
        },
      }
      dirtyRef.current = next
      return next
    })
  }, [])

  const handleScoreChange = useCallback((userId: number, criterionId: string, score: number) => {
    setCell(userId, criterionId, { ...currentCell(userId, criterionId), score })
  }, [setCell, currentCell])

  const handleClearScore = useCallback((userId: number, criterionId: string) => {
    setCell(userId, criterionId, { ...currentCell(userId, criterionId), score: null })
  }, [setCell, currentCell])

  const handleCommentChange = useCallback((userId: number, criterionId: string, comment: string) => {
    setCell(userId, criterionId, { ...currentCell(userId, criterionId), comment: comment.trim() ? comment : null })
  }, [setCell, currentCell])

  const handleCommit = useCallback(async () => {
    if (Object.keys(dirtyRef.current).length > 0) {
      if (timerRef.current) clearTimeout(timerRef.current)
      await flushScores()
    }
    await commitMutation.mutateAsync(commitLabel || undefined)
    setCommitLabel('')
    setShowCommitDialog(false)
    setViewingSnapshotId(null)
  }, [flushScores, commitMutation, commitLabel])

  const handleAssignmentChange = useCallback((id: number | null) => {
    setSelectedAssignmentId(id)
    dirtyRef.current = {}
    setDirtyScores({})
    setShowCommitDialog(false)
    setViewingSnapshotId(null)
  }, [])

  const handleViewSnapshot = useCallback((id: number | null) => {
    setViewingSnapshotId(id)
    setShowCommitDialog(false)
  }, [])

  if (assignmentsLoading) {
    return <div className="text-sm text-slate-500 py-8 text-center">Loading assignments…</div>
  }

  if (!assignments || assignments.length === 0) {
    return (
      <div className="text-sm text-slate-500 py-8 text-center">
        No assignments with rubrics found. Sync the course to pull rubric data from Canvas.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
      <div className="relative z-[100] flex shrink-0 items-center gap-4 flex-wrap">
        <AssignmentPicker
          assignments={assignments}
          selectedId={selectedAssignmentId}
          onChange={handleAssignmentChange}
        />

        {selectedAssignmentId && grid && (
          <div className="flex items-center gap-2 ml-auto">
            {grid.committed_snapshots.length > 0 && (
              <SnapshotPicker
                snapshots={grid.committed_snapshots}
                viewingId={viewingSnapshotId}
                onChange={handleViewSnapshot}
              />
            )}
            {viewingSnapshotId !== null ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-500">
                Read-only
              </span>
            ) : (
              <button
                onClick={() => setShowCommitDialog(true)}
                disabled={commitMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Record Snapshot
              </button>
            )}
          </div>
        )}
      </div>

      {showCommitDialog && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <input
            type="text"
            placeholder="Optional label (e.g. Week 3 check-in)"
            value={commitLabel}
            onChange={(e) => setCommitLabel(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <button
            onClick={handleCommit}
            disabled={commitMutation.isPending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-40"
          >
            {commitMutation.isPending ? 'Recording…' : 'Confirm'}
          </button>
          <button
            onClick={() => setShowCommitDialog(false)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      )}

      {selectedAssignmentId && gridLoading && (
        <div className="shrink-0 border border-slate-200 rounded-xl overflow-hidden animate-pulse">
          <div className="h-10 bg-slate-100 border-b border-slate-200" />
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-10 border-b border-slate-100 bg-white" />
          ))}
        </div>
      )}

      {selectedAssignmentId && grid && (
        <div className="min-h-0 min-w-0 flex-1">
          <AssignmentTrackingTable
            criteria={grid.criteria}
            students={grid.students}
            scores={viewingSnapshotId !== null ? (viewingSnapshot?.scores ?? displayScores) : displayScores}
            onScoreChange={handleScoreChange}
            onClearScore={handleClearScore}
            onCommentChange={handleCommentChange}
            readOnly={viewingSnapshotId !== null}
          />
        </div>
      )}
    </div>
  )
}

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTrackableAssignments, useTrackingGrid, useSaveTrackingScores, useCommitSnapshot } from '../services/api'
import type { TrackingScores } from '../types'
import AssignmentTrackingTable from './AssignmentTrackingTable'

interface Props {
  courseId: number
}

const AUTO_SAVE_DELAY_MS = 800

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

export default function AssignmentTrackingTab({ courseId }: Props) {
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null)
  const [dirtyScores, setDirtyScores] = useState<TrackingScores>({})
  const [commitLabel, setCommitLabel] = useState('')
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: assignments, isLoading: assignmentsLoading } = useTrackableAssignments(courseId)
  const { data: grid, isLoading: gridLoading } = useTrackingGrid(courseId, selectedAssignmentId)
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

  const flushScores = useCallback(async () => {
    const current = dirtyRef.current
    const entries = Object.entries(current).flatMap(([userId, criteria]) =>
      Object.entries(criteria).map(([criterionId, score]) => ({
        user_id: Number(userId),
        criterion_id: criterionId,
        score,
      }))
    )
    if (entries.length === 0) return
    setSaving(true)
    try {
      await saveMutation.mutateAsync(entries)
      setDirtyScores({})
    } finally {
      setSaving(false)
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

  const handleScoreChange = useCallback((userId: number, criterionId: string, score: number) => {
    setDirtyScores((prev) => ({
      ...prev,
      [String(userId)]: {
        ...(prev[String(userId)] ?? {}),
        [criterionId]: score,
      },
    }))
  }, [])

  const handleCommit = useCallback(async () => {
    if (Object.keys(dirtyRef.current).length > 0) {
      if (timerRef.current) clearTimeout(timerRef.current)
      await flushScores()
    }
    await commitMutation.mutateAsync(commitLabel || undefined)
    setCommitLabel('')
    setShowCommitDialog(false)
  }, [flushScores, commitMutation, commitLabel])

  const handleAssignmentChange = useCallback((id: number | null) => {
    setSelectedAssignmentId(id)
    setDirtyScores({})
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
            <button
              onClick={() => setShowCommitDialog(true)}
              disabled={commitMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Record Snapshot
            </button>
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
        <>
          <div className="min-h-0 min-w-0 flex-1">
            <AssignmentTrackingTable
              criteria={grid.criteria}
              students={grid.students}
              scores={displayScores}
              onScoreChange={handleScoreChange}
            />
          </div>

          {grid.committed_snapshots.length > 0 && (
            <div className="shrink-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Snapshot History
              </h3>
              <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                {grid.committed_snapshots.map((snap) => (
                  <div key={snap.id} className="flex items-center gap-3 text-sm px-4 py-2.5">
                    <span className="text-slate-400 tabular-nums">
                      {new Date(snap.committed_at).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    {snap.label && <span className="font-medium text-slate-700">{snap.label}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

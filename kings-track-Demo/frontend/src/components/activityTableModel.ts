import type { AssignmentGroup, MatrixAssignment, StudentRow, SubmissionStatus } from '../types'

export type CanvasActivityViewMode = 'due'

export type CanvasActivityZoneKey = 'due_now' | 'future' | 'undated'

export interface CanvasActivityColumn extends MatrixAssignment {
  source_group_name: string
  source_group_order: number
  source_assignment_order: number
  due_sort_ms: number | null
}

export interface CanvasActivityZone {
  key: CanvasActivityZoneKey
  label: string
  count: number
}

export interface CanvasActivityView {
  mode: CanvasActivityViewMode
  columns: CanvasActivityColumn[]
  zones: CanvasActivityZone[]
  firstFutureIndex: number | null
  firstUndatedIndex: number | null
}

interface PrepareCanvasActivityViewOptions {
  mode?: CanvasActivityViewMode
  now?: Date
}

function parseDueSortMs(dueAt: string | null): number | null {
  if (!dueAt) return null
  const parsed = Date.parse(dueAt)
  return Number.isNaN(parsed) ? null : parsed
}

function compareSourceOrder(a: CanvasActivityColumn, b: CanvasActivityColumn): number {
  return (
    a.source_group_order - b.source_group_order ||
    a.source_assignment_order - b.source_assignment_order ||
    a.id - b.id
  )
}

function compareDueOrder(a: CanvasActivityColumn, b: CanvasActivityColumn): number {
  const aDue = a.due_sort_ms
  const bDue = b.due_sort_ms

  if (aDue === null && bDue === null) return compareSourceOrder(a, b)
  if (aDue === null) return 1
  if (bDue === null) return -1

  return aDue - bDue || compareSourceOrder(a, b)
}

function getStartOfTomorrow(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
}

function countsTowardDueNowCompletion(status: SubmissionStatus | undefined): boolean {
  return status !== undefined && status !== 'not_started'
}

export function buildCanvasActivityColumns(assignmentGroups: AssignmentGroup[]): CanvasActivityColumn[] {
  return assignmentGroups.flatMap((group, groupIndex) =>
    group.assignments.map((assignment, assignmentIndex) => ({
      ...assignment,
      source_group_name: group.name,
      source_group_order: groupIndex,
      source_assignment_order: assignmentIndex,
      due_sort_ms: parseDueSortMs(assignment.due_at),
    })),
  )
}

export function prepareCanvasActivityView(
  columns: CanvasActivityColumn[],
  options: PrepareCanvasActivityViewOptions = {},
): CanvasActivityView {
  const { mode = 'due', now = new Date() } = options

  switch (mode) {
    case 'due':
      break
    default:
      throw new Error(`Unsupported Canvas activity view mode: ${String(mode)}`)
  }

  const orderedColumns = [...columns].sort(compareDueOrder)
  const startOfTomorrow = getStartOfTomorrow(now)

  let dueNowCount = 0
  let futureCount = 0

  for (const column of orderedColumns) {
    if (column.due_sort_ms === null) continue
    if (column.due_sort_ms < startOfTomorrow) {
      dueNowCount += 1
    } else {
      futureCount += 1
    }
  }

  const undatedCount = orderedColumns.length - dueNowCount - futureCount
  const firstFutureIndex = futureCount > 0 ? dueNowCount : null
  const firstUndatedIndex = undatedCount > 0 ? dueNowCount + futureCount : null

  const zones: CanvasActivityZone[] = []
  if (dueNowCount > 0) zones.push({ key: 'due_now', label: 'Due now', count: dueNowCount })
  if (futureCount > 0) zones.push({ key: 'future', label: 'Future', count: futureCount })
  if (undatedCount > 0) zones.push({ key: 'undated', label: 'No due date', count: undatedCount })

  return {
    mode,
    columns: orderedColumns,
    zones,
    firstFutureIndex,
    firstUndatedIndex,
  }
}

export function getCanvasDueNowCount(view: CanvasActivityView): number {
  return view.zones.find(zone => zone.key === 'due_now')?.count ?? 0
}

export function getCanvasDueNowCompletionRate(
  student: StudentRow,
  columns: CanvasActivityColumn[],
  dueNowCount: number,
): number | null {
  if (dueNowCount === 0) return null

  let completedCount = 0
  for (const column of columns.slice(0, dueNowCount)) {
    const status = student.submissions[String(column.id)]?.status
    if (countsTowardDueNowCompletion(status)) {
      completedCount += 1
    }
  }

  return completedCount / dueNowCount
}

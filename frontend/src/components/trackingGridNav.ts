import { useCallback, type KeyboardEvent, type RefObject } from 'react'

// Keyboard navigation for the assignment tracking grid.
//
// The grid is rendered through the shared MatrixTable, which owns the visible row
// order (sorting/filtering). Rather than duplicate that ordering here, we navigate
// by querying the rendered cells via `data-row-id` / `data-col-id` attributes — the
// DOM order already equals the visible order. This keeps MatrixTable untouched.

export const NAV_CELL_ATTR = 'data-nav-cell'

function cellSelector(rowId: number | string, colId: string): string {
  return `[${NAV_CELL_ATTR}][data-row-id="${CSS.escape(String(rowId))}"][data-col-id="${CSS.escape(colId)}"]`
}

export function getNavCell(
  container: HTMLElement | null,
  rowId: number | string,
  colId: string,
): HTMLElement | null {
  return container?.querySelector<HTMLElement>(cellSelector(rowId, colId)) ?? null
}

function focusCell(container: HTMLElement | null, rowId: number | string, colId: string): boolean {
  const target = getNavCell(container, rowId, colId)
  if (!target) return false
  target.focus()
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return true
}

// Move up/down within a criterion column. The column's cells are returned by the
// DOM in visible (sorted/filtered) order, so we just step to the adjacent one.
function moveVertical(
  container: HTMLElement | null,
  colId: string,
  currentRowId: number | string,
  delta: 1 | -1,
): boolean {
  if (!container) return false
  const cells = Array.from(
    container.querySelectorAll<HTMLElement>(`[${NAV_CELL_ATTR}][data-col-id="${CSS.escape(colId)}"]`),
  )
  const idx = cells.findIndex((el) => el.dataset.rowId === String(currentRowId))
  const next = cells[idx + delta]
  if (!next) return false
  next.focus()
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return true
}

// Focus the first criterion of the next student down (used to wrap at end of a row).
function moveToNextRowStart(
  container: HTMLElement | null,
  criterionIds: string[],
  currentRowId: number | string,
): boolean {
  const firstColId = criterionIds[0]
  if (!firstColId) return false
  return moveVertical(container, firstColId, currentRowId, 1)
}

export interface CellKeyContext {
  studentId: number
  criterionId: string
  onScore: (score: number) => void
  onClear: () => void
  onOpenComment: () => void
}

export interface TrackingGridNav {
  handleCellKeyDown: (e: KeyboardEvent<HTMLElement>, ctx: CellKeyContext) => void
}

interface Options {
  containerRef: RefObject<HTMLElement>
  // Ordered criterion ids — used for left/right movement within a row.
  criterionIds: string[]
}

export function useTrackingGridNav({ containerRef, criterionIds }: Options): TrackingGridNav {
  const handleCellKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, ctx: CellKeyContext) => {
      const container = containerRef.current
      const colIndex = criterionIds.indexOf(ctx.criterionId)

      const moveHorizontal = (delta: 1 | -1) => {
        const nextColId = criterionIds[colIndex + delta]
        if (nextColId) focusCell(container, ctx.studentId, nextColId)
      }

      switch (e.key) {
        case '0':
        case '1':
        case '2':
        case '3': {
          e.preventDefault()
          ctx.onScore(Number(e.key))
          // Advance right to the next criterion; at the end of a row, wrap down to
          // the next student's first criterion for continuous entry.
          if (criterionIds[colIndex + 1]) {
            moveHorizontal(1)
          } else {
            moveToNextRowStart(container, criterionIds, ctx.studentId)
          }
          return
        }
        case 'Backspace':
        case 'Delete': {
          e.preventDefault()
          ctx.onClear()
          return
        }
        case 'ArrowRight': {
          e.preventDefault()
          moveHorizontal(1)
          return
        }
        case 'ArrowLeft': {
          e.preventDefault()
          moveHorizontal(-1)
          return
        }
        case 'ArrowDown': {
          e.preventDefault()
          moveVertical(container, ctx.criterionId, ctx.studentId, 1)
          return
        }
        case 'ArrowUp': {
          e.preventDefault()
          moveVertical(container, ctx.criterionId, ctx.studentId, -1)
          return
        }
        case 'Home': {
          e.preventDefault()
          const first = criterionIds[0]
          if (first) focusCell(container, ctx.studentId, first)
          return
        }
        case 'End': {
          e.preventDefault()
          const last = criterionIds[criterionIds.length - 1]
          if (last) focusCell(container, ctx.studentId, last)
          return
        }
        case 'c':
        case 'C':
        case 'Enter': {
          e.preventDefault()
          ctx.onOpenComment()
          return
        }
        default:
          break
      }
    },
    [containerRef, criterionIds],
  )

  return { handleCellKeyDown }
}

export { focusCell }

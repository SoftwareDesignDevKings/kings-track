import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import AssignmentTrackingTable from '../components/AssignmentTrackingTable'
import type { RubricCriterion, TrackingScores } from '../types'

// jsdom doesn't implement scrollIntoView; the nav controller calls it after moving.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const criteria: RubricCriterion[] = [
  { id: 'c1', description: 'Criterion 1', long_description: null, points: null, position: 0 },
  { id: 'c2', description: 'Criterion 2', long_description: null, points: null, position: 1 },
]

const students = [
  { id: 1, name: 'Alice', sortable_name: 'Alice' },
  { id: 2, name: 'Bob', sortable_name: 'Bob' },
]

function renderTable(overrides: Partial<React.ComponentProps<typeof AssignmentTrackingTable>> = {}) {
  const onScoreChange = vi.fn()
  const onClearScore = vi.fn()
  const onCommentChange = vi.fn()
  const scores: TrackingScores = overrides.scores ?? {}
  const utils = render(
    <AssignmentTrackingTable
      criteria={criteria}
      students={students}
      scores={scores}
      onScoreChange={onScoreChange}
      onClearScore={onClearScore}
      onCommentChange={onCommentChange}
      {...overrides}
    />,
  )
  const cell = (rowId: number, colId: string) =>
    utils.container.querySelector<HTMLElement>(
      `[data-nav-cell][data-row-id="${rowId}"][data-col-id="${colId}"]`,
    )!
  return { ...utils, cell, onScoreChange, onClearScore, onCommentChange }
}

describe('tracking grid keyboard entry', () => {
  it('sets a score on number key and advances focus right', () => {
    const { cell, onScoreChange } = renderTable()
    const start = cell(1, 'c1')
    start.focus()
    fireEvent.keyDown(start, { key: '2' })

    expect(onScoreChange).toHaveBeenCalledWith(1, 'c1', 2)
    expect(document.activeElement).toBe(cell(1, 'c2'))
  })

  it('clears a score on Backspace', () => {
    const scores: TrackingScores = { '1': { c1: { score: 3, comment: null } } }
    const { cell, onClearScore } = renderTable({ scores })
    const target = cell(1, 'c1')
    target.focus()
    fireEvent.keyDown(target, { key: 'Backspace' })

    expect(onClearScore).toHaveBeenCalledWith(1, 'c1')
  })

  it('moves focus down with ArrowDown following visible row order', () => {
    const { cell } = renderTable()
    const start = cell(1, 'c1')
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowDown' })

    expect(document.activeElement).toBe(cell(2, 'c1'))
  })

  it('moves focus left/right with arrow keys', () => {
    const { cell } = renderTable()
    const start = cell(1, 'c1')
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cell(1, 'c2'))

    fireEvent.keyDown(cell(1, 'c2'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cell(1, 'c1'))
  })

  it('clicking anywhere in a cell selects (focuses) it', () => {
    const { cell } = renderTable()
    const target = cell(2, 'c1')
    fireEvent.mouseDown(target)
    expect(document.activeElement).toBe(target)
  })

  it('clears the cell selection when clicking outside the table', () => {
    const { cell } = renderTable()
    const SELECTED = 'ring-2 ring-inset ring-brand-500'
    const target = cell(1, 'c1')
    fireEvent.mouseDown(target)
    expect(target.className).toContain(SELECTED)

    // Click somewhere outside the grid container.
    fireEvent.mouseDown(document.body)
    expect(cell(1, 'c1').className).not.toContain(SELECTED)
  })

  it('typing a number with nothing focused starts at the first cell', () => {
    const { cell, onScoreChange } = renderTable()
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document.body, { key: '3' })

    expect(onScoreChange).toHaveBeenCalledWith(1, 'c1', 3)
  })

  it('does not hijack arrow keys when no cell is focused (page can scroll)', () => {
    renderTable()
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })

    // Focus stays out of the grid so the browser's native scroll handles the arrow.
    expect(document.activeElement).toBe(document.body)
  })

  it('wraps to the next student first criterion when scoring the last cell in a row', () => {
    const { cell, onScoreChange } = renderTable()
    const last = cell(1, 'c2')
    last.focus()
    fireEvent.keyDown(last, { key: '1' })

    expect(onScoreChange).toHaveBeenCalledWith(1, 'c2', 1)
    expect(document.activeElement).toBe(cell(2, 'c1'))
  })

  it('stays put when scoring the very last cell of the grid', () => {
    const { cell, onScoreChange } = renderTable()
    const lastOfGrid = cell(2, 'c2')
    lastOfGrid.focus()
    fireEvent.keyDown(lastOfGrid, { key: '2' })

    expect(onScoreChange).toHaveBeenCalledWith(2, 'c2', 2)
    expect(document.activeElement).toBe(lastOfGrid)
  })
})

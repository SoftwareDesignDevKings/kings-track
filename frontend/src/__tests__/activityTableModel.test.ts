import { describe, expect, it } from 'vitest'

import {
  buildCanvasActivityColumns,
  getCanvasDueNowCompletionRate,
  getCanvasDueNowCount,
  prepareCanvasActivityView,
} from '../components/activityTableModel'
import type { AssignmentGroup, StudentRow } from '../types'

describe('activityTableModel', () => {
  it('preserves source grouping metadata when building canonical activity columns', () => {
    const groups: AssignmentGroup[] = [
      {
        name: 'Assignments',
        assignments: [
          { id: 10, name: 'Task 1', points_possible: 10, due_at: null },
        ],
      },
      {
        name: 'Quizzes',
        assignments: [
          { id: 11, name: 'Quiz 1', points_possible: 15, due_at: null },
        ],
      },
    ]

    const columns = buildCanvasActivityColumns(groups)

    expect(columns).toEqual([
      expect.objectContaining({
        id: 10,
        source_group_name: 'Assignments',
        source_group_order: 0,
        source_assignment_order: 0,
      }),
      expect.objectContaining({
        id: 11,
        source_group_name: 'Quizzes',
        source_group_order: 1,
        source_assignment_order: 0,
      }),
    ])
  })

  it('builds due mode from canonical columns without losing group context', () => {
    const now = new Date(2026, 3, 28, 12, 0, 0)

    const columns = buildCanvasActivityColumns([
      {
        name: 'Later Group',
        assignments: [
          { id: 20, name: 'Later Task', points_possible: 10, due_at: new Date(2026, 3, 30, 9, 0, 0).toISOString() },
        ],
      },
      {
        name: 'Mixed Group',
        assignments: [
          { id: 21, name: 'Today Task', points_possible: 10, due_at: new Date(2026, 3, 28, 18, 0, 0).toISOString() },
          { id: 22, name: 'Optional Task', points_possible: 10, due_at: null },
        ],
      },
    ])

    const view = prepareCanvasActivityView(columns, {
      mode: 'due',
      now,
    })

    expect(view.columns.map(column => column.id)).toEqual([21, 20, 22])
    expect(view.columns[0].source_group_name).toBe('Mixed Group')
    expect(view.columns[1].source_group_name).toBe('Later Group')
    expect(view.columns[2].source_group_name).toBe('Mixed Group')
    expect(view.zones).toEqual([
      { key: 'due_now', label: 'Due now', count: 1 },
      { key: 'future', label: 'Future', count: 1 },
      { key: 'undated', label: 'No due date', count: 1 },
    ])
    expect(view.firstFutureIndex).toBe(1)
    expect(view.firstUndatedIndex).toBe(2)
  })

  it('computes due-now completion from only the columns left of the red divider', () => {
    const now = new Date(2026, 3, 28, 12, 0, 0)

    const columns = buildCanvasActivityColumns([
      {
        name: 'Unit 1',
        assignments: [
          { id: 30, name: 'Past Task', points_possible: 10, due_at: new Date(2026, 3, 27, 9, 0, 0).toISOString() },
          { id: 31, name: 'Today Task', points_possible: 10, due_at: new Date(2026, 3, 28, 18, 0, 0).toISOString() },
          { id: 32, name: 'Future Task', points_possible: 10, due_at: new Date(2026, 3, 29, 9, 0, 0).toISOString() },
        ],
      },
    ])

    const student: StudentRow = {
      id: 1,
      name: 'Alice',
      sortable_name: 'Alice',
      submissions: {
        '30': { status: 'completed', score: 10, late: false, missing: false },
        '31': { status: 'not_started', score: null, late: false, missing: false },
        '32': { status: 'completed', score: 10, late: false, missing: false },
      },
      metrics: { completion_rate: 1, on_time_rate: 1, current_score: 90 },
    }

    const view = prepareCanvasActivityView(columns, { mode: 'due', now })

    expect(getCanvasDueNowCount(view)).toBe(2)
    expect(getCanvasDueNowCompletionRate(student, view.columns, getCanvasDueNowCount(view))).toBe(0.5)
  })
})

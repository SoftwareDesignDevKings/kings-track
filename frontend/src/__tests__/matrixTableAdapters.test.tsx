import { render } from '@testing-library/react'

import MatrixTable from '../components/MatrixTable'
import {
  buildCanvasMatrixTableModel,
  buildEdStemMatrixTableModel,
  buildGradeoReportMatrixTableModel,
} from '../components/matrixTableAdapters'
import type { CourseMatrix, EdStemMatrix, GradeoCourseReport } from '../types'

function makeCanvasMatrix(): CourseMatrix {
  return {
    course_id: 1,
    course_name: 'Canvas Course',
    course_code: 'CAN',
    assignment_groups: [
      {
        name: 'Tasks',
        assignments: [
          { id: 10, name: 'Task 1', points_possible: 10, due_at: '2026-04-27T09:00:00Z' },
          { id: 11, name: 'Task 2', points_possible: 5, due_at: '2026-04-27T09:00:00Z' },
        ],
      },
    ],
    students: [
      {
        id: 2,
        name: 'Bob Jones',
        sortable_name: 'Jones, Bob',
        submissions: {
          '10': { status: 'completed', score: 8, late: true, missing: false },
          '11': { status: 'not_started', score: null, late: false, missing: true },
        },
        metrics: { completion_rate: 0.5, on_time_rate: 0.5, current_score: 80 },
      },
      {
        id: 1,
        name: 'Alice Smith',
        sortable_name: 'Smith, Alice',
        submissions: {
          '10': { status: 'completed', score: 10, late: false, missing: false },
          '11': { status: 'completed', score: 5, late: false, missing: false },
        },
        metrics: { completion_rate: 1, on_time_rate: 1, current_score: 100 },
      },
    ],
  }
}

function makeGradeoReport(): GradeoCourseReport {
  return {
    mapped: true,
    exams: [
      {
        id: 'exam-1',
        name: 'Cycle 1',
        class_average: 7,
        syllabus_title: 'Enterprise Computing',
        syllabus_grade: '12',
        bands: [],
        outcomes: [],
        topics: [],
      },
    ],
    students: [
      {
        id: 1,
        name: 'Alice Smith',
        sortable_name: 'Smith, Alice',
        completion_rate: 1,
        results: {
          'exam-1': {
            status: 'scored',
            exam_mark: 9,
            marks_available: 10,
            class_average: 7,
            questions: [],
          },
        },
      },
    ],
  }
}

function makeEdStemMatrix(): EdStemMatrix {
  return {
    mapped: true,
    modules: [
      {
        name: 'Intro',
        lessons: [{ id: 1, title: 'SQL Basics', is_interactive: false }],
      },
    ],
    students: [
      {
        id: 1,
        name: 'Alice Smith',
        sortable_name: 'Smith, Alice',
        completion_rate: 1,
        progress: { '1': { status: 'completed', completed_at: null } },
      },
    ],
  }
}

describe('matrix table adapters', () => {
  it('normalizes Canvas late flags without surfacing missing as a table marker', () => {
    const model = buildCanvasMatrixTableModel(makeCanvasMatrix())
    const bob = model.rows.find(row => row.name === 'Bob Jones')

    expect(bob?.lateCount).toBe(1)
    expect(bob?.missingCount).toBeUndefined()
    expect(bob?.cells['10']?.flags?.late).toBe(true)
    expect(bob?.cells['11']?.flags?.missing).toBeUndefined()
    expect(model.legends.map(item => item.label)).toContain('Late')
    expect(model.legends.map(item => item.label)).not.toContain('Missing')
    expect(model.showToolbarSummary).toBe(false)
  })

  it('normalizes Canvas marks for marks mode', () => {
    const model = buildCanvasMatrixTableModel(makeCanvasMatrix())
    const bobTask = model.rows.find(row => row.name === 'Bob Jones')?.cells['10']

    expect(bobTask?.marks).toEqual({ earned: 8, available: 10, unit: 'pts' })
  })

  it('normalizes Gradeo exam marks', () => {
    const model = buildGradeoReportMatrixTableModel(makeGradeoReport())
    const aliceExam = model.rows[0].cells['exam-1']

    expect(model.supportsMarks).toBe(true)
    expect(aliceExam?.status).toBe('scored')
    expect(aliceExam?.marks).toEqual({ earned: 9, available: 10 })
    expect(model.rows[0].averageMarkPct).toBe(0.9)
  })

  it('keeps EdStem progress-only until marks exist', () => {
    const model = buildEdStemMatrixTableModel(makeEdStemMatrix())

    expect(model.supportsMarks).toBe(false)
    expect(model.rows[0].cells['1']?.marks).toBeUndefined()
  })

  it('sorts rendered rows by sortable_name by default', () => {
    render(<MatrixTable model={buildCanvasMatrixTableModel(makeCanvasMatrix())} />)
    const studentCells = Array.from(document.querySelectorAll('tbody td.sticky-col-1'))

    expect(studentCells.map(cell => cell.textContent)).toEqual(['Bob Jones', 'Alice Smith'])
  })
})

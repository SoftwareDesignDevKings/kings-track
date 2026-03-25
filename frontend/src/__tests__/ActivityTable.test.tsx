import { screen } from '@testing-library/react'
import { render } from '@testing-library/react'
import ActivityTable from '../components/ActivityTable'
import type { CourseMatrix } from '../types'

function makeMatrix(overrides: Partial<CourseMatrix> = {}): CourseMatrix {
  return {
    course_id: 1,
    course_name: 'Test Course',
    course_code: 'TC01',
    assignment_groups: [
      {
        name: 'Unit 1',
        assignments: [
          { id: 10, name: 'Task 1', points_possible: 10, due_at: null },
          { id: 11, name: 'Task 2', points_possible: 5, due_at: null },
        ],
      },
    ],
    students: [
      {
        id: 1,
        name: 'Alice',
        sortable_name: 'Alice',
        submissions: {
          '10': { status: 'completed', score: 10, late: false, missing: false },
          '11': { status: 'not_started', score: null, late: false, missing: false },
        },
        metrics: { completion_rate: 0.5, on_time_rate: 1.0, current_score: 85, current_grade: 'A' },
      },
    ],
    ...overrides,
  }
}

describe('ActivityTable', () => {
  it('shows empty state when students list is empty', () => {
    render(<ActivityTable matrix={makeMatrix({ students: [] })} />)
    expect(screen.getByText(/No students found/i)).toBeInTheDocument()
  })

  it('shows empty state when no assignments', () => {
    render(<ActivityTable matrix={makeMatrix({ assignment_groups: [] })} />)
    expect(screen.getByText(/No published assignments/i)).toBeInTheDocument()
  })

  it('renders student rows and assignment columns', () => {
    const matrix = makeMatrix({
      students: [
        { id: 1, name: 'Alice', sortable_name: 'Alice', submissions: { '10': { status: 'completed', score: 10, late: false, missing: false }, '11': { status: 'not_started', score: null, late: false, missing: false } }, metrics: { completion_rate: 0.5, on_time_rate: 1, current_score: 85, current_grade: 'A' } },
        { id: 2, name: 'Bob', sortable_name: 'Bob', submissions: { '10': { status: 'in_progress', score: null, late: false, missing: false }, '11': { status: 'not_started', score: null, late: false, missing: false } }, metrics: { completion_rate: 0, on_time_rate: 0, current_score: null, current_grade: null } },
      ],
    })
    render(<ActivityTable matrix={matrix} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('renders group header with correct colSpan', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Unit 1',
          assignments: [
            { id: 10, name: 'T1', points_possible: 10, due_at: null },
            { id: 11, name: 'T2', points_possible: 5, due_at: null },
            { id: 12, name: 'T3', points_possible: 5, due_at: null },
          ],
        },
      ],
      students: [
        { id: 1, name: 'Alice', sortable_name: 'Alice', submissions: { '10': { status: 'completed', score: 10, late: false, missing: false }, '11': { status: 'not_started', score: null, late: false, missing: false }, '12': { status: 'not_started', score: null, late: false, missing: false } }, metrics: { completion_rate: 0.33, on_time_rate: 1, current_score: null, current_grade: null } },
      ],
    })
    const { container } = render(<ActivityTable matrix={matrix} />)
    const groupHeader = Array.from(container.querySelectorAll('th')).find(
      th => th.textContent?.includes('Unit 1')
    )
    expect(groupHeader).toBeDefined()
    expect(groupHeader?.getAttribute('colspan')).toBe('3')
  })

  it('renders StatusBadge for completed submission', () => {
    const { container } = render(<ActivityTable matrix={makeMatrix()} />)
    // Completed badge has bg-emerald-400
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument()
  })
})

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import CourseDetail from '../pages/CourseDetail'
import { renderWithProviders } from './utils'
import type { CourseMatrix } from '../types'

vi.mock('../services/api', () => ({
  useCourseMatrix: vi.fn(),
  useSyncStatus: vi.fn(() => ({ data: { is_running: false, logs: [] } })),
  useTriggerSync: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ courseId: '9001' }) }
})

import { useCourseMatrix } from '../services/api'

const mockMatrix: CourseMatrix = {
  course_id: 9001,
  course_name: 'Software Engineering 2026',
  course_code: '11SENX',
  assignment_groups: [
    {
      name: 'Classwork - Unit 1',
      assignments: [
        { id: 101, name: 'Task 1', points_possible: 10, due_at: null },
        { id: 102, name: 'Task 2', points_possible: 10, due_at: null },
      ],
    },
  ],
  students: [
    {
      id: 1,
      name: 'Alice Smith',
      sortable_name: 'Smith, Alice',
      submissions: {
        '101': { status: 'completed', score: 9, late: false, missing: false },
        '102': { status: 'not_started', score: null, late: false, missing: false },
      },
      metrics: { completion_rate: 0.5, on_time_rate: 1.0, current_score: 90 },
    },
  ],
}

describe('CourseDetail', () => {
  it('shows loading skeleton while data is fetching', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: true, error: null, data: undefined } as any)
    renderWithProviders(<CourseDetail />)
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('shows error message when fetch fails', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: new Error('fail'), data: undefined } as any)
    renderWithProviders(<CourseDetail />)
    expect(screen.getByText(/Failed to load activity data/i)).toBeInTheDocument()
  })

  it('renders course name and code when loaded', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    renderWithProviders(<CourseDetail />)
    expect(screen.getByText('Software Engineering 2026')).toBeInTheDocument()
    // course_code appears in both breadcrumb and header
    expect(screen.getAllByText('11SENX').length).toBeGreaterThan(0)
  })

  it('shows student and assignment counts', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    renderWithProviders(<CourseDetail />)
    expect(screen.getByText('1')).toBeInTheDocument() // 1 student
    expect(screen.getByText('2')).toBeInTheDocument() // 2 assignments
  })

  it('switches to a placeholder tab on click', async () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    const user = userEvent.setup()
    renderWithProviders(<CourseDetail />)
    await user.click(screen.getByRole('button', { name: /Engagement/i }))
    expect(screen.getByText(/Engagement analytics coming soon/i)).toBeInTheDocument()
  })

  it('shows the activity table on the default activities tab', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    renderWithProviders(<CourseDetail />)
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
  })
})

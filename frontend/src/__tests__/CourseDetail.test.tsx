import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import CourseDetail from '../pages/CourseDetail'
import { renderWithProviders } from './utils'
import type { CourseMatrix } from '../types'

vi.mock('../services/api', () => ({
  useCourseMatrix: vi.fn(),
  useEdStemMatrix: vi.fn(),
  useSyncStatus: vi.fn(() => ({ data: { is_running: false, logs: [] } })),
  useTriggerSync: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCurrentUser: vi.fn(() => ({ data: { email: 'test@example.com', role: 'admin' } })),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ courseId: '9001' }) }
})

import { useCourseMatrix, useEdStemMatrix } from '../services/api'

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

const defaultEdStemMatrix = { mapped: false }

describe('CourseDetail', () => {
  beforeEach(() => {
    vi.mocked(useEdStemMatrix).mockReturnValue({ isLoading: false, error: null, data: defaultEdStemMatrix } as any)
  })

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

  it('EdStem tab does not have a "Soon" badge', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    renderWithProviders(<CourseDetail />)
    const edStemTab = screen.getByRole('button', { name: /^EdStem$/i })
    expect(edStemTab.querySelector('.bg-slate-100')).toBeNull()
  })

  it('shows loading skeleton on EdStem tab while loading', async () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useEdStemMatrix).mockReturnValue({ isLoading: true, error: null, data: undefined } as any)
    const user = userEvent.setup()
    renderWithProviders(<CourseDetail />)
    await user.click(screen.getByRole('button', { name: /^EdStem$/i }))
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('shows not-mapped placeholder on EdStem tab when course is not mapped', async () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useEdStemMatrix).mockReturnValue({ isLoading: false, error: null, data: { mapped: false } } as any)
    const user = userEvent.setup()
    renderWithProviders(<CourseDetail />)
    await user.click(screen.getByRole('button', { name: /^EdStem$/i }))
    expect(screen.getByText(/No EdStem course linked/i)).toBeInTheDocument()
  })

  it('shows EdStemLessonTable on EdStem tab when mapped', async () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useEdStemMatrix).mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        mapped: true,
        edstem_course_id: 28555,
        edstem_course_name: 'SE 2026',
        modules: [{ name: 'Module 1', lessons: [{ id: 1, title: 'SQL Basics', is_interactive: false }] }],
        students: [{ id: 1, name: 'Alice Smith', sortable_name: 'Smith, Alice', completion_rate: 0.5, progress: { '1': { status: 'completed', completed_at: null } } }],
      },
    } as any)
    const user = userEvent.setup()
    renderWithProviders(<CourseDetail />)
    await user.click(screen.getByRole('button', { name: /^EdStem$/i }))
    expect(screen.getByText('Module 1')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
  })
})

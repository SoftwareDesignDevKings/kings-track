import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import CourseDetail from '../pages/CourseDetail'
import { renderWithProviders } from './utils'
import type { CourseMatrix } from '../types'

vi.mock('../services/api', () => ({
  useCourseMatrix: vi.fn(),
  useEdStemMatrix: vi.fn(),
  useGradeoReport: vi.fn(),
  useGradeoTopicBands: vi.fn(),
  useSyncStatus: vi.fn(() => ({ data: { is_running: false, logs: [] } })),
  useTriggerSync: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCurrentUser: vi.fn(() => ({ data: { email: 'test@example.com', role: 'admin' } })),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ courseId: '9001' }) }
})

import { useCourseMatrix, useEdStemMatrix, useGradeoReport, useGradeoTopicBands } from '../services/api'

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
    vi.mocked(useGradeoReport).mockReturnValue({ isLoading: false, error: null, data: { mapped: false } } as any)
    vi.mocked(useGradeoTopicBands).mockReturnValue({ isLoading: false, error: null, data: { mapped: false } } as any)
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

  it('bases the header average completion on due-now activities only', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 28, 12, 0, 0))

    vi.mocked(useCourseMatrix).mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        ...mockMatrix,
        assignment_groups: [
          {
            name: 'Classwork - Unit 1',
            assignments: [
              { id: 101, name: 'Past Task', points_possible: 10, due_at: new Date(2026, 3, 27, 9).toISOString() },
              { id: 102, name: 'Today Task', points_possible: 10, due_at: new Date(2026, 3, 28, 18).toISOString() },
              { id: 103, name: 'Future Task', points_possible: 10, due_at: new Date(2026, 3, 29, 9).toISOString() },
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
              '103': { status: 'completed', score: 10, late: false, missing: false },
            },
            metrics: { completion_rate: 1, on_time_rate: 1.0, current_score: 90 },
          },
        ],
      },
    } as any)

    const { container } = renderWithProviders(<CourseDetail />)
    const label = screen.getByText('Avg completion')
    const value = label.previousElementSibling

    expect(value).toHaveTextContent('50%')
    expect(container).not.toHaveTextContent('100%')

    vi.useRealTimers()
  })

  it('shows the activity table on the default Canvas tab', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    renderWithProviders(<CourseDetail />)
    expect(screen.getByRole('button', { name: /^Canvas$/i })).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
  })

  it('renders course tabs in the requested order', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useEdStemMatrix).mockReturnValue({ isLoading: false, error: null, data: { mapped: true } } as any)
    vi.mocked(useGradeoReport).mockReturnValue({ isLoading: false, error: null, data: { mapped: true } } as any)
    renderWithProviders(<CourseDetail />)
    expect(
      ['Canvas', 'Gradeo', 'EdStem'].map(label =>
        screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') }),
      ).map(button => button.textContent?.trim())
    ).toEqual(['Canvas', 'Gradeo', 'EdStem'])
  })

  it('does not render unfinished tabs', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    renderWithProviders(<CourseDetail />)
    expect(screen.queryByRole('button', { name: /Engagement/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /At-Risk/i })).not.toBeInTheDocument()
  })

  it('does not render the EdStem tab when the course is not linked', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useEdStemMatrix).mockReturnValue({ isLoading: false, error: null, data: { mapped: false } } as any)
    renderWithProviders(<CourseDetail />)
    expect(screen.queryByRole('button', { name: /^EdStem$/i })).not.toBeInTheDocument()
  })

  it('does not render the Gradeo tab when the course is not linked', () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useGradeoReport).mockReturnValue({ isLoading: false, error: null, data: { mapped: false } } as any)
    vi.mocked(useGradeoTopicBands).mockReturnValue({ isLoading: false, error: null, data: { mapped: false } } as any)
    renderWithProviders(<CourseDetail />)
    expect(screen.queryByRole('button', { name: /^Gradeo$/i })).not.toBeInTheDocument()
  })

  it('shows loading skeleton on EdStem tab while loading', async () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useEdStemMatrix).mockReturnValue({ isLoading: true, error: null, data: { mapped: true } } as any)
    const user = userEvent.setup()
    renderWithProviders(<CourseDetail />)
    await user.click(screen.getByRole('button', { name: /^EdStem$/i }))
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
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

  it('shows the Gradeo report table when the course is mapped', async () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useGradeoReport).mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        mapped: true,
        gradeo_class_id: 'gradeo-class-1',
        gradeo_class_name: '12 encx_2026',
        last_imported_at: '2026-03-31T10:30:00Z',
        unmatched_students_count: 1,
        exams: [
          {
            id: 'marking-session-1',
            name: '12ENC_Cycle6',
            class_average: 1.6,
            syllabus_title: 'Enterprise Computing',
            syllabus_grade: '12',
            bands: ['3', '4'],
            outcomes: ['EC-12-04'],
            topics: ['Data Science'],
          },
        ],
        students: [
          {
            id: 1,
            name: 'Alice Smith',
            sortable_name: 'Smith, Alice',
            completion_rate: 1,
            results: {
              'marking-session-1': {
                status: 'scored',
                exam_mark: 9,
                marks_available: 10,
                class_average: 1.6,
                questions: [],
              },
            },
          },
          {
            id: 2,
            name: 'Noah Ould',
            sortable_name: 'Ould, Noah',
            completion_rate: null,
            results: {
              'marking-session-1': null,
            },
          },
        ],
      },
    } as any)
    const user = userEvent.setup()
    renderWithProviders(<CourseDetail />)
    await user.click(screen.getByRole('button', { name: /^Gradeo$/i }))
    expect(screen.getByRole('button', { name: /^Results$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Topic Bands$/i })).toBeInTheDocument()
    expect(screen.getByText('12ENC_Cycle6')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Noah Ould')).toBeInTheDocument()
    expect(screen.getByLabelText('12ENC_Cycle6: Not assigned')).toBeInTheDocument()
  })

  it('defaults to Topic Bands on the Gradeo tab when topic-band data exists', async () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useGradeoReport).mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        mapped: true,
        gradeo_class_id: 'gradeo-class-1',
        gradeo_class_name: '12 encx_2026',
        last_imported_at: '2026-03-31T10:30:00Z',
        unmatched_students_count: 0,
        exams: [],
        students: [],
      },
    } as any)
    vi.mocked(useGradeoTopicBands).mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        mapped: true,
        gradeo_class_id: 'gradeo-class-1',
        gradeo_class_name: '12 encx_2026',
        topics: [{ name: 'Data Science', student_count: 1, average_score_pct: 0.82 }],
        students: [
          {
            id: 1,
            name: 'Alice Smith',
            sortable_name: 'Smith, Alice',
            topics: {
              'Data Science': {
                score_pct: 0.82,
                predicted_band: 5,
                confidence: 'medium',
                earned_marks: 18,
                available_marks: 22,
                exam_count: 2,
                part_count: 7,
              },
            },
          },
        ],
      },
    } as any)

    const user = userEvent.setup()
    renderWithProviders(<CourseDetail />)
    await user.click(screen.getByRole('button', { name: /^Gradeo$/i }))
    expect(screen.getByText('B5')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getAllByText('medium').length).toBeGreaterThan(0)
  })

  it('switches from Topic Bands to Results inside the Gradeo tab', async () => {
    vi.mocked(useCourseMatrix).mockReturnValue({ isLoading: false, error: null, data: mockMatrix } as any)
    vi.mocked(useGradeoReport).mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        mapped: true,
        gradeo_class_id: 'gradeo-class-1',
        gradeo_class_name: '12 encx_2026',
        last_imported_at: '2026-03-31T10:30:00Z',
        unmatched_students_count: 0,
        exams: [
          {
            id: 'marking-session-1',
            name: '12ENC_Cycle6',
            class_average: 1.6,
            syllabus_title: 'Enterprise Computing',
            syllabus_grade: '12',
            bands: ['3', '4'],
            outcomes: ['EC-12-04'],
            topics: ['Data Science'],
          },
        ],
        students: [],
      },
    } as any)
    vi.mocked(useGradeoTopicBands).mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        mapped: true,
        gradeo_class_id: 'gradeo-class-1',
        gradeo_class_name: '12 encx_2026',
        topics: [{ name: 'Data Science', student_count: 1, average_score_pct: 0.82 }],
        students: [
          {
            id: 1,
            name: 'Alice Smith',
            sortable_name: 'Smith, Alice',
            topics: {
              'Data Science': {
                score_pct: 0.82,
                predicted_band: 5,
                confidence: 'medium',
                earned_marks: 18,
                available_marks: 22,
                exam_count: 2,
                part_count: 7,
              },
            },
          },
        ],
      },
    } as any)

    const user = userEvent.setup()
    renderWithProviders(<CourseDetail />)
    await user.click(screen.getByRole('button', { name: /^Gradeo$/i }))
    await user.click(screen.getByRole('button', { name: /^Results$/i }))
    expect(screen.getByText(/No students found/i)).toBeInTheDocument()
  })
})

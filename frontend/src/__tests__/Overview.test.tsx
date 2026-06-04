import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Overview from '../pages/Overview'
import { renderWithProviders } from './utils'

vi.mock('../services/api', () => ({
  useCourses: vi.fn(),
  useHealth: vi.fn(),
  useSyncStatus: vi.fn(() => ({ data: { is_running: false, logs: [] } })),
  useTriggerSync: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCurrentUser: vi.fn(() => ({ data: { email: 'test@example.com', role: 'admin' } })),
  useCanvasHealth: vi.fn(() => ({ data: undefined })),
}))

import { useCourses, useHealth } from '../services/api'

const mockCourse = {
  id: 1,
  name: 'Software Engineering 2026',
  course_code: '11SENX',
  workflow_state: 'available',
  last_synced: '2026-03-25T10:00:00Z',
  term_start_at: '2026-01-01T00:00:00Z',
  term_end_at: '2026-12-31T23:59:59Z',
  is_archived: false,
  student_count: 25,
  avg_completion_rate: 0.8,
  avg_on_time_rate: 0.9,
  avg_current_score: 85,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Overview', () => {
  it('shows SetupBanner when canvas_configured is false', () => {
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: false, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourses).mockReturnValue({ data: [], isLoading: false, error: null } as any)
    renderWithProviders(<Overview />)
    expect(screen.getByText(/Canvas API not configured/i)).toBeInTheDocument()
  })

  it('does not show SetupBanner when canvas_configured is true', () => {
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: true, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourses).mockReturnValue({ data: [], isLoading: false, error: null } as any)
    renderWithProviders(<Overview />)
    expect(screen.queryByText(/Canvas API not configured/i)).not.toBeInTheDocument()
  })

  it('renders loading skeletons when isLoading is true', () => {
    vi.mocked(useHealth).mockReturnValue({ data: undefined } as any)
    vi.mocked(useCourses).mockReturnValue({ data: undefined, isLoading: true, error: null } as any)
    const { container } = renderWithProviders(<Overview />)
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders CourseCards when courses are loaded', () => {
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: true, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourses).mockReturnValue({
      data: [mockCourse, { ...mockCourse, id: 2, name: 'SE Year 12' }],
      isLoading: false,
      error: null,
    } as any)
    renderWithProviders(<Overview />)
    expect(screen.getByText('Software Engineering 2026')).toBeInTheDocument()
    expect(screen.getByText('SE Year 12')).toBeInTheDocument()
  })

  it('does not show Archived when no courses are archived', () => {
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: true, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourses).mockReturnValue({
      data: [mockCourse],
      isLoading: false,
      error: null,
    } as any)
    renderWithProviders(<Overview />)
    expect(screen.queryByRole('heading', { name: 'Archived' })).not.toBeInTheDocument()
    expect(screen.getByText('1 course synced')).toBeInTheDocument()
  })

  it('shows archived courses below current courses and expands the section', async () => {
    const user = userEvent.setup()
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: true, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourses).mockReturnValue({
      data: [
        mockCourse,
        { ...mockCourse, id: 2, name: 'Ancient History 2025', is_archived: true },
      ],
      isLoading: false,
      error: null,
    } as any)

    renderWithProviders(<Overview />)

    expect(screen.getByText('Software Engineering 2026')).toBeInTheDocument()
    expect(screen.getByText('1 current, 1 archived')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeInTheDocument()
    expect(screen.queryByText('Ancient History 2025')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Expand archived courses' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)

    expect(screen.getByText('Ancient History 2025')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse archived courses' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows error message when API fails', () => {
    vi.mocked(useHealth).mockReturnValue({ data: undefined } as any)
    vi.mocked(useCourses).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    } as any)
    renderWithProviders(<Overview />)
    expect(screen.getByText(/Failed to load courses/i)).toBeInTheDocument()
  })
})

import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import Overview from '../pages/Overview'
import { renderWithProviders } from './utils'

vi.mock('../services/api', () => ({
  useCourses: vi.fn(),
  useHealth: vi.fn(),
  useSyncStatus: vi.fn(() => ({ data: { is_running: false, logs: [] } })),
  useTriggerSync: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

import { useCourses, useHealth } from '../services/api'

const mockCourse = {
  id: 1,
  name: 'Software Engineering 2026',
  course_code: '11SENX',
  workflow_state: 'available',
  last_synced: '2026-03-25T10:00:00Z',
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

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Overview from '../pages/Overview'
import { renderWithProviders } from './utils'

vi.mock('../services/api', () => ({
  useCourseGroups: vi.fn(),
  useHealth: vi.fn(),
  useSyncStatus: vi.fn(() => ({ data: { is_running: false, logs: [] } })),
  useTriggerSync: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCurrentUser: vi.fn(() => ({ data: { email: 'test@example.com', role: 'admin' } })),
  useCanvasHealth: vi.fn(() => ({ data: undefined })),
}))

import { useCourseGroups, useHealth } from '../services/api'

const mockGroup = {
  group_code: '11SEN',
  display_name: 'Year 11 Software Design & Engineering',
  is_archived: false,
  class_count: 2,
  total_students: 30,
  avg_completion_rate: 0.8,
  avg_on_time_rate: 0.9,
  avg_current_score: 85,
  last_synced: '2026-03-25T10:00:00Z',
  classes: [
    {
      id: 1,
      name: 'Year 11 Software Design & Engineering X',
      course_code: '11SENX',
      student_count: 15,
      avg_completion_rate: 0.82,
      avg_on_time_rate: 0.91,
      avg_current_score: 86,
      is_archived: false,
      last_synced: '2026-03-25T10:00:00Z',
    },
    {
      id: 2,
      name: 'Year 11 Software Design & Engineering Y',
      course_code: '11SENY',
      student_count: 15,
      avg_completion_rate: 0.78,
      avg_on_time_rate: 0.89,
      avg_current_score: 84,
      is_archived: false,
      last_synced: '2026-03-25T09:00:00Z',
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Overview', () => {
  it('shows SetupBanner when canvas_configured is false', () => {
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: false, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourseGroups).mockReturnValue({ data: [], isLoading: false, error: null } as any)
    renderWithProviders(<Overview />)
    expect(screen.getByText(/Canvas API not configured/i)).toBeInTheDocument()
  })

  it('does not show SetupBanner when canvas_configured is true', () => {
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: true, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourseGroups).mockReturnValue({ data: [], isLoading: false, error: null } as any)
    renderWithProviders(<Overview />)
    expect(screen.queryByText(/Canvas API not configured/i)).not.toBeInTheDocument()
  })

  it('renders loading skeletons when isLoading is true', () => {
    vi.mocked(useHealth).mockReturnValue({ data: undefined } as any)
    vi.mocked(useCourseGroups).mockReturnValue({ data: undefined, isLoading: true, error: null } as any)
    const { container } = renderWithProviders(<Overview />)
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders CourseGroupCards when groups are loaded', () => {
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: true, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourseGroups).mockReturnValue({
      data: [
        mockGroup,
        { ...mockGroup, group_code: '11ENC', display_name: 'Year 11 Enterprise Computing', classes: [{ ...mockGroup.classes[0], id: 3 }], class_count: 1 },
      ],
      isLoading: false,
      error: null,
    } as any)
    renderWithProviders(<Overview />)
    expect(screen.getByText('Year 11 Software Design & Engineering')).toBeInTheDocument()
    expect(screen.getByText('Year 11 Enterprise Computing')).toBeInTheDocument()
  })

  it('does not show Archived when no groups are archived', () => {
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: true, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourseGroups).mockReturnValue({
      data: [mockGroup],
      isLoading: false,
      error: null,
    } as any)
    renderWithProviders(<Overview />)
    expect(screen.queryByRole('heading', { name: 'Archived' })).not.toBeInTheDocument()
  })

  it('shows archived groups below current groups and expands the section', async () => {
    const user = userEvent.setup()
    vi.mocked(useHealth).mockReturnValue({ data: { canvas_configured: true, status: 'ok', integrations: [] } } as any)
    vi.mocked(useCourseGroups).mockReturnValue({
      data: [
        mockGroup,
        { ...mockGroup, group_code: '10HIS', display_name: 'Ancient History 2025', is_archived: true, classes: [{ ...mockGroup.classes[0], id: 4, is_archived: true }], class_count: 1 },
      ],
      isLoading: false,
      error: null,
    } as any)

    renderWithProviders(<Overview />)

    expect(screen.getByText('Year 11 Software Design & Engineering')).toBeInTheDocument()
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
    vi.mocked(useCourseGroups).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    } as any)
    renderWithProviders(<Overview />)
    expect(screen.getByText(/Failed to load courses/i)).toBeInTheDocument()
  })
})

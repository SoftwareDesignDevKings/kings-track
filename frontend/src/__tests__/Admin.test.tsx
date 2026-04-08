import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import Admin from '../pages/Admin'
import { renderWithProviders } from './utils'

vi.mock('../services/api', () => ({
  useAdminUsers: vi.fn(),
  useAddUser: vi.fn(),
  useRemoveUser: vi.fn(),
  useCourses: vi.fn(),
  useWhitelist: vi.fn(),
  useAvailableCourses: vi.fn(),
  useAddToWhitelist: vi.fn(),
  useRemoveFromWhitelist: vi.fn(),
  useSyncStatus: vi.fn(),
  useTriggerSync: vi.fn(),
  useEdStemMappings: vi.fn(),
  useEdStemAvailableCourses: vi.fn(),
  useCreateEdStemMapping: vi.fn(),
  useDeleteEdStemMapping: vi.fn(),
  useAutoMatchEdStem: vi.fn(),
  useGradeoStudentDirectoryStatus: vi.fn(),
  useGradeoClasses: vi.fn(),
  useGradeoMappings: vi.fn(),
  useCreateGradeoMapping: vi.fn(),
  useDeleteGradeoMapping: vi.fn(),
  useAutoMatchGradeo: vi.fn(),
  useHealth: vi.fn(),
  useCurrentUser: vi.fn(() => ({ data: { email: 'admin@example.com', role: 'admin' } })),
}))

import {
  useAdminUsers,
  useAddUser,
  useRemoveUser,
  useCourses,
  useWhitelist,
  useAvailableCourses,
  useAddToWhitelist,
  useRemoveFromWhitelist,
  useSyncStatus,
  useTriggerSync,
  useEdStemMappings,
  useEdStemAvailableCourses,
  useCreateEdStemMapping,
  useDeleteEdStemMapping,
  useAutoMatchEdStem,
  useGradeoStudentDirectoryStatus,
  useGradeoClasses,
  useGradeoMappings,
  useCreateGradeoMapping,
  useDeleteGradeoMapping,
  useAutoMatchGradeo,
  useHealth,
} from '../services/api'

const baseMutation = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
  data: undefined,
}

describe('Admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAdminUsers).mockReturnValue({ data: [], isLoading: false } as any)
    vi.mocked(useAddUser).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useRemoveUser).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useCourses).mockReturnValue({
      data: [
        {
          id: 1,
          name: 'Software Engineering 2026',
          course_code: '11SENX',
          workflow_state: 'available',
          last_synced: '2026-03-25T10:00:00Z',
          student_count: 25,
          avg_completion_rate: 0.8,
          avg_on_time_rate: 0.9,
          avg_current_score: 85,
        },
      ],
      isLoading: false,
    } as any)
    vi.mocked(useWhitelist).mockReturnValue({
      data: [
        { course_id: 1, name: 'Software Engineering 2026', course_code: '11SENX', added_at: null },
        { course_id: 2, name: 'Data Science 2026', course_code: '11DSCX', added_at: null },
      ],
      isLoading: false,
    } as any)
    vi.mocked(useAvailableCourses).mockReturnValue({ data: [], isLoading: false } as any)
    vi.mocked(useAddToWhitelist).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useRemoveFromWhitelist).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useSyncStatus).mockReturnValue({
      data: {
        is_running: false,
        progress: null,
        logs: [{ entity_type: 'full_sync', status: 'completed', completed_at: '2026-03-25T10:00:00Z', started_at: '2026-03-25T09:55:00Z', error_message: null }],
      },
    } as any)
    vi.mocked(useTriggerSync).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useEdStemMappings).mockReturnValue({
      data: [
        {
          canvas_course_id: 1,
          canvas_course_name: 'Software Engineering 2026',
          edstem_course_id: 28555,
          edstem_course_name: 'SE 2026',
          created_at: null,
        },
      ],
      isLoading: false,
    } as any)
    vi.mocked(useEdStemAvailableCourses).mockReturnValue({
      data: [
        { id: 28555, name: 'SE 2026', code: '11SENX' },
        { id: 29555, name: 'DS 2026', code: '11DSCX' },
      ],
      isLoading: false,
    } as any)
    vi.mocked(useCreateEdStemMapping).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useDeleteEdStemMapping).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useAutoMatchEdStem).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useGradeoStudentDirectoryStatus).mockReturnValue({
      data: { last_synced_at: '2026-03-31T09:00:00Z', matched_students: 48, stale: false },
    } as any)
    vi.mocked(useGradeoClasses).mockReturnValue({
      data: [
        {
          gradeo_class_id: 'gradeo-class-1',
          name: '12 encx_2026',
          discovered_at: '2026-03-31T09:00:00Z',
          last_seen_at: '2026-03-31T09:00:00Z',
          canvas_course_id: 1,
          canvas_course_name: 'Software Engineering 2026',
          canvas_course_code: '11SENX',
          last_imported_at: '2026-03-31T09:15:00Z',
          suggested_course: null,
          candidate_courses: [],
        },
      ],
      isLoading: false,
    } as any)
    vi.mocked(useGradeoMappings).mockReturnValue({
      data: [
        {
          canvas_course_id: 1,
          canvas_course_name: 'Software Engineering 2026',
          canvas_course_code: '11SENX',
          gradeo_class_id: 'gradeo-class-1',
          gradeo_class_name: '12 encx_2026',
          created_at: null,
        },
      ],
      isLoading: false,
    } as any)
    vi.mocked(useCreateGradeoMapping).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useDeleteGradeoMapping).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useAutoMatchGradeo).mockReturnValue({ ...baseMutation } as any)
    vi.mocked(useHealth).mockReturnValue({
      data: { status: 'ok', canvas_configured: true, edstem_configured: true },
    } as any)
  })

  it('shows sync progress and courses still left to sync in the data sync card', () => {
    renderWithProviders(<Admin />)

    expect(screen.getByText(/Sync coverage/i)).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 whitelisted courses have been synced into the dashboard/i)).toBeInTheDocument()
    expect(screen.getByText(/Still waiting on sync/i)).toBeInTheDocument()
    expect(screen.getByText(/Data Science 2026 · 11DSCX/i)).toBeInTheDocument()
    expect(screen.getByText(/1\/2 synced/i)).toBeInTheDocument()
  })

  it('shows live run progress instead of dashboard coverage while a sync is running', () => {
    vi.mocked(useSyncStatus).mockReturnValue({
      data: {
        is_running: true,
        progress: {
          sync_type: 'full',
          started_at: '2026-03-25T09:55:00Z',
          phase: 'Syncing course 2',
          current_course_id: 2,
          current_step: 'submissions',
          total_courses: 2,
          completed_courses: 1,
          pending_course_ids: [2],
          completed_course_ids: [1],
          total_steps: 9,
          completed_steps: 5,
          includes_edstem: false,
        },
        logs: [{ entity_type: 'full_sync', status: 'completed', completed_at: '2026-03-25T10:00:00Z', started_at: '2026-03-25T09:55:00Z', error_message: null }],
      },
    } as any)

    renderWithProviders(<Admin />)

    expect(screen.getByText(/Current sync progress/i)).toBeInTheDocument()
    expect(screen.getByText(/5 of 9 sync steps have finished in this run/i)).toBeInTheDocument()
    expect(screen.getByText(/4 left/i)).toBeInTheDocument()
    expect(screen.getByText(/Finished this run/i)).toBeInTheDocument()
    expect(screen.getByText(/Still queued in this run/i)).toBeInTheDocument()
    expect(screen.getByText(/Current step: submissions/i)).toBeInTheDocument()
  })

  it('shows the latest sync error when the most recent run failed', () => {
    vi.mocked(useSyncStatus).mockReturnValue({
      data: {
        is_running: false,
        progress: null,
        logs: [{ entity_type: 'full_sync', status: 'error', completed_at: '2026-03-25T10:00:00Z', started_at: '2026-03-25T09:55:00Z', error_message: 'Canvas timeout' }],
      },
    } as any)

    renderWithProviders(<Admin />)

    expect(screen.getByText(/Canvas timeout/i)).toBeInTheDocument()
  })

  it('shows the Gradeo student-directory status and linked classes', () => {
    renderWithProviders(<Admin />)

    expect(screen.getByText(/Gradeo Import Pipeline/i)).toBeInTheDocument()
    expect(screen.getByText(/Student directory status/i)).toBeInTheDocument()
    expect(screen.getByText('48')).toBeInTheDocument()
    expect(screen.getAllByText(/12 encx_2026/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: /Gradeo Class/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Last import/i })).toBeInTheDocument()
    expect(screen.queryByText(/Recent Gradeo runs/i)).not.toBeInTheDocument()
  })
})

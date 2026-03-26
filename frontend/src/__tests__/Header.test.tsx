import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Header from '../components/Header'
import { renderWithProviders } from './utils'

const mockMutate = vi.fn()

vi.mock('../services/api', () => ({
  useSyncStatus: vi.fn(),
  useTriggerSync: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
  useCurrentUser: vi.fn(() => ({ data: { email: 'test@example.com', role: 'admin' } })),
}))

import { useSyncStatus } from '../services/api'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-25T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Header', () => {
  it('shows "Syncing…" when is_running is true', () => {
    vi.mocked(useSyncStatus).mockReturnValue({ data: { is_running: true, logs: [] } } as any)
    renderWithProviders(<Header />)
    // "Syncing…" appears in both the status indicator and the button when running
    expect(screen.getAllByText('Syncing…').length).toBeGreaterThan(0)
  })

  it('shows last sync time when idle with a completed log', () => {
    vi.mocked(useSyncStatus).mockReturnValue({
      data: {
        is_running: false,
        logs: [{ status: 'completed', completed_at: '2026-03-25T11:55:00Z', entity_type: 'full_sync', course_id: null, records_synced: 0, started_at: null, error_message: null }],
      },
    } as any)
    renderWithProviders(<Header />)
    expect(screen.getByText(/Last sync: 5m ago/i)).toBeInTheDocument()
  })

  it('shows "Never" when there are no completed logs', () => {
    vi.mocked(useSyncStatus).mockReturnValue({ data: { is_running: false, logs: [] } } as any)
    renderWithProviders(<Header />)
    expect(screen.getByText(/Last sync: Never/i)).toBeInTheDocument()
  })

  it('disables Sync button when running', () => {
    vi.mocked(useSyncStatus).mockReturnValue({ data: { is_running: true, logs: [] } } as any)
    renderWithProviders(<Header />)
    expect(screen.getByRole('button', { name: /Syncing/i })).toBeDisabled()
  })

  it('calls mutate when Sync Now is clicked', async () => {
    vi.mocked(useSyncStatus).mockReturnValue({ data: { is_running: false, logs: [] } } as any)
    vi.useRealTimers()
    const user = userEvent.setup()
    renderWithProviders(<Header />)
    await user.click(screen.getByRole('button', { name: /Sync Now/i }))
    expect(mockMutate).toHaveBeenCalledTimes(1)
  })
})

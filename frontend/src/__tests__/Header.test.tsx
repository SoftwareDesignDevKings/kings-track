import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import Header from '../components/Header'
import { renderWithProviders } from './utils'

vi.mock('../services/api', () => ({
  useCurrentUser: vi.fn(() => ({ data: { email: 'test@example.com', role: 'admin' } })),
}))

describe('Header', () => {
  it('renders the logo and navigation', () => {
    renderWithProviders(<Header />)
    expect(screen.getByText('Kings Analytics')).toBeInTheDocument()
    expect(screen.getByText('Courses')).toBeInTheDocument()
  })

  it('shows Settings link for admin users', () => {
    renderWithProviders(<Header />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})

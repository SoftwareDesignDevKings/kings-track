import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import CourseCard from '../components/CourseCard'
import { renderWithProviders } from './utils'
import type { Course } from '../types'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const baseCourse: Course = {
  id: 123,
  name: 'Software Engineering 2026',
  course_code: '11SENX',
  workflow_state: 'available',
  last_synced: null,
  student_count: 25,
  avg_completion_rate: 0.8,
  avg_on_time_rate: 0.9,
  avg_current_score: 85,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-25T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CourseCard', () => {
  it('renders course name and code', () => {
    renderWithProviders(<CourseCard course={baseCourse} />)
    expect(screen.getByText('Software Engineering 2026')).toBeInTheDocument()
    expect(screen.getByText('11SENX')).toBeInTheDocument()
  })

  it('shows "Just now" for sub-minute last_synced', () => {
    const course = { ...baseCourse, last_synced: '2026-03-25T11:59:30Z' } // 30s ago
    renderWithProviders(<CourseCard course={course} />)
    expect(screen.getByText(/Synced Just now/i)).toBeInTheDocument()
  })

  it('shows Xm ago for recent sync', () => {
    const course = { ...baseCourse, last_synced: '2026-03-25T11:15:00Z' } // 45m ago
    renderWithProviders(<CourseCard course={course} />)
    expect(screen.getByText(/Synced 45m ago/i)).toBeInTheDocument()
  })

  it('shows Xh ago for same-day sync', () => {
    const course = { ...baseCourse, last_synced: '2026-03-25T09:00:00Z' } // 3h ago
    renderWithProviders(<CourseCard course={course} />)
    expect(screen.getByText(/Synced 3h ago/i)).toBeInTheDocument()
  })

  it('shows "Not synced" for null last_synced', () => {
    renderWithProviders(<CourseCard course={baseCourse} />)
    expect(screen.getByText(/Not synced/i)).toBeInTheDocument()
  })

  it('navigates to course on click', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderWithProviders(<CourseCard course={baseCourse} />)
    await user.click(screen.getByRole('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/courses/123')
  })
})

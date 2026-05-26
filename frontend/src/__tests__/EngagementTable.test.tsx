import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import EngagementTable from '../components/EngagementTable'
import { renderWithProviders } from './utils'
import type { CourseEngagementStudent } from '../types'

const makeStudent = (overrides: Partial<CourseEngagementStudent>): CourseEngagementStudent => ({
  id: 1,
  name: 'Alice Smith',
  sortable_name: 'Smith, Alice',
  page_views: 100,
  page_views_level: 2,
  max_page_views: 200,
  participations: 5,
  participations_level: 1,
  max_participations: 10,
  tardiness_on_time: 4,
  tardiness_late: 1,
  tardiness_missing: 0,
  total_activity_time_seconds: 3720,
  last_activity_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), // 3 days ago
  ...overrides,
})

const students: CourseEngagementStudent[] = [
  makeStudent({ id: 1, name: 'Alice Smith', sortable_name: 'Smith, Alice', page_views: 200, page_views_level: 3 }),
  makeStudent({ id: 2, name: 'Bob Jones', sortable_name: 'Jones, Bob', page_views: 50, page_views_level: 1 }),
  makeStudent({
    id: 3,
    name: 'Charlie Zero',
    sortable_name: 'Zero, Charlie',
    page_views: 0,
    page_views_level: 0,
    participations: 0,
    total_activity_time_seconds: 0,
    last_activity_at: null,
  }),
]

describe('EngagementTable', () => {
  it('renders all student rows', () => {
    renderWithProviders(<EngagementTable students={students} />)
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('Charlie Zero')).toBeInTheDocument()
  })

  it('shows the inactive students warning banner', () => {
    renderWithProviders(<EngagementTable students={students} />)
    // Charlie has no activity and no last_activity_at → inactive
    expect(screen.getByText(/student.* with no activity/i)).toBeInTheDocument()
  })

  it('displays "Never" for students with no last_activity_at', () => {
    renderWithProviders(<EngagementTable students={students} />)
    expect(screen.getByText('Never')).toBeInTheDocument()
  })

  it('formats total_activity_time_seconds as hours and minutes', () => {
    renderWithProviders(<EngagementTable students={[makeStudent({ total_activity_time_seconds: 3720 })]} />)
    expect(screen.getByText('1h 2m')).toBeInTheDocument()
  })

  it('shows — for null total_activity_time_seconds', () => {
    renderWithProviders(<EngagementTable students={[makeStudent({ total_activity_time_seconds: null })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('sorts by page views descending by default', () => {
    renderWithProviders(<EngagementTable students={students} />)
    const rows = screen.getAllByRole('row').slice(1) // skip header
    // Alice has 200, Bob 50, Charlie 0 — default sort desc
    expect(rows[0]).toHaveTextContent('Alice Smith')
    expect(rows[1]).toHaveTextContent('Bob Jones')
    expect(rows[2]).toHaveTextContent('Charlie Zero')
  })

  it('reverses sort order on second click of the same column', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EngagementTable students={students} />)
    // First click: already desc by default → clicking again should go asc
    await user.click(screen.getByText(/Page views/i))
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Charlie Zero')
    expect(rows[2]).toHaveTextContent('Alice Smith')
  })

  it('sorts alphabetically when Name column is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EngagementTable students={students} />)
    await user.click(screen.getByText(/^Student$/i))
    const rows = screen.getAllByRole('row').slice(1)
    // desc by sortable_name: Zero, Charlie → Smith, Alice → Jones, Bob
    expect(rows[0]).toHaveTextContent('Charlie Zero')
    expect(rows[2]).toHaveTextContent('Bob Jones')
  })

  it('does not show the inactive banner when all students are active', () => {
    const activeStudents = [
      makeStudent({ id: 1, name: 'Alice Smith', page_views: 50, last_activity_at: new Date().toISOString() }),
    ]
    renderWithProviders(<EngagementTable students={activeStudents} />)
    expect(screen.queryByText(/with no activity/i)).not.toBeInTheDocument()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ActivityTable from '../components/ActivityTable'
import type { CourseMatrix } from '../types'

function makeMatrix(overrides: Partial<CourseMatrix> = {}): CourseMatrix {
  return {
    course_id: 1,
    course_name: 'Test Course',
    course_code: 'TC01',
    assignment_groups: [
      {
        name: 'Unit 1',
        assignments: [
          { id: 10, name: 'Task 1', points_possible: 10, due_at: null },
          { id: 11, name: 'Task 2', points_possible: 5, due_at: null },
        ],
      },
    ],
    students: [
      {
        id: 1,
        name: 'Alice',
        sortable_name: 'Alice',
        submissions: {
          '10': { status: 'completed', score: 10, late: false, missing: false },
          '11': { status: 'not_started', score: null, late: false, missing: false },
        },
        metrics: { completion_rate: 0.5, on_time_rate: 1.0, current_score: 85 },
      },
    ],
    ...overrides,
  }
}

describe('ActivityTable', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 28, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows empty state when students list is empty', () => {
    render(<ActivityTable matrix={makeMatrix({ students: [] })} />)
    expect(screen.getByText(/No students found/i)).toBeInTheDocument()
  })

  it('shows empty state when no assignments', () => {
    render(<ActivityTable matrix={makeMatrix({ assignment_groups: [] })} />)
    expect(screen.getByText(/No published assignments/i)).toBeInTheDocument()
  })

  it('renders student rows and timeline zone headers', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Unit 1',
          assignments: [
            { id: 10, name: 'Task 1', points_possible: 10, due_at: new Date(2026, 3, 28, 9).toISOString() },
            { id: 11, name: 'Task 2', points_possible: 5, due_at: new Date(2026, 3, 29, 9).toISOString() },
          ],
        },
      ],
      students: [
        { id: 1, name: 'Alice', sortable_name: 'Alice', submissions: { '10': { status: 'completed', score: 10, late: false, missing: false }, '11': { status: 'not_started', score: null, late: false, missing: false } }, metrics: { completion_rate: 0.5, on_time_rate: 1, current_score: 85 } },
        { id: 2, name: 'Bob', sortable_name: 'Bob', submissions: { '10': { status: 'in_progress', score: null, late: false, missing: false }, '11': { status: 'not_started', score: null, late: false, missing: false } }, metrics: { completion_rate: 0, on_time_rate: 0, current_score: null } },
      ],
    })

    render(<ActivityTable matrix={matrix} />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getAllByText('Due now').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Future').length).toBeGreaterThan(0)
  })

  it('derives the completion column from due-now activities instead of the stored course metric', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Unit 1',
          assignments: [
            { id: 10, name: 'Past Task', points_possible: 10, due_at: new Date(2026, 3, 27, 9).toISOString() },
            { id: 11, name: 'Today Task', points_possible: 10, due_at: new Date(2026, 3, 28, 18).toISOString() },
            { id: 12, name: 'Future Task', points_possible: 10, due_at: new Date(2026, 3, 29, 9).toISOString() },
          ],
        },
      ],
      students: [
        {
          id: 1,
          name: 'Alice',
          sortable_name: 'Alice',
          submissions: {
            '10': { status: 'completed', score: 10, late: false, missing: false },
            '11': { status: 'not_started', score: null, late: false, missing: false },
            '12': { status: 'completed', score: 10, late: false, missing: false },
          },
          metrics: { completion_rate: 1, on_time_rate: 1, current_score: 85 },
        },
      ],
    })

    const { container } = render(<ActivityTable matrix={matrix} />)
    const completionCell = container.querySelector('tbody tr td.sticky-col-2')

    expect(completionCell).toHaveTextContent('50%')
    expect(completionCell).not.toHaveTextContent('100%')
  })

  it('shows a dash in the completion column when there are no due-now activities', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Unit 1',
          assignments: [
            { id: 10, name: 'Future Task', points_possible: 10, due_at: new Date(2026, 3, 29, 9).toISOString() },
            { id: 11, name: 'Optional Task', points_possible: 5, due_at: null },
          ],
        },
      ],
      students: [
        {
          id: 1,
          name: 'Alice',
          sortable_name: 'Alice',
          submissions: {
            '10': { status: 'completed', score: 10, late: false, missing: false },
            '11': { status: 'completed', score: 5, late: false, missing: false },
          },
          metrics: { completion_rate: 1, on_time_rate: 1, current_score: 85 },
        },
      ],
    })

    const { container } = render(<ActivityTable matrix={matrix} />)
    const completionCell = container.querySelector('tbody tr td.sticky-col-2')

    expect(completionCell).toHaveTextContent('—')
  })

  it('sorts activities globally by due date across source groups', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Later Group',
          assignments: [
            { id: 21, name: 'Beta Task', points_possible: 10, due_at: new Date(2026, 3, 30, 9).toISOString() },
          ],
        },
        {
          name: 'Earlier Group',
          assignments: [
            { id: 22, name: 'Alpha Task', points_possible: 10, due_at: new Date(2026, 3, 28, 9).toISOString() },
            { id: 23, name: 'Gamma Task', points_possible: 10, due_at: new Date(2026, 4, 1, 9).toISOString() },
          ],
        },
      ],
    })

    const { container } = render(<ActivityTable matrix={matrix} />)
    const activityHeaders = Array.from(container.querySelectorAll('thead tr:nth-child(2) th'))

    expect(activityHeaders.map(header => header.getAttribute('title'))).toEqual([
      expect.stringContaining('Alpha Task'),
      expect.stringContaining('Beta Task'),
      expect.stringContaining('Gamma Task'),
    ])
  })

  it('places the main divider before the first future item and a secondary divider before undated items', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Unit 1',
          assignments: [
            { id: 30, name: 'Past Task', points_possible: 10, due_at: new Date(2026, 3, 27, 9).toISOString() },
            { id: 31, name: 'Today Task', points_possible: 10, due_at: new Date(2026, 3, 28, 18).toISOString() },
            { id: 32, name: 'Future Task', points_possible: 10, due_at: new Date(2026, 3, 29, 9).toISOString() },
            { id: 33, name: 'Optional Task', points_possible: 10, due_at: null },
          ],
        },
      ],
    })

    const { container } = render(<ActivityTable matrix={matrix} />)
    const activityHeaders = Array.from(container.querySelectorAll('thead tr:nth-child(2) th'))

    expect(screen.getAllByText('No due date').length).toBeGreaterThan(0)
    expect(activityHeaders[1].className).toContain('timeline-divider-primary-end')
    expect(activityHeaders[2].className).toContain('timeline-divider-primary-start')
    expect(activityHeaders[3].className).not.toContain('timeline-divider')
  })

  it('preserves source group metadata in the activity tooltip', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Quizzes',
          assignments: [
            { id: 40, name: 'Quiz 1', points_possible: 15, due_at: new Date(2026, 3, 29, 9).toISOString() },
          ],
        },
      ],
    })

    const { container } = render(<ActivityTable matrix={matrix} />)
    const activityHeader = container.querySelector('thead tr:nth-child(2) th')

    expect(activityHeader).toHaveAttribute('data-group-name', 'Quizzes')
    expect(activityHeader).toHaveAttribute('title', expect.stringContaining('Group: Quizzes'))
    expect(activityHeader).toHaveAttribute('title', expect.stringContaining('Quiz 1'))
  })

  it('renders StatusBadge for completed submission', () => {
    const { container } = render(<ActivityTable matrix={makeMatrix()} />)
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument()
  })

  it('keeps due zone labels aligned to their visible sections while horizontally scrolling', () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(callback => {
        callback(0)
        return 1
      })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Unit 1',
          assignments: [
            { id: 50, name: 'Today Task', points_possible: 10, due_at: new Date(2026, 3, 28, 18).toISOString() },
            { id: 51, name: 'Future Task', points_possible: 10, due_at: new Date(2026, 3, 29, 9).toISOString() },
            { id: 52, name: 'Optional Task', points_possible: 10, due_at: null },
          ],
        },
      ],
    })

    const { container } = render(<ActivityTable matrix={matrix} />)
    const scrollEl = container.querySelector('.activity-table-scroll') as HTMLDivElement | null
    const stickyBoundary = container.querySelector('.sticky-col-header-2') as HTMLTableCellElement | null
    const zoneHeaders = Array.from(container.querySelectorAll('thead tr:first-child th[aria-label]')) as HTMLTableCellElement[]

    expect(scrollEl).not.toBeNull()
    expect(stickyBoundary).not.toBeNull()
    expect(zoneHeaders).toHaveLength(3)

    Object.defineProperty(scrollEl!, 'clientWidth', {
      configurable: true,
      value: 720,
    })
    Object.defineProperty(scrollEl!, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: 20,
    })

    scrollEl!.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 720, 37))
    stickyBoundary!.getBoundingClientRect = vi.fn(() => new DOMRect(220, 0, 130, 37))
    zoneHeaders[0].getBoundingClientRect = vi.fn(() => new DOMRect(370, 0, 90, 37))
    zoneHeaders[1].getBoundingClientRect = vi.fn(() => new DOMRect(480, 0, 110, 37))
    zoneHeaders[2].getBoundingClientRect = vi.fn(() => new DOMRect(600, 0, 120, 37))

    fireEvent(window, new Event('resize'))
    fireEvent.scroll(scrollEl!)

    const dueNowWindow = container.querySelector('[data-zone-key="due_now"]') as HTMLDivElement | null
    const futureWindow = container.querySelector('[data-zone-key="future"]') as HTMLDivElement | null
    const undatedWindow = container.querySelector('[data-zone-key="undated"]') as HTMLDivElement | null

    expect(requestAnimationFrameSpy).toHaveBeenCalled()
    expect(dueNowWindow).toHaveTextContent('Due now')
    expect(futureWindow).toHaveTextContent('Future')
    expect(undatedWindow).toHaveTextContent('No due date')
    expect(dueNowWindow?.style.transform).toBe('translate3d(370px, 0, 0)')
    expect(futureWindow?.style.transform).toBe('translate3d(480px, 0, 0)')
    expect(undatedWindow?.style.transform).toBe('translate3d(600px, 0, 0)')
    expect(dueNowWindow?.style.width).toBe('90px')
    expect(futureWindow?.style.width).toBe('110px')
    expect(undatedWindow?.style.width).toBe('120px')
  })
})

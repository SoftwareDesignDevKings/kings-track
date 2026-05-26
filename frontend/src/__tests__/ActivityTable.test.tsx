import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

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

function setScrollGeometry(
  element: HTMLDivElement,
  geometry: {
    clientWidth: number
    scrollWidth: number
    clientHeight: number
    scrollHeight: number
    scrollLeft?: number
    scrollTop?: number
  },
) {
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: geometry.clientWidth,
  })
  Object.defineProperty(element, 'scrollWidth', {
    configurable: true,
    value: geometry.scrollWidth,
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: geometry.clientHeight,
  })
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: geometry.scrollHeight,
  })
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    writable: true,
    value: geometry.scrollLeft ?? 0,
  })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    writable: true,
    value: geometry.scrollTop ?? 0,
  })
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

  it('renders custom matrix scrollbars only when table content overflows', () => {
    const { container } = render(<ActivityTable matrix={makeMatrix()} />)
    const scrollEl = container.querySelector('.activity-table-scroll') as HTMLDivElement | null

    expect(scrollEl).not.toBeNull()
    setScrollGeometry(scrollEl!, {
      clientWidth: 320,
      scrollWidth: 320,
      clientHeight: 180,
      scrollHeight: 180,
    })

    fireEvent(window, new Event('resize'))

    expect(container.querySelector('[data-testid="matrix-scrollbar-horizontal"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="matrix-scrollbar-vertical"]')).not.toBeInTheDocument()
  })

  it('syncs custom matrix scrollbar thumbs with native scroll position', () => {
    const { container } = render(<ActivityTable matrix={makeMatrix()} />)
    const scrollEl = container.querySelector('.activity-table-scroll') as HTMLDivElement | null

    expect(scrollEl).not.toBeNull()
    setScrollGeometry(scrollEl!, {
      clientWidth: 200,
      scrollWidth: 1000,
      clientHeight: 100,
      scrollHeight: 400,
    })

    fireEvent(window, new Event('resize'))

    const horizontalThumb = container.querySelector('[data-testid="matrix-scrollbar-horizontal-thumb"]') as HTMLDivElement | null
    const verticalThumb = container.querySelector('[data-testid="matrix-scrollbar-vertical-thumb"]') as HTMLDivElement | null
    const horizontalTrack = container.querySelector('[data-testid="matrix-scrollbar-horizontal"]') as HTMLDivElement | null
    const verticalTrack = container.querySelector('[data-testid="matrix-scrollbar-vertical"]') as HTMLDivElement | null

    expect(horizontalThumb).not.toBeNull()
    expect(verticalThumb).not.toBeNull()
    expect(Number.parseFloat(horizontalThumb!.style.width)).toBeGreaterThanOrEqual(32)
    expect(Number.parseFloat(verticalThumb!.style.height)).toBeGreaterThanOrEqual(32)

    scrollEl!.scrollLeft = 400
    fireEvent.scroll(scrollEl!)

    expect(horizontalTrack).toHaveClass('activity-table-scrollbar-visible')
    expect(verticalTrack).not.toHaveClass('activity-table-scrollbar-visible')
    expect(horizontalThumb!.style.transform).toBe('translate3d(78px, 0, 0)')

    act(() => {
      vi.advanceTimersByTime(800)
    })

    expect(horizontalTrack).not.toHaveClass('activity-table-scrollbar-visible')

    scrollEl!.scrollTop = 150
    fireEvent.scroll(scrollEl!)

    expect(horizontalTrack).not.toHaveClass('activity-table-scrollbar-visible')
    expect(verticalTrack).toHaveClass('activity-table-scrollbar-visible')
    expect(verticalThumb!.style.transform).toBe('translate3d(0, 32px, 0)')

    act(() => {
      vi.advanceTimersByTime(800)
    })

    expect(verticalTrack).not.toHaveClass('activity-table-scrollbar-visible')
  })

  it('reveals the respective custom matrix scrollbar when the pointer is near its edge', () => {
    const { container } = render(<ActivityTable matrix={makeMatrix()} />)
    const scrollEl = container.querySelector('.activity-table-scroll') as HTMLDivElement | null
    const scrollFrame = container.querySelector('.activity-table-scroll-frame') as HTMLDivElement | null

    expect(scrollEl).not.toBeNull()
    expect(scrollFrame).not.toBeNull()
    setScrollGeometry(scrollEl!, {
      clientWidth: 200,
      scrollWidth: 1000,
      clientHeight: 100,
      scrollHeight: 400,
    })

    fireEvent(window, new Event('resize'))

    const horizontalTrack = container.querySelector('[data-testid="matrix-scrollbar-horizontal"]') as HTMLDivElement | null
    const verticalTrack = container.querySelector('[data-testid="matrix-scrollbar-vertical"]') as HTMLDivElement | null

    expect(horizontalTrack).not.toBeNull()
    expect(verticalTrack).not.toBeNull()

    scrollFrame!.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 200, 100))

    fireEvent.mouseMove(scrollFrame!, { clientX: 100, clientY: 94 })
    expect(horizontalTrack).toHaveClass('activity-table-scrollbar-visible')
    expect(verticalTrack).not.toHaveClass('activity-table-scrollbar-visible')

    act(() => {
      vi.advanceTimersByTime(800)
    })

    fireEvent.mouseMove(scrollFrame!, { clientX: 194, clientY: 50 })
    expect(horizontalTrack).not.toHaveClass('activity-table-scrollbar-visible')
    expect(verticalTrack).toHaveClass('activity-table-scrollbar-visible')
  })

  it('updates native matrix scroll position when dragging a custom thumb', () => {
    const { container } = render(<ActivityTable matrix={makeMatrix()} />)
    const scrollEl = container.querySelector('.activity-table-scroll') as HTMLDivElement | null

    expect(scrollEl).not.toBeNull()
    setScrollGeometry(scrollEl!, {
      clientWidth: 200,
      scrollWidth: 1000,
      clientHeight: 100,
      scrollHeight: 100,
    })

    fireEvent(window, new Event('resize'))

    const horizontalTrack = container.querySelector('[data-testid="matrix-scrollbar-horizontal"]') as HTMLDivElement | null
    const horizontalThumb = container.querySelector('[data-testid="matrix-scrollbar-horizontal-thumb"]') as HTMLDivElement | null

    expect(horizontalTrack).not.toBeNull()
    expect(horizontalThumb).not.toBeNull()

    horizontalTrack!.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 200, 6))

    fireEvent.mouseDown(horizontalThumb!, { clientX: 10 })
    fireEvent.mouseMove(document, { clientX: 60 })
    fireEvent.mouseUp(document)

    expect(scrollEl!.scrollLeft).toBeGreaterThan(0)
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
    const groupHeaders = Array.from(container.querySelectorAll('thead tr:first-child th')).slice(2)
    const activityHeaders = Array.from(container.querySelectorAll('thead tr:nth-child(2) th'))

    expect(screen.getAllByText('No due date').length).toBeGreaterThan(0)
    expect(groupHeaders[0].className).toContain('timeline-divider-primary-end')
    expect(groupHeaders[1].className).toContain('timeline-divider-primary-start')
    expect(activityHeaders[1].className).toContain('timeline-divider-primary-end')
    expect(activityHeaders[2].className).toContain('timeline-divider-primary-start')
    expect(activityHeaders[3].className).not.toContain('timeline-divider')
  })

  it('does not draw the future boundary when due-now activities are followed only by no-due-date activities', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Unit 1',
          assignments: [
            { id: 34, name: 'Today Task', points_possible: 10, due_at: new Date(2026, 3, 28, 18).toISOString() },
            { id: 35, name: 'Optional Task', points_possible: 10, due_at: null },
          ],
        },
      ],
    })

    const { container } = render(<ActivityTable matrix={matrix} />)
    const groupHeaders = Array.from(container.querySelectorAll('thead tr:first-child th')).slice(2)
    const activityHeaders = Array.from(container.querySelectorAll('thead tr:nth-child(2) th'))

    expect(screen.getAllByText('Due now').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No due date').length).toBeGreaterThan(0)
    expect(screen.queryByText('Future')).not.toBeInTheDocument()
    expect(groupHeaders.every(header => !header.className.includes('timeline-divider'))).toBe(true)
    expect(activityHeaders.every(header => !header.className.includes('timeline-divider'))).toBe(true)
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
    const activityHeader = container.querySelector('thead th[data-group-name]')

    expect(activityHeader).toHaveAttribute('data-group-name', 'Quizzes')
    expect(activityHeader).toHaveAttribute('title', expect.stringContaining('Group: Quizzes'))
    expect(activityHeader).toHaveAttribute('title', expect.stringContaining('Quiz 1'))
  })

  it('renders StatusBadge for completed submission', () => {
    const { container } = render(<ActivityTable matrix={makeMatrix()} />)
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument()
  })

  it('renders the shared dashboard toolbar and due-date groups', () => {
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

    render(<ActivityTable matrix={matrix} />)

    expect(screen.queryByText('Canvas Tasks')).not.toBeInTheDocument()
    expect(screen.queryByText('1/1 students')).not.toBeInTheDocument()
    const searchButton = screen.getByRole('button', { name: /^Search students$/i })
    const sortButton = screen.getByRole('button', { name: /^Sort students$/i })
    const searchInput = screen.getByPlaceholderText('Search students')

    expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    expect(sortButton).toHaveAttribute('aria-expanded', 'false')
    expect(searchInput).toBeDisabled()
    expect(screen.queryByRole('dialog', { name: /^Sort options$/i })).not.toBeInTheDocument()

    fireEvent.click(searchButton)

    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(searchInput).toBeEnabled()
    fireEvent.blur(searchInput)
    expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    expect(searchInput).toBeDisabled()

    fireEvent.click(searchButton)
    fireEvent.change(searchInput, { target: { value: 'Alice' } })
    fireEvent.blur(searchInput)
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(searchInput).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /^Clear search$/i }))
    expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    expect(searchInput).toBeDisabled()
    expect(searchInput).toHaveValue('')

    fireEvent.click(searchButton)
    fireEvent.change(searchInput, { target: { value: 'Nobody' } })
    expect(screen.getByRole('status')).toHaveTextContent('No students found.')
    fireEvent.click(screen.getByRole('button', { name: /^Clear search$/i }))

    fireEvent.click(sortButton)

    expect(sortButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: /^Sort options$/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /^Student A-Z$/i })).toHaveAttribute('aria-checked', 'true')
    const completionSortOption = screen.getByRole('menuitemradio', { name: /^Completion high-low$/i })
    expect(completionSortOption).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(completionSortOption)
    expect(sortButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^Marks$/i })).toBeInTheDocument()
    expect(screen.queryByText('Filters')).not.toBeInTheDocument()
    expect(screen.queryByText('Legend:')).not.toBeInTheDocument()
    expect(screen.queryByText(/grouped by due date/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('Due now').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Future').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No due date').length).toBeGreaterThan(0)
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

  it('shows late as the core status circle in status mode and a clear tint in marks mode', () => {
    const matrix = makeMatrix({
      assignment_groups: [
        {
          name: 'Unit 1',
          assignments: [
            { id: 60, name: 'Late Task', points_possible: 10, due_at: new Date(2026, 3, 28, 9).toISOString() },
            { id: 61, name: 'On Time Task', points_possible: 10, due_at: new Date(2026, 3, 28, 10).toISOString() },
          ],
        },
      ],
      students: [
        {
          id: 1,
          name: 'Alice',
          sortable_name: 'Alice',
          submissions: {
            '60': { status: 'completed', score: 8, late: true, missing: false },
            '61': { status: 'completed', score: 10, late: false, missing: true },
          },
          metrics: { completion_rate: 0.5, on_time_rate: 0.5, current_score: 80 },
        },
      ],
    })

    const { container } = render(<ActivityTable matrix={matrix} />)
    let activityCells = Array.from(container.querySelectorAll('tbody tr td')).slice(2)

    expect(screen.queryByRole('dialog', { name: /legend/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show legend/i }))
    expect(screen.getByRole('dialog', { name: /legend/i })).toHaveTextContent('Late')
    expect(screen.queryByText('Missing')).not.toBeInTheDocument()
    expect(activityCells[0].className).not.toContain('bg-emerald-50/90')
    expect(activityCells[0].querySelector('.bg-emerald-50')).toBeInTheDocument()
    expect(activityCells[0].querySelector('.border-emerald-500')).toBeInTheDocument()
    expect(activityCells[0].querySelector('.bg-emerald-400')).not.toBeInTheDocument()
    expect(activityCells[1].className).not.toContain('bg-amber-50/80')

    fireEvent.click(screen.getByRole('button', { name: /^Marks$/i }))
    activityCells = Array.from(container.querySelectorAll('tbody tr td')).slice(2)

    expect(activityCells[0].className).not.toContain('bg-emerald-50/90')
    expect(activityCells[0].textContent).toBe('8')
    expect(activityCells[0].textContent).not.toContain('/10')
    expect(activityCells[0].querySelector('.bg-emerald-50')).toBeInTheDocument()
    expect(activityCells[0].querySelector('.border-emerald-500')).toBeInTheDocument()
    expect(activityCells[0].querySelector('.ring-emerald-100')).toBeInTheDocument()
    expect(activityCells[1].querySelector('.bg-emerald-400')).toBeInTheDocument()
    expect(activityCells[1].querySelector('.ring-emerald-200')).toBeInTheDocument()
    expect(activityCells[1].querySelector('.text-white')).toBeInTheDocument()
    expect(activityCells[1].textContent).toBe('10')
  })
})

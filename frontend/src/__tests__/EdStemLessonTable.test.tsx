import { screen } from '@testing-library/react'
import { render } from '@testing-library/react'
import EdStemLessonTable from '../components/EdStemLessonTable'
import type { EdStemMatrix } from '../types'

function makeMatrix(overrides: Partial<EdStemMatrix> = {}): EdStemMatrix {
  return {
    mapped: true,
    edstem_course_id: 28555,
    edstem_course_name: 'SE 2026',
    modules: [
      {
        name: 'Intro Module',
        lessons: [
          { id: 101, title: 'SQL Basics', is_interactive: false },
          { id: 102, title: 'Flask Intro', is_interactive: true },
        ],
      },
    ],
    students: [
      {
        id: 1,
        name: 'Alice',
        sortable_name: 'Smith, Alice',
        completion_rate: 0.5,
        progress: {
          '101': { status: 'completed', completed_at: '2026-01-15T10:00:00Z' },
          '102': { status: 'not_started', completed_at: null },
        },
      },
      {
        id: 2,
        name: 'Bob',
        sortable_name: 'Jones, Bob',
        completion_rate: 0.0,
        progress: {
          '101': { status: 'viewed', completed_at: null },
          '102': { status: 'not_started', completed_at: null },
        },
      },
    ],
    ...overrides,
  }
}

describe('EdStemLessonTable', () => {
  it('shows empty state when students list is empty', () => {
    render(<EdStemLessonTable matrix={makeMatrix({ students: [] })} />)
    expect(screen.getByText(/No students found/i)).toBeInTheDocument()
  })

  it('shows empty state when no lessons', () => {
    render(<EdStemLessonTable matrix={makeMatrix({ modules: [] })} />)
    expect(screen.getByText(/No lessons found/i)).toBeInTheDocument()
  })

  it('renders module name as group header', () => {
    render(<EdStemLessonTable matrix={makeMatrix()} />)
    expect(screen.getByText('Intro Module')).toBeInTheDocument()
  })

  it('renders lesson titles in header row', () => {
    render(<EdStemLessonTable matrix={makeMatrix()} />)
    // Titles are truncated to 4 chars in the header but appear in title attributes
    const { container } = render(<EdStemLessonTable matrix={makeMatrix()} />)
    const headers = container.querySelectorAll('th[title]')
    const titles = Array.from(headers).map(h => h.getAttribute('title') ?? '')
    expect(titles.some(t => t.includes('SQL Basics'))).toBe(true)
    expect(titles.some(t => t.includes('Flask Intro'))).toBe(true)
  })

  it('renders student names in sticky column', () => {
    render(<EdStemLessonTable matrix={makeMatrix()} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('renders completed cell with emerald dot', () => {
    const { container } = render(<EdStemLessonTable matrix={makeMatrix()} />)
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument()
  })

  it('renders viewed cell with amber dot', () => {
    const { container } = render(<EdStemLessonTable matrix={makeMatrix()} />)
    expect(container.querySelector('.bg-amber-400')).toBeInTheDocument()
  })

  it('renders not_started cell with slate dot', () => {
    const { container } = render(<EdStemLessonTable matrix={makeMatrix()} />)
    // Multiple not_started cells — slate-200
    expect(container.querySelector('.bg-slate-200')).toBeInTheDocument()
  })

  it('renders completion rate bar', () => {
    const { container } = render(<EdStemLessonTable matrix={makeMatrix()} />)
    // Alice has 50% completion — bar should show "50%"
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0)
  })
})

import { render, screen } from '@testing-library/react'
import GradeoTopicBandsTable from '../components/GradeoTopicBandsTable'
import type { GradeoTopicBands } from '../types'

function makeTopicBands(overrides: Partial<GradeoTopicBands> = {}): GradeoTopicBands {
  return {
    mapped: true,
    gradeo_class_id: 'gradeo-class-1',
    gradeo_class_name: '12 encx_2026',
    topics: [
      { name: 'Data Science', student_count: 2, average_score_pct: 0.74 },
      { name: 'Intelligent Systems', student_count: 1, average_score_pct: 0.82 },
    ],
    students: [
      {
        id: 1,
        name: 'Alice Smith',
        sortable_name: 'Smith, Alice',
        topics: {
          'Data Science': {
            score_pct: 0.82,
            predicted_band: 5,
            confidence: 'medium',
            earned_marks: 18,
            available_marks: 22,
            exam_count: 2,
            part_count: 7,
          },
        },
      },
      {
        id: 2,
        name: 'Noah Ould',
        sortable_name: 'Ould, Noah',
        topics: {
          'Data Science': {
            score_pct: 0.46,
            predicted_band: 1,
            confidence: 'low',
            earned_marks: 5,
            available_marks: 11,
            exam_count: 1,
            part_count: 3,
          },
          'Intelligent Systems': {
            score_pct: 0.91,
            predicted_band: 6,
            confidence: 'high',
            earned_marks: 29,
            available_marks: 32,
            exam_count: 3,
            part_count: 10,
          },
        },
      },
    ],
    ...overrides,
  }
}

describe('GradeoTopicBandsTable', () => {
  it('renders topic headers and student rows', () => {
    render(<GradeoTopicBandsTable topicBands={makeTopicBands()} />)
    expect(screen.getByText('Data Science')).toBeInTheDocument()
    expect(screen.getByText('Intelligent Systems')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Noah Ould')).toBeInTheDocument()
  })

  it('renders band, score percent, and confidence for populated cells', () => {
    render(<GradeoTopicBandsTable topicBands={makeTopicBands()} />)
    expect(screen.getByText('B5')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getAllByText('medium').length).toBeGreaterThan(0)
  })

  it('renders a muted dash for missing student topic data', () => {
    render(<GradeoTopicBandsTable topicBands={makeTopicBands()} />)
    expect(screen.getByLabelText('Alice Smith, Intelligent Systems: no topic evidence')).toBeInTheDocument()
  })

  it('includes marks and evidence counts in the cell tooltip', () => {
    render(<GradeoTopicBandsTable topicBands={makeTopicBands()} />)
    const cell = screen.getByLabelText(/Alice Smith.*Data Science/i)
    expect(cell).toHaveAttribute('title', expect.stringContaining('Marks 18/22'))
    expect(cell).toHaveAttribute('title', expect.stringContaining('2 exams'))
    expect(cell).toHaveAttribute('title', expect.stringContaining('7 parts'))
  })

  it('shows empty state when no topics are available', () => {
    render(<GradeoTopicBandsTable topicBands={makeTopicBands({ topics: [] })} />)
    expect(screen.getByText(/No topic-band evidence found yet/i)).toBeInTheDocument()
  })
})

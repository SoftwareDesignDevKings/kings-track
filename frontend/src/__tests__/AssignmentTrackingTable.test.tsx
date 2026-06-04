import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import AssignmentTrackingTable, {
  countsTowardTrackingProgress,
  trackingCompletionFraction,
} from '../components/AssignmentTrackingTable'

describe('AssignmentTrackingTable', () => {
  it('does not count zero scores toward tracking progress', () => {
    expect(countsTowardTrackingProgress(0)).toBe(false)
    expect(countsTowardTrackingProgress(null)).toBe(false)
    expect(countsTowardTrackingProgress(undefined)).toBe(false)
    expect(countsTowardTrackingProgress(1)).toBe(true)
    expect(countsTowardTrackingProgress(2)).toBe(true)
    expect(countsTowardTrackingProgress(3)).toBe(true)
  })

  it('weights completion by score: 0→0, 1→1/3, 2→2/3, 3→1', () => {
    expect(trackingCompletionFraction(0)).toBe(0)
    expect(trackingCompletionFraction(null)).toBe(0)
    expect(trackingCompletionFraction(undefined)).toBe(0)
    expect(trackingCompletionFraction(1)).toBeCloseTo(1 / 3)
    expect(trackingCompletionFraction(2)).toBeCloseTo(2 / 3)
    expect(trackingCompletionFraction(3)).toBe(1)
  })

  it('renders weighted completion in the progress column', () => {
    render(
      <AssignmentTrackingTable
        criteria={[
          { id: 'criterion-a', description: 'Criterion A', long_description: null, points: null, position: 1 },
          { id: 'criterion-b', description: 'Criterion B', long_description: null, points: null, position: 2 },
        ]}
        students={[{ id: 1, name: 'Alice Smith', sortable_name: 'Smith, Alice' }]}
        scores={{
          '1': {
            // 0 contributes 0; 2 contributes 2/3 → average = 1/3 → 33%.
            'criterion-a': { score: 0, comment: null },
            'criterion-b': { score: 2, comment: null },
          },
        }}
        onScoreChange={() => {}}
        onClearScore={() => {}}
        onCommentChange={() => {}}
      />,
    )

    expect(screen.getByText('33%')).toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import AssignmentTrackingTable, { countsTowardTrackingProgress } from '../components/AssignmentTrackingTable'

describe('AssignmentTrackingTable', () => {
  it('does not count zero scores toward tracking progress', () => {
    expect(countsTowardTrackingProgress(0)).toBe(false)
    expect(countsTowardTrackingProgress(null)).toBe(false)
    expect(countsTowardTrackingProgress(undefined)).toBe(false)
    expect(countsTowardTrackingProgress(1)).toBe(true)
    expect(countsTowardTrackingProgress(2)).toBe(true)
    expect(countsTowardTrackingProgress(3)).toBe(true)
  })

  it('excludes zero-score cells from the rendered progress column', () => {
    render(
      <AssignmentTrackingTable
        criteria={[
          { id: 'criterion-a', description: 'Criterion A', long_description: null, points: null, position: 1 },
          { id: 'criterion-b', description: 'Criterion B', long_description: null, points: null, position: 2 },
        ]}
        students={[{ id: 1, name: 'Alice Smith', sortable_name: 'Smith, Alice' }]}
        scores={{
          '1': {
            'criterion-a': { score: 0, comment: null },
            'criterion-b': { score: 2, comment: null },
          },
        }}
        onScoreChange={() => {}}
        onClearScore={() => {}}
        onCommentChange={() => {}}
      />,
    )

    expect(screen.getByText('50%')).toBeInTheDocument()
  })
})

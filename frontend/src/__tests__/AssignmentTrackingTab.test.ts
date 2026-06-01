import { describe, expect, it } from 'vitest'

import { removeSavedTrackingScores } from '../components/AssignmentTrackingTab'

describe('AssignmentTrackingTab autosave helpers', () => {
  it('clears only cells that still match the saved autosave snapshot', () => {
    const current = {
      '1': {
        a: { score: 2, comment: null },
        b: { score: 3, comment: 'newer edit' },
      },
      '2': {
        a: { score: 1, comment: null },
      },
    }
    const saved = {
      '1': {
        a: { score: 2, comment: null },
        b: { score: 0, comment: null },
      },
    }

    expect(removeSavedTrackingScores(current, saved)).toEqual({
      '1': {
        b: { score: 3, comment: 'newer edit' },
      },
      '2': {
        a: { score: 1, comment: null },
      },
    })
  })
})

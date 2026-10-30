import { describe, expect, it } from 'vitest'
import {
  isPerformance,
  MAX_PERFORMANCE_SECONDS,
  MAX_TAPS,
  type Performance,
  performanceOf,
  tapsOf
} from './performance'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'

describe('performanceOf', () => {
  it('times the taps from the first, to the millisecond, each Recording named once', () => {
    expect(
      performanceOf([
        { at: 1000.25, recordingId: A },
        { at: 1000.5004, recordingId: B },
        { at: 1001.2506, recordingId: A }
      ])
    ).toEqual({
      recordings: [A, B],
      taps: [
        [0, 0],
        [0.25, 1],
        [1.001, 0]
      ]
    })
  })

  it('puts taps in time order', () => {
    expect(
      performanceOf([
        { at: 5, recordingId: B },
        { at: 4, recordingId: A }
      ])
    ).toEqual({
      recordings: [A, B],
      taps: [
        [0, 0],
        [1, 1]
      ]
    })
  })

  it('is null for no taps', () => {
    expect(performanceOf([])).toBeNull()
  })

  it(`keeps ${MAX_PERFORMANCE_SECONDS} s and ${MAX_TAPS} taps at most`, () => {
    const long = performanceOf([
      { at: 0, recordingId: A },
      { at: MAX_PERFORMANCE_SECONDS, recordingId: A },
      { at: MAX_PERFORMANCE_SECONDS + 0.01, recordingId: B }
    ])
    expect(long).toEqual({
      recordings: [A],
      taps: [
        [0, 0],
        [MAX_PERFORMANCE_SECONDS, 0]
      ]
    })
    const many = performanceOf(
      Array.from({ length: MAX_TAPS + 5 }, (_, i) => ({ at: i / 100, recordingId: A }))
    )
    expect(many?.taps).toHaveLength(MAX_TAPS)
    expect(isPerformance(many)).toBe(true)
  })

  it('gives back the taps it was made of (`tapsOf`)', () => {
    const taps = [
      { at: 0, recordingId: A },
      { at: 0.125, recordingId: B },
      { at: 0.5, recordingId: A }
    ]
    expect(tapsOf(performanceOf(taps) as Performance)).toEqual(taps)
  })
})

describe('isPerformance', () => {
  const good: Performance = {
    recordings: [A, B],
    taps: [
      [0, 0],
      [0.25, 1]
    ]
  }

  it('accepts a Performance', () => {
    expect(isPerformance(good)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'taps'],
    ['no Recordings', { recordings: [], taps: [] }],
    ['no taps', { recordings: [A], taps: [] }],
    ['a Recording that is not an id', { recordings: ['a'], taps: [[0, 0]] }],
    [
      'a Recording named twice',
      {
        recordings: [A, A],
        taps: [
          [0, 0],
          [0, 1]
        ]
      }
    ],
    ['a Recording never played', { recordings: [A, B], taps: [[0, 0]] }],
    ['a tap of no Recording', { recordings: [A], taps: [[0, 1]] }],
    ['a tap index that is not an integer', { recordings: [A], taps: [[0, 0.5]] }],
    [
      'a tap out of order',
      {
        recordings: [A],
        taps: [
          [1, 0],
          [0.5, 0]
        ]
      }
    ],
    ['a tap before 0', { recordings: [A], taps: [[-0.1, 0]] }],
    ['a tap past the longest take', { recordings: [A], taps: [[MAX_PERFORMANCE_SECONDS + 1, 0]] }],
    ['a tap at no time', { recordings: [A], taps: [[Number.NaN, 0]] }],
    ['a tap that is an object', { recordings: [A], taps: [{ at: 0, recording: 0 }] }],
    ['a tap with more', { recordings: [A], taps: [[0, 0, 1]] }],
    ['too many taps', { recordings: [A], taps: Array.from({ length: MAX_TAPS + 1 }, () => [0, 0]) }]
  ])('refuses %s', (_, value) => {
    expect(isPerformance(value)).toBe(false)
  })
})

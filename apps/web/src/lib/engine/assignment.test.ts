import { describe, expect, it } from 'vitest'
import { seededRandom } from '@/test-support/engine-golden'
import { minimumCost } from './assignment'

function bruteForceMinimum(cost: Float64Array, rows: number, columns: number): number {
  let best = Infinity
  const visit = (r: number, used: Set<number>, total: number) => {
    if (r === rows) {
      best = Math.min(best, total)
      return
    }
    for (let c = 0; c < columns; c++) {
      if (used.has(c) || cost[r * columns + c] === Infinity) continue
      used.add(c)
      visit(r + 1, used, total + cost[r * columns + c])
      used.delete(c)
    }
  }
  visit(0, new Set(), 0)
  return best
}

describe('the assignment solver', () => {
  it('finds a minimum-cost assignment like brute force, and refuses when none is complete', () => {
    const random = seededRandom(7)
    for (let trial = 0; trial < 300; trial++) {
      const rows = 1 + Math.floor(random() * 4)
      const columns = rows + Math.floor(random() * 3)
      const cost = new Float64Array(rows * columns)
      for (let k = 0; k < cost.length; k++) {
        cost[k] = random() < 0.2 ? Infinity : Math.floor(random() * 20)
      }
      for (let r = 0; r < rows; r++) {
        const everyRowHasAnAllowedColumn = (r + trial) % columns
        cost[r * columns + everyRowHasAnAllowedColumn] = 5
      }
      const best = bruteForceMinimum(cost, rows, columns)
      if (best === Infinity) {
        expect(() => minimumCost(cost, rows, columns)).toThrow(RangeError)
        continue
      }
      const picked = minimumCost(cost, rows, columns)
      expect(new Set(picked).size).toBe(rows)
      expect(picked.reduce((s, c, r) => s + cost[r * columns + c], 0)).toBe(best)
    }
  })

  it('refuses more rows than columns', () => {
    expect(() => minimumCost(new Float64Array(2), 2, 1)).toThrow(RangeError)
  })
})

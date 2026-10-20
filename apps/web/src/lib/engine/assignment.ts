/**
 * The linear assignment problem: a minimum-cost matching of every row to its own column. Port of
 * `Assignment.minimumCost` in `AutoMap.swift`, which stands in for the reference's
 * `scipy.optimize.linear_sum_assignment`.
 *
 * `a` is a row-major `rows` × `columns` cost matrix with `rows <= columns`; `Infinity` marks a
 * forbidden cell, and every row needs a finite one. Returns the column of each row. Shortest
 * augmenting paths with potentials (Kuhn–Munkres), O(rows² × columns).
 */
export function minimumCost(a: Float64Array, rows: number, columns: number): number[] {
  const n = rows
  const m = columns
  if (n > m) throw new RangeError(`${n} rows can't each have their own of ${m} columns`)
  // 1-based: row 0 and column 0 are the virtual root of each search.
  const u = new Float64Array(n + 1)
  const v = new Float64Array(m + 1)
  const rowOf = new Int32Array(m + 1)
  const way = new Int32Array(m + 1)
  const minv = new Float64Array(m + 1)
  const used = new Uint8Array(m + 1)
  for (let i = 1; i <= n; i++) {
    rowOf[0] = i
    let j0 = 0
    minv.fill(Number.POSITIVE_INFINITY)
    used.fill(0)
    do {
      used[j0] = 1
      const i0 = rowOf[j0]
      let delta = Number.POSITIVE_INFINITY
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const c = a[(i0 - 1) * m + (j - 1)]
        if (c < Number.POSITIVE_INFINITY) {
          const reduced = c - u[i0] - v[j]
          if (reduced < minv[j]) {
            minv[j] = reduced
            way[j] = j0
          }
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      if (j1 === 0) throw new RangeError(`row ${i0 - 1} has no allowed column`)
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[rowOf[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (rowOf[j0] !== 0)
    do {
      const j1 = way[j0]
      rowOf[j0] = rowOf[j1]
      j0 = j1
    } while (j0 !== 0)
  }
  const columnOf = new Array<number>(n).fill(0)
  for (let j = 1; j <= m; j++) if (rowOf[j] !== 0) columnOf[rowOf[j] - 1] = j - 1
  return columnOf
}

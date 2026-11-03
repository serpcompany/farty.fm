export function minimumCost(cost: Float64Array, rows: number, columns: number): number[] {
  const n = rows
  const m = columns
  if (n > m) throw new RangeError(`${n} rows can't each have their own of ${m} columns`)
  const rowPotential = new Float64Array(n + 1)
  const columnPotential = new Float64Array(m + 1)
  const rowOf = new Int32Array(m + 1)
  const previousColumn = new Int32Array(m + 1)
  const minSlack = new Float64Array(m + 1)
  const visited = new Uint8Array(m + 1)
  for (let i = 1; i <= n; i++) {
    rowOf[0] = i
    let j0 = 0
    minSlack.fill(Number.POSITIVE_INFINITY)
    visited.fill(0)
    do {
      visited[j0] = 1
      const i0 = rowOf[j0]
      let delta = Number.POSITIVE_INFINITY
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (visited[j]) continue
        const c = cost[(i0 - 1) * m + (j - 1)]
        if (c < Number.POSITIVE_INFINITY) {
          const reduced = c - rowPotential[i0] - columnPotential[j]
          if (reduced < minSlack[j]) {
            minSlack[j] = reduced
            previousColumn[j] = j0
          }
        }
        if (minSlack[j] < delta) {
          delta = minSlack[j]
          j1 = j
        }
      }
      if (j1 === 0) throw new RangeError(`row ${i0 - 1} has no allowed column`)
      for (let j = 0; j <= m; j++) {
        if (visited[j]) {
          rowPotential[rowOf[j]] += delta
          columnPotential[j] -= delta
        } else {
          minSlack[j] -= delta
        }
      }
      j0 = j1
    } while (rowOf[j0] !== 0)
    do {
      const j1 = previousColumn[j0]
      rowOf[j0] = rowOf[j1]
      j0 = j1
    } while (j0 !== 0)
  }
  const columnOf = new Array<number>(n).fill(0)
  for (let j = 1; j <= m; j++) if (rowOf[j] !== 0) columnOf[rowOf[j] - 1] = j - 1
  return columnOf
}

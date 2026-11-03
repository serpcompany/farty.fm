const LOG2_440 = Math.log2(440)

export function hzToMidi(hz: number): number {
  return 12 * (log2(hz) - LOG2_440) + 69
}

export function midiToHz(midi: number): number {
  return 440 * exp2((midi - 69) / 12)
}

export function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r
}

export function pairwiseSum(a: ArrayLike<number>, start: number, n: number): number {
  if (n < 8) {
    let res = 0
    for (let i = 0; i < n; i++) res += a[start + i]
    return res
  }
  if (n <= 128) {
    const r = [0, 1, 2, 3, 4, 5, 6, 7].map(j => a[start + j])
    let i = 8
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[start + i + j]
    let res = r[0] + r[1] + (r[2] + r[3]) + (r[4] + r[5] + (r[6] + r[7]))
    for (; i < n; i++) res += a[start + i]
    return res
  }
  let n2 = Math.floor(n / 2)
  n2 -= n2 % 8
  return pairwiseSum(a, start, n2) + pairwiseSum(a, start + n2, n - n2)
}

export function exp2(x: number): number {
  if (!Number.isFinite(x) || Math.abs(x) > 1000) return 2 ** x
  const [h, l] = exp2DoubleDouble(x)
  return h + l
}

function log2(x: number): number {
  const y = Math.log2(x)
  if (!Number.isFinite(y) || !(x > 0) || Math.abs(y) > 1000) return y
  const [eh, el] = exp2DoubleDouble(-y)
  const [p, e] = twoProd(x, eh)
  const c = p - 1 + (e + x * el)
  return y + c / Math.LN2
}

function exp2DoubleDouble(x: number): [number, number] {
  const k = Math.round(x)
  const r = x - k
  let [th, tl] = twoProd(r, LN2_HI)
  tl += r * LN2_LO
  ;[th, tl] = fastTwoSum(th, tl)
  let sh = 1
  let sl = 0
  let ph = 1
  let pl = 0
  for (let n = 1; n <= TAYLOR_TERMS; n++) {
    ;[ph, pl] = ddMul(ph, pl, th, tl)
    ;[ph, pl] = ddDiv(ph, pl, n)
    ;[sh, sl] = ddAdd(sh, sl, ph, pl)
  }
  const scale = 2 ** k
  return [sh * scale, sl * scale]
}

const LN2_HI = Math.LN2
const LN2_LO = 2.3190468138462996e-17
const DEKKER_SPLIT = 2 ** 27 + 1
const TAYLOR_TERMS = 27

function twoSum(a: number, b: number): [number, number] {
  const s = a + b
  const v = s - a
  return [s, a - (s - v) + (b - v)]
}

function fastTwoSum(a: number, b: number): [number, number] {
  const s = a + b
  return [s, b - (s - a)]
}

function twoProd(a: number, b: number): [number, number] {
  const p = a * b
  const ca = DEKKER_SPLIT * a
  const ah = ca - (ca - a)
  const al = a - ah
  const cb = DEKKER_SPLIT * b
  const bh = cb - (cb - b)
  const bl = b - bh
  return [p, ah * bh - p + ah * bl + al * bh + al * bl]
}

function ddAdd(ah: number, al: number, bh: number, bl: number): [number, number] {
  const [s, e] = twoSum(ah, bh)
  return fastTwoSum(s, e + al + bl)
}

function ddMul(ah: number, al: number, bh: number, bl: number): [number, number] {
  const [p, e] = twoProd(ah, bh)
  return fastTwoSum(p, e + ah * bl + al * bh)
}

function ddDiv(ah: number, al: number, d: number): [number, number] {
  const q = ah / d
  const [p, e] = twoProd(q, d)
  return fastTwoSum(q, (ah - p - e + al) / d)
}

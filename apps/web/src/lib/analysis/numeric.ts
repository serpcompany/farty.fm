// Numeric helpers that reproduce the reference's (numpy's) results bit for bit where a later
// stage depends on them: the pYIN pitch grid, which every Recording Pitch sits on.

const LOG2_440 = Math.log2(440) // exact enough: V8 and numpy agree on it

/** librosa.hz_to_midi. */
export function hzToMidi(hz: number): number {
  return 12 * (log2(hz) - LOG2_440) + 69
}

/** librosa.midi_to_hz. */
export function midiToHz(midi: number): number {
  return 440 * exp2((midi - 69) / 12)
}

/** numpy's `np.round` / Swift's `.toNearestOrEven`: halves go to the even neighbor. */
export function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/**
 * numpy's pairwise summation of `a[start ..< start + n]` (what `np.sum` does on a contiguous
 * float64 array).
 */
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

/**
 * 2^x, correctly rounded (evaluated in double-double). The reference gets pYIN's bin frequencies
 * and `midi_to_hz` from the C library's `pow`. V8's `2 ** x` is one ulp off it on 43 of the 519
 * pYIN bins, which would move Recording Pitches off the reference's exact values; this agrees with
 * it on every bin.
 */
export function exp2(x: number): number {
  if (!Number.isFinite(x) || Math.abs(x) > 1000) return 2 ** x
  const [h, l] = exp2Dd(x)
  return h + l
}

/**
 * log2(x), correctly rounded. V8's `Math.log2` is one ulp off the C library's `log2` on 3 of the
 * pYIN grid's `midi_to_hz` values; this agrees on all of them. One Newton step from V8's estimate
 * y: log2(x) = y + ln(x · 2^−y) / ln 2, where x · 2^−y − 1 is tiny and computed in double-double.
 */
export function log2(x: number): number {
  const y = Math.log2(x)
  if (!Number.isFinite(y) || !(x > 0) || Math.abs(y) > 1000) return y
  const [eh, el] = exp2Dd(-y)
  const [p, e] = twoProd(x, eh)
  const c = p - 1 + (e + x * el)
  return y + c / Math.LN2
}

/** 2^x in double-double: 2^k · e^(r ln 2) with a Taylor series (|r ln 2| ≤ 0.35, 27 terms). */
function exp2Dd(x: number): [number, number] {
  const k = Math.round(x)
  const r = x - k // exact
  let [th, tl] = twoProd(r, LN2_HI)
  tl += r * LN2_LO
  ;[th, tl] = fastTwoSum(th, tl)
  let sh = 1
  let sl = 0
  let ph = 1
  let pl = 0
  for (let n = 1; n <= 27; n++) {
    ;[ph, pl] = ddMul(ph, pl, th, tl)
    ;[ph, pl] = ddDiv(ph, pl, n)
    ;[sh, sl] = ddAdd(sh, sl, ph, pl)
  }
  const scale = 2 ** k
  return [sh * scale, sl * scale]
}

const LN2_HI = Math.LN2
const LN2_LO = 2.3190468138462996e-17
const SPLIT = 134217729 // 2^27 + 1

function twoSum(a: number, b: number): [number, number] {
  const s = a + b
  const v = s - a
  return [s, a - (s - v) + (b - v)]
}

function fastTwoSum(a: number, b: number): [number, number] {
  const s = a + b
  return [s, b - (s - a)]
}

/** Dekker's exact product: a · b = p + e. */
function twoProd(a: number, b: number): [number, number] {
  const p = a * b
  const ca = SPLIT * a
  const ah = ca - (ca - a)
  const al = a - ah
  const cb = SPLIT * b
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

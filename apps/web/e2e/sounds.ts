import type { Page } from '@playwright/test'
import { expect } from './test'

type Sound = { duration: number; peak: number; args: number[] }

declare global {
  interface Window {
    fartySounds: Sound[]
    fartyStops: number
    fartyResumesInTaps: number
  }
}

export function hearSounds(): void {
  window.fartySounds = []
  const start = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
    let peak = 0
    for (const sample of this.buffer?.getChannelData(0) ?? []) {
      peak = Math.max(peak, Math.abs(sample))
    }
    window.fartySounds.push({ duration: this.buffer?.duration ?? 0, peak, args: args as number[] })
    return start.apply(this, args)
  }
}

export function countStops(): void {
  window.fartyStops = 0
  const stop = AudioBufferSourceNode.prototype.stop
  AudioBufferSourceNode.prototype.stop = function (this: AudioBufferSourceNode, when?: number) {
    window.fartyStops += 1
    stop.call(this, when)
  }
}

export function stops(page: Page): Promise<number> {
  return page.evaluate(() => window.fartyStops)
}

export function soundsStarted(page: Page): Promise<number> {
  return page.evaluate(() => window.fartySounds.length)
}

export async function forgetSounds(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.fartySounds = []
  })
}

export async function lastSound(page: Page): Promise<Sound> {
  await expect.poll(() => soundsStarted(page)).toBeGreaterThan(0)
  return page.evaluate(() => {
    const sound = window.fartySounds[window.fartySounds.length - 1]
    window.fartySounds = []
    return sound
  })
}

export function countResumesInTaps(): void {
  window.fartyResumesInTaps = 0
  let inTap = false
  addEventListener('click', () => (inTap = true), { capture: true })
  addEventListener('click', () => (inTap = false))
  const resume = AudioContext.prototype.resume
  AudioContext.prototype.resume = function (this: AudioContext) {
    if (inTap) window.fartyResumesInTaps += 1
    return resume.call(this)
  }
}

export function resumesInTaps(page: Page): Promise<number> {
  return page.evaluate(() => window.fartyResumesInTaps)
}

export async function forgetResumesInTaps(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.fartyResumesInTaps = 0
  })
}

import type { Page } from '@playwright/test'
import { expect } from './test'

type Sound = { duration: number; peak: number; args: number[] }

declare global {
  interface Window {
    pedosSounds: Sound[]
    pedosStops: number
    pedosResumesInTaps: number
  }
}

export function hearSounds(): void {
  window.pedosSounds = []
  const start = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
    let peak = 0
    for (const sample of this.buffer?.getChannelData(0) ?? []) {
      peak = Math.max(peak, Math.abs(sample))
    }
    window.pedosSounds.push({ duration: this.buffer?.duration ?? 0, peak, args: args as number[] })
    return start.apply(this, args)
  }
}

export function countStops(): void {
  window.pedosStops = 0
  const stop = AudioBufferSourceNode.prototype.stop
  AudioBufferSourceNode.prototype.stop = function (this: AudioBufferSourceNode, when?: number) {
    window.pedosStops += 1
    stop.call(this, when)
  }
}

export function stops(page: Page): Promise<number> {
  return page.evaluate(() => window.pedosStops)
}

export function soundsStarted(page: Page): Promise<number> {
  return page.evaluate(() => window.pedosSounds.length)
}

export async function forgetSounds(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.pedosSounds = []
  })
}

export async function lastSound(page: Page): Promise<Sound> {
  await expect.poll(() => soundsStarted(page)).toBeGreaterThan(0)
  return page.evaluate(() => {
    const sound = window.pedosSounds[window.pedosSounds.length - 1]
    window.pedosSounds = []
    return sound
  })
}

export function countResumesInTaps(): void {
  window.pedosResumesInTaps = 0
  let inTap = false
  addEventListener('click', () => (inTap = true), { capture: true })
  addEventListener('click', () => (inTap = false))
  const resume = AudioContext.prototype.resume
  AudioContext.prototype.resume = function (this: AudioContext) {
    if (inTap) window.pedosResumesInTaps += 1
    return resume.call(this)
  }
}

export function resumesInTaps(page: Page): Promise<number> {
  return page.evaluate(() => window.pedosResumesInTaps)
}

export async function forgetResumesInTaps(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.pedosResumesInTaps = 0
  })
}

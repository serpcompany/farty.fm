import { describe, expect, it } from 'vitest'
import {
  newCaptureProcessor,
  renderQuantum as quantum,
  captureSampleRate as sampleRate
} from '@/test-support/capture-processor'
import {
  batchFrames,
  type CaptureBatch,
  type CaptureCommand,
  preRollSeconds
} from './capture-processor'

function capture() {
  const sent: CaptureBatch[] = []
  const processor = newCaptureProcessor(data => sent.push(data))
  let next = 0
  return {
    sent,
    feed(frames: number): boolean {
      let running = true
      for (let done = 0; done < frames; done += quantum) {
        const channel = Float32Array.from({ length: quantum }, () => ++next)
        running = processor.process([[channel]])
      }
      return running
    },
    send(command: CaptureCommand) {
      processor.port.onmessage?.({ data: command })
    }
  }
}

const preRollFrames = Math.round(preRollSeconds * sampleRate)

describe('capture processor', () => {
  it('starts a take with the last 300 ms before it, in the first quantum after the tap', () => {
    const c = capture()
    c.feed(sampleRate)
    c.send({ type: 'start', take: 1 })
    expect(c.sent).toHaveLength(0)
    c.feed(quantum)
    expect(c.sent).toHaveLength(1)
    const [first] = c.sent
    expect(first.take).toBe(1)
    expect(first.done).toBe(false)
    expect(first.samples).toHaveLength(preRollFrames + quantum)
    const startsAt = sampleRate - preRollFrames + 1
    expect(Array.from(first.samples)).toEqual(
      Array.from({ length: preRollFrames + quantum }, (_, i) => startsAt + i)
    )
  })

  it('keeps every sample of a take, in order, through to stop', () => {
    const c = capture()
    c.feed(sampleRate)
    c.send({ type: 'start', take: 2 })
    c.feed(3 * batchFrames + 5 * quantum)
    c.send({ type: 'stop', take: 2 })
    const last = c.sent.at(-1)
    expect(last?.done).toBe(true)
    expect(c.sent.slice(1, -1).every(batch => batch.samples.length === batchFrames)).toBe(true)
    const all = c.sent.flatMap(batch => Array.from(batch.samples))
    const startsAt = sampleRate - preRollFrames + 1
    expect(all).toEqual(Array.from({ length: all.length }, (_, i) => startsAt + i))
    expect(all.at(-1)).toBe(sampleRate + 3 * batchFrames + 5 * quantum)
  })

  it('starts with what it has when the microphone opened less than 300 ms ago', () => {
    const c = capture()
    c.feed(10 * quantum)
    c.send({ type: 'start', take: 1 })
    c.feed(quantum)
    expect(Array.from(c.sent[0].samples)).toEqual(
      Array.from({ length: 11 * quantum }, (_, i) => i + 1)
    )
  })

  it('sends just the pre-roll when stopped before the audio thread ran', () => {
    const c = capture()
    c.feed(sampleRate)
    c.send({ type: 'start', take: 1 })
    c.send({ type: 'stop', take: 1 })
    expect(c.sent).toHaveLength(1)
    expect(c.sent[0].done).toBe(true)
    expect(c.sent[0].samples).toHaveLength(preRollFrames)
  })

  it('sends nothing between takes, after a cancel, or for another take', () => {
    const c = capture()
    c.feed(sampleRate)
    expect(c.sent).toHaveLength(0)
    c.send({ type: 'start', take: 1 })
    c.feed(quantum)
    c.send({ type: 'stop', take: 7 })
    c.send({ type: 'cancel', take: 1 })
    const before = c.sent.length
    c.feed(2 * batchFrames)
    expect(c.sent).toHaveLength(before)
  })

  it('stops running once closed, so released microphones leave no processor behind', () => {
    const c = capture()
    expect(c.feed(sampleRate)).toBe(true)
    c.send({ type: 'start', take: 1 })
    c.send({ type: 'close' })
    expect(c.feed(quantum)).toBe(false)
    expect(c.sent).toHaveLength(0)
  })

  it('forgets the pre-roll on flush, so a take after an interruption has none of the old audio', () => {
    const c = capture()
    c.feed(sampleRate)
    c.send({ type: 'flush' })
    c.feed(2 * quantum)
    c.send({ type: 'start', take: 1 })
    c.feed(quantum)
    expect(Array.from(c.sent[0].samples)).toEqual(
      Array.from({ length: 3 * quantum }, (_, i) => sampleRate + i + 1)
    )
  })
})

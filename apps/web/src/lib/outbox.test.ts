import { describe, expect, it } from 'vitest'
import { mergeOutbox, type OutboxEntry, type OutboxOp } from './outbox'

const id = '11111111-1111-4111-8111-111111111111'
const stamp = (version: string) => ({ at: 2, version })

function queued(op: OutboxOp, sent = false): OutboxEntry {
  return { key: `toots:${id}`, kind: 'toots', id, op, sent, queuedAt: 1, version: 'v1' }
}

describe('mergeOutbox', () => {
  it('queues the first change on its own', () => {
    expect(mergeOutbox(undefined, 'toots', id, 'rename', stamp('v2'))).toEqual({
      ...queued('rename'),
      queuedAt: 2,
      version: 'v2'
    })
  })

  it('lets a rename ride in an upload, with a new version', () => {
    expect(mergeOutbox(queued('put'), 'toots', id, 'rename', stamp('v2'))).toEqual({
      ...queued('put'),
      version: 'v2'
    })
  })

  it('drops an upload no request has carried when its item is deleted, and sends nothing', () => {
    expect(mergeOutbox(queued('put'), 'toots', id, 'delete', stamp('v2'))).toBeNull()
  })

  it('sends the delete of an item an upload may have reached the account with', () => {
    expect(mergeOutbox(queued('put', true), 'toots', id, 'delete', stamp('v2'))).toMatchObject({
      op: 'delete',
      sent: false,
      queuedAt: 1,
      version: 'v2'
    })
    expect(mergeOutbox(queued('rename'), 'toots', id, 'delete', stamp('v2'))).toMatchObject({
      op: 'delete'
    })
  })

  it('keeps a queued delete over anything after it', () => {
    for (const op of ['put', 'rename', 'delete'] as const) {
      expect(mergeOutbox(queued('delete'), 'toots', id, op, stamp('v2'))).toEqual(queued('delete'))
    }
  })

  it('lets a place ride in an upload, and sends a second place as one', () => {
    const recording = (op: OutboxOp, sent = false): OutboxEntry => ({
      ...queued(op, sent),
      key: `recordings:${id}`,
      kind: 'recordings'
    })
    expect(mergeOutbox(recording('put'), 'recordings', id, 'place', stamp('v2'))).toEqual({
      ...recording('put'),
      version: 'v2'
    })
    expect(
      mergeOutbox(recording('place', true), 'recordings', id, 'place', stamp('v2'))
    ).toMatchObject({ op: 'place', sent: false, version: 'v2' })
    expect(mergeOutbox(recording('place'), 'recordings', id, 'delete', stamp('v2'))).toMatchObject({
      op: 'delete'
    })
  })

  it('sends a second rename as one, with a new version', () => {
    expect(mergeOutbox(queued('rename', true), 'toots', id, 'rename', stamp('v2'))).toMatchObject({
      op: 'rename',
      sent: false,
      version: 'v2'
    })
  })
})

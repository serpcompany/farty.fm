import { describe, expect, it } from 'vitest'
import { mergeOutbox, type OutboxEntry, type OutboxOp, placedFields } from './outbox'

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
    expect(
      mergeOutbox(recording('put'), 'recordings', id, 'place', stamp('v2'), ['placedPitch'])
    ).toEqual({ ...recording('put'), version: 'v2', fields: ['placedPitch'] })
    expect(
      mergeOutbox(recording('place', true), 'recordings', id, 'place', stamp('v2'))
    ).toMatchObject({ op: 'place', sent: false, version: 'v2' })
    expect(mergeOutbox(recording('place'), 'recordings', id, 'delete', stamp('v2'))).toMatchObject({
      op: 'delete'
    })
  })

  it('keeps the fields every place changed, in an upload or a place, sent or not', () => {
    const recording = (
      op: OutboxOp,
      sent = false,
      fields?: OutboxEntry['fields']
    ): OutboxEntry => ({
      ...queued(op, sent),
      key: `recordings:${id}`,
      kind: 'recordings',
      ...(fields ? { fields } : {})
    })
    expect(mergeOutbox(undefined, 'recordings', id, 'place', stamp('v2'), ['trim'])).toMatchObject({
      op: 'place',
      fields: ['trim']
    })
    expect(mergeOutbox(recording('put'), 'recordings', id, 'place', stamp('v2'), ['trim'])).toEqual(
      { ...recording('put'), version: 'v2', fields: ['trim'] }
    )
    expect(
      mergeOutbox(recording('put', false, ['trim']), 'recordings', id, 'place', stamp('v3'), [
        'placedPitch'
      ])
    ).toMatchObject({ op: 'put', fields: ['placedPitch', 'trim'] })
    expect(
      mergeOutbox(recording('place', true, ['trim']), 'recordings', id, 'place', stamp('v2'), [
        'placedPitch'
      ])
    ).toMatchObject({ op: 'place', sent: false, fields: ['placedPitch', 'trim'] })
    expect(
      mergeOutbox(recording('place', false, ['name']), 'recordings', id, 'place', stamp('v2'), [
        'trim',
        'placedPitch'
      ])
    ).toMatchObject({ op: 'place', fields: ['placedPitch', 'trim', 'name'] })
  })

  it('reads a place without fields as the Placed Pitch alone', () => {
    const old: OutboxEntry = { ...queued('place'), key: `recordings:${id}`, kind: 'recordings' }
    expect(placedFields(old)).toEqual(['placedPitch'])
    expect(mergeOutbox(old, 'recordings', id, 'place', stamp('v2'), ['trim'])).toMatchObject({
      fields: ['placedPitch', 'trim']
    })
    expect(placedFields({ ...old, op: 'put' })).toEqual([])
  })

  it('sends a second rename as one, with a new version', () => {
    expect(mergeOutbox(queued('rename', true), 'toots', id, 'rename', stamp('v2'))).toMatchObject({
      op: 'rename',
      sent: false,
      version: 'v2'
    })
  })

  describe('a Favorite Song', () => {
    const song = 'twinkle'
    const favorite = (op: OutboxOp, sent = false): OutboxEntry => ({
      key: `favorites:${song}`,
      kind: 'favorites',
      id: song,
      op,
      sent,
      queuedAt: 1,
      version: 'v1'
    })

    it('queues a favorite or an unfavorite on its own', () => {
      expect(mergeOutbox(undefined, 'favorites', song, 'put', stamp('v2'))).toEqual({
        ...favorite('put'),
        queuedAt: 2,
        version: 'v2'
      })
      expect(mergeOutbox(undefined, 'favorites', song, 'delete', stamp('v2'))).toMatchObject({
        op: 'delete'
      })
    })

    it('lets the last op win once an earlier one went out, keeping its place in the queue', () => {
      expect(mergeOutbox(favorite('put', true), 'favorites', song, 'delete', stamp('v2'))).toEqual({
        ...favorite('delete'),
        version: 'v2',
        reached: true
      })
      expect(mergeOutbox(favorite('delete', true), 'favorites', song, 'put', stamp('v2'))).toEqual({
        ...favorite('put'),
        version: 'v2',
        reached: true
      })
    })

    it('leaves nothing to send when a tap undoes one no request carried', () => {
      expect(mergeOutbox(favorite('put'), 'favorites', song, 'delete', stamp('v2'))).toBeNull()
      expect(mergeOutbox(favorite('delete'), 'favorites', song, 'put', stamp('v2'))).toBeNull()
    })

    it('remembers across later taps that an earlier op went out', () => {
      const off = mergeOutbox(favorite('put', true), 'favorites', song, 'delete', stamp('v2'))
      const on = mergeOutbox(off ?? undefined, 'favorites', song, 'put', stamp('v3'))
      expect(on).toEqual({ ...favorite('put'), version: 'v3', reached: true })
      expect(mergeOutbox(on ?? undefined, 'favorites', song, 'delete', stamp('v4'))).toEqual({
        ...favorite('delete'),
        version: 'v4',
        reached: true
      })
    })

    it('keeps the same op queued as it is, or sends it again once it went out', () => {
      expect(mergeOutbox(favorite('put'), 'favorites', song, 'put', stamp('v2'))).toEqual(
        favorite('put')
      )
      expect(mergeOutbox(favorite('put', true), 'favorites', song, 'put', stamp('v2'))).toEqual({
        ...favorite('put'),
        version: 'v2',
        reached: true
      })
    })
  })
})

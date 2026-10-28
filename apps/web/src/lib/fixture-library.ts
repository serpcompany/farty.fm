export const fixtureLibraryPath = '/fixtures/recordings/'

export type FixtureIndex = { recordings: { id: string; file: string }[] }

const FIXTURE_ID_PREFIX = '00000000-0000-0000-'

export function fixtureRecordingId(fixtureId: string): string {
  return `${FIXTURE_ID_PREFIX}0000-${fixtureId.padStart(12, '0')}`
}

export function newFixtureRecordingId(fixtureId: string): string {
  return `${FIXTURE_ID_PREFIX}${fixtureId.padStart(4, '0')}-${crypto.randomUUID().slice(-12)}`
}

export function isFixtureRecording(recordingId: string, fixtureId: string): boolean {
  return (
    recordingId === fixtureRecordingId(fixtureId) ||
    recordingId.startsWith(`${FIXTURE_ID_PREFIX}${fixtureId.padStart(4, '0')}-`)
  )
}

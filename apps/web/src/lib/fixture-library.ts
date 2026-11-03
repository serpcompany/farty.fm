export const fixtureLibraryPath = '/fixtures/recordings/'

export type FixtureIndex = { recordings: { id: string; file: string }[] }

const FIXTURE_RECORDING_ID = /^00000000-0000-0000-0000-\d{12}$/

export function fixtureRecordingId(fixtureId: string): string {
  return `00000000-0000-0000-0000-${fixtureId.padStart(12, '0')}`
}

export function isFixtureRecordingId(id: string): boolean {
  return FIXTURE_RECORDING_ID.test(id)
}

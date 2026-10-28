export const fixtureLibraryPath = '/fixtures/recordings/'

export type FixtureIndex = { recordings: { id: string; file: string }[] }

export function fixtureRecordingId(fixtureId: string): string {
  return `00000000-0000-0000-0000-${fixtureId.padStart(12, '0')}`
}

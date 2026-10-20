// The Fixture Library in an internal build (Staging): the 23 test farts of `fixtures/recordings/`,
// added as the user's own Recordings, as the iPhone app's `FixtureLibrary`. Only the Staging build
// carries them (`scripts/fixture-library.ts`), and only it imports this module.

/** Where the Staging build serves the fixtures, as `<id>.wav`, with their `index.json`. */
export const fixtureLibraryPath = '/fixtures/recordings/'

/** `index.json`: every fixture, in id order. */
export type FixtureIndex = { recordings: { id: string; file: string }[] }

/**
 * The Recording id a fixture gets, as on the iPhone: `00000000-0000-0000-0000-000000000090` for
 * fixture 090. Auto-map breaks ties on Recording ids, so they break in fixture id order, as in the
 * reference engine's golden data.
 */
export function fixtureRecordingId(fixtureId: string): string {
  return `00000000-0000-0000-0000-${fixtureId.padStart(12, '0')}`
}

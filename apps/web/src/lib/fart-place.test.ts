import { describe, expect, it } from 'vitest'
import { NOT_SAID, recordedInOf, recordedPlaceOf, recordedWhenAndWhere } from './fart-place'

const AUSTIN = { city: 'Austin', region: 'Texas', country: 'US', timeZone: 'America/Chicago' }

describe('recordedPlaceOf', () => {
  it('keeps the city, region, country and time zone, and nothing finer', () => {
    const place = recordedPlaceOf({
      city: 'Austin',
      region: 'Texas',
      regionCode: 'TX',
      country: 'US',
      timezone: 'America/Chicago',
      latitude: '30.27130',
      longitude: '-97.74260',
      postalCode: '78701',
      metroCode: '635',
      colo: 'DFW',
      asOrganization: 'Some ISP'
    })
    expect(place).toEqual(AUSTIN)
  })

  it('keeps nothing when the request names no country', () => {
    for (const cf of [
      undefined,
      null,
      'Austin',
      {},
      { city: 'Austin' },
      { city: 'Austin', country: '' },
      { country: 'T1' },
      { country: 'XX' }
    ]) {
      expect(recordedPlaceOf(cf)).toBeNull()
    }
  })

  it('keeps a country with no city', () => {
    expect(recordedPlaceOf({ country: 'FR', city: '', region: 7 })).toEqual({
      city: null,
      region: null,
      country: 'FR',
      timeZone: null
    })
  })
})

describe('recordedInOf', () => {
  const said = (place: Partial<typeof AUSTIN>) => recordedInOf({ ...AUSTIN, ...place }).recordedIn

  it('says the city and state in the US, and the city and country elsewhere', () => {
    expect(recordedInOf(AUSTIN)).toEqual({
      recordedIn: 'Austin, Texas',
      timeZone: 'America/Chicago'
    })
    expect(said({ city: 'Paris', region: 'Ile-de-France', country: 'FR' })).toBe('Paris, France')
  })

  it('says as much as it knows', () => {
    expect(said({ city: null as never })).toBe('Texas')
    expect(said({ city: null as never, region: null as never })).toBe('United States')
    expect(said({ city: 'Lyon', region: null as never, country: 'FR' })).toBe('Lyon, France')
    expect(said({ city: 'Singapore', country: 'SG' })).toBe('Singapore')
    expect(said({ city: 'Somewhere', country: 'not a code' })).toBe('Somewhere')
  })

  it('says nothing with no place, or none it can name', () => {
    expect(recordedInOf(null)).toEqual(NOT_SAID)
    expect(recordedInOf({ ...AUSTIN, city: null, country: 'not a code' })).toEqual(NOT_SAID)
  })
})

describe('recordedWhenAndWhere', () => {
  const at = Date.UTC(2026, 10, 6, 21, 12)

  it('says the time where it was made, with the place', () => {
    const said = recordedWhenAndWhere(at, {
      recordedIn: 'Austin, Texas',
      timeZone: 'America/Chicago'
    })
    expect(said).toContain('3:12')
    expect(said).toMatch(/2026.* · Austin, Texas$/)
    expect(
      recordedWhenAndWhere(at, { recordedIn: 'Tokyo, Japan', timeZone: 'Asia/Tokyo' })
    ).toContain('6:12')
  })

  it("says the viewer's own time with no place", () => {
    const own = new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    expect(recordedWhenAndWhere(at, NOT_SAID)).toBe(own)
  })

  it("falls back to the viewer's own time for a time zone it doesn't know", () => {
    const own = new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    expect(recordedWhenAndWhere(at, { recordedIn: 'Austin, Texas', timeZone: 'Not/AZone' })).toBe(
      `${own} · Austin, Texas`
    )
  })
})

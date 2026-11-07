import type { Database } from '@/db/database'
import { itemStatus, type Kind } from '@/db/library'
import {
  addReport,
  addShare,
  claimHandle,
  emailOf,
  giveSlug,
  handleOf,
  handleTaken,
  liveRecordingsOf,
  liveShares,
  removeShare,
  type SharedRecordingRow,
  type SharedTootRow,
  type ShareRow,
  sharedRecording,
  sharedToot,
  shareOf,
  sharesWithNoSlug,
  showsFartPlaces,
  type TootPlays,
  tootPlaysTakenDown,
  tootRecordingIds
} from '@/db/sharing'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { NOT_SAID, recordedInOf } from '@/lib/fart-place'
import { handleProblem, normalizeHandle, profilePath, suggestHandle } from '@/lib/handle'
import { noteName } from '@/lib/pitch'
import { formattedFartSeconds } from '@/lib/pitch-coverage'
import { type Recording, recordingName, type Trim } from '@/lib/recordings'
import { servedOrigin } from '@/lib/site'
import { slugify } from '@/lib/slug'
import {
  PAD_TOOT_TITLE,
  rollOfScore,
  type SharedFart,
  type SharedFartRow,
  type SharedTootParts,
  type TootRoll,
  tootRollOf
} from '@/lib/toot'
import { wavHeader } from '@/lib/wav'
import { finerBars, waveformLevels } from '@/lib/waveform'

import { consumeSlots, reporterLimitKey, requestClient, type SlotRule } from './auth-config'
import { type Stores, toRecording, wrongLibrary } from './library'
import { isItemId, readJson } from './library-input'
import { audioKey } from './media'
import { apiError, type SessionUser } from './require-user'
import { HEADER_BYTES, readWavHeader, wavHeaderOf } from './wav-header'

// Sharing (ADR 0020). The owner's routes, under `src/app/api/` with `userRoute`: their Handle, and
// sharing or stopping sharing one of their own Recordings or saved Toots. The public routes, under
// `src/app/[atHandle]/r/[id]/` for a Recording and `src/app/[atHandle]/t/[id]/` for a Toot: the
// shared page, its link image, audio and Report, which anyone with the link reaches, and which
// find the item only through a live share.

const notFound = () => apiError(404, 'not_found')

/**
 * What a link ends in: a slug, or a share's random id, as links did until #441. Either has this
 * shape. Longer than `slugify`'s longest, for its `-2`.
 */
const LINK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_LINK = 90

/**
 * A share's own id, kept from when links ended in it: 12 random characters of Crockford's lowercase
 * base 32 (60 bits), which says nothing about the item's own id.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, byte => ALPHABET[byte & 31]).join('')
}

/** Each kind's links: `r` for a Recording, `t` for a Toot. */
const LINK_SEGMENT: Record<Kind, string> = { recordings: 'r', toots: 't' }

/**
 * A shared item's page, under its owner's (#382): `/@<handle>/r/recording-3/` for a Recording, or
 * `/@<handle>/t/i-saw-three-ships/`.
 */
export function sharePath(kind: Kind, handle: string, slug: string): string {
  return `${profilePath(handle)}${LINK_SEGMENT[kind]}/${slug}/`
}

/**
 * A shared Toot's Song line, on its page and its owner's profile page: the Song's title, "Sound
 * Pad" for a Toot made on the Sound Pad, or null for a Song that isn't in Farty any more.
 */
export function tootSongTitle(songId: string | null): string | null {
  return songId === null ? PAD_TOOT_TITLE : (songIndex.find(s => s.id === songId)?.title ?? null)
}

/**
 * What a Toot's link is named after (#441): its Song, or its own title for a Sound Pad Toot or a
 * Song that isn't in Farty any more. Never the title of a Song's Toot, which only its owner chose.
 */
const tootSlug = ({ songId, title }: { songId: string | null; title: string }) =>
  slugify((songId !== null && tootSongTitle(songId)) || title, 'toot')

/**
 * Names the links of the user's shares that have no slug: a new one, or one from before #441,
 * which no migration could name since the Songs' titles are here, in the catalog. Oldest first, so
 * the first of a Song keeps its plain name.
 */
export async function giveSlugs(db: Database, userId: string): Promise<void> {
  const unnamed = await sharesWithNoSlug(db, userId)
  for (const { share, number, name } of unnamed.recordings) {
    await giveSlug(db, share, slugify(recordingName({ number, name }), 'recording'))
  }
  for (const { share, songId, title } of unnamed.toots) {
    await giveSlug(db, share, tootSlug({ songId, title }))
  }
}

/** A share's slug, naming the user's shares that have none when it's one of them. */
async function slugOf(db: Database, share: ShareRow): Promise<string> {
  if (share.slug !== null) return share.slug
  await giveSlugs(db, share.userId)
  return (await shareOf(db, share.userId, share.kind, share.itemId))?.slug ?? share.id
}

/**
 * The Handle and the name a link names, each lowercased, as every Handle, slug and random id is,
 * when the link has the shape of one, or else null. The shape only: a Handle the block list gained
 * since it was picked still finds its links.
 */
function linkNames(handle: string, link: string): { handle: string; link: string } | null {
  const lower = { handle: handle.toLowerCase(), link: link.toLowerCase() }
  return /^[a-z0-9_]{3,20}$/.test(lower.handle) &&
    lower.link.length <= MAX_LINK &&
    LINK.test(lower.link)
    ? lower
    : null
}

/**
 * `GET /api/handle/`: the user's Handle, or null and one to suggest, from their email if it's
 * free. `GET /api/handle/?check=<handle>`: whether a Handle can be used, `problem` null if so.
 */
export async function getHandle(db: Database, user: SessionUser, request: Request) {
  const check = new URL(request.url).searchParams.get('check')
  if (check !== null) {
    const handle = normalizeHandle(check)
    const problem = handleProblem(handle) ?? ((await handleTaken(db, handle)) ? 'taken' : null)
    return Response.json({ handle, problem })
  }
  const handle = await handleOf(db, user.id)
  if (handle !== null) return Response.json({ handle, suggestion: null })
  const email = await emailOf(db, user.id)
  const suggestion = email ? suggestHandle(email) : ''
  const free = suggestion !== '' && !(await handleTaken(db, suggestion))
  return Response.json({ handle: null, suggestion: free ? suggestion : '' })
}

/**
 * `PUT /api/handle/` with `{ handle }`: gives the user their Handle, once. 400 with the `problem`
 * when it can't be used, 409 `handle_taken` when someone has it, and 409 `has_handle`, with the
 * user's own, when they already have one.
 */
export async function putHandle(db: Database, user: SessionUser, request: Request) {
  const body = await readJson(request)
  if (body instanceof Response) return body
  const typed = (body.json as { handle?: unknown } | null)?.handle
  if (typeof typed !== 'string') return apiError(400, 'invalid_request')
  const handle = normalizeHandle(typed)
  const problem = handleProblem(handle)
  if (problem) return Response.json({ error: 'handle_unusable', problem }, { status: 400 })
  const claimed = await claimHandle(db, user.id, handle, new Date())
  if (claimed === 'taken') return apiError(409, 'handle_taken')
  if (claimed === 'hasOne') {
    return Response.json(
      { error: 'has_handle', handle: await handleOf(db, user.id) },
      { status: 409 }
    )
  }
  return Response.json({ handle }, { status: 201 })
}

/** `GET /api/share/`: the user's shared items that work, each with its link. */
export async function listShares(db: Database, user: SessionUser, request: Request) {
  const handle = await handleOf(db, user.id)
  let shares = handle === null ? [] : await liveShares(db, user.id)
  if (shares.some(share => share.slug === null)) {
    await giveSlugs(db, user.id)
    shares = await liveShares(db, user.id)
  }
  const origin = servedOrigin(request)
  return Response.json({
    handle,
    shares: shares.map(share => ({
      kind: share.kind,
      itemId: share.itemId,
      url: `${origin}${sharePath(share.kind, handle as string, share.slug ?? share.id)}`
    }))
  })
}

/**
 * `PUT /api/share/{kind}/{id}/`: shares the user's own item, or answers the link it already has.
 * 201 with `{ url }` for a new link, 200 for the same one again. 409 `no_handle` before the user
 * has a Handle, 404 when the item isn't in their account (not uploaded yet, or someone else's),
 * 410 when it's deleted and 403 `taken_down` when Farty took it down after a report, or, for a
 * Toot, took down a Recording it plays.
 */
export async function shareItem(
  kind: Kind,
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const handle = await handleOf(db, user.id)
  if (handle === null) return apiError(409, 'no_handle')
  const status = await itemStatus(db, kind, user.id, id)
  if (status === null) return notFound()
  if (status === 'deleted') return apiError(410, 'deleted')
  const existing = await shareOf(db, user.id, kind, id)
  if (existing?.takenDownAt) return apiError(403, 'taken_down')
  if (kind === 'toots' && (await tootPlaysTakenDown(db, user.id, id))) {
    return apiError(403, 'taken_down')
  }
  const { share, created } = existing
    ? { share: existing, created: false }
    : await addShare(db, {
        id: newShareId(),
        userId: user.id,
        kind,
        itemId: id,
        createdAt: new Date()
      })
  const url = `${servedOrigin(request)}${sharePath(kind, handle, await slugOf(db, share))}`
  return Response.json({ url }, { status: created ? 201 : 200 })
}

/**
 * `DELETE /api/share/{kind}/{id}/`: stops sharing the user's own item, so its link stops working.
 * 204 whether or not it was shared: the item isn't shared either way. Someone else's item is
 * never theirs to stop.
 */
export async function unshareItem(
  kind: Kind,
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  await removeShare(db, user.id, kind, id)
  return new Response(null, { status: 204 })
}

/** A shared Recording, as its page shows it: no account id, and its link's slug for its own. */
export type SharedRecording = {
  handle: string
  /** What its link ends in. */
  slug: string
  recording: Recording
}

/**
 * The Recording shared at `/@<handle>/r/<link>/`, by its slug or its old random id, or null: not
 * shared, stopped, taken down, deleted, or the account deleted all look the same.
 */
export async function findSharedRecording(
  db: Database,
  handle: string,
  link: string
): Promise<(SharedRecording & { row: SharedRecordingRow }) | null> {
  const names = linkNames(handle, link)
  if (names === null) return null
  const row = await sharedRecording(db, names.handle, names.link)
  if (!row) return null
  const { audioBytes: _, ...recording } = toRecording(row.recording)
  const slug = await slugOf(db, row.share)
  return { handle: row.handle, slug, recording: { ...recording, id: slug }, row }
}

/** A shared Toot, as its page shows it: its title, Song and length, and nothing private. */
export type SharedToot = {
  handle: string
  /** What its link ends in. */
  slug: string
  title: string
  /** The catalog Song it plays, or null for a Sound Pad Toot (ADR 0017). */
  songId: string | null
  seconds: number
}

/**
 * The saved Toot shared at `/@<handle>/t/<link>/`, or null, as `findSharedRecording`: not shared,
 * stopped, taken down, never saved, deleted, or the account deleted all look the same.
 */
export async function findSharedToot(
  db: Database,
  handle: string,
  link: string
): Promise<(SharedToot & { row: SharedTootRow }) | null> {
  const names = linkNames(handle, link)
  if (names === null) return null
  const row = await sharedToot(db, names.handle, names.link)
  if (!row) return null
  const { title, songId, seconds } = row.toot
  return { handle: row.handle, slug: await slugOf(db, row.share), title, songId, seconds, row }
}

/** A shared Toot's audio in R2: its saved WAV. */
export const sharedTootKey = ({ row }: { row: SharedTootRow }) =>
  audioKey(row.share.userId, 'toots', row.toot.id)

/**
 * The part of a shared Recording its link serves, and its page draws: the handles of its stored
 * Trim, whenever it has one, or else the whole take. Unlike `playedPart`, a stored Trim counts
 * whatever analysis found, so a Re-scan that finds a pitch never makes the audio its owner cut
 * off public.
 */
export function sharedPart(recording: Recording): Trim {
  const trim = recording.trim
  return trim
    ? { startSeconds: trim.startSeconds, endSeconds: trim.endSeconds }
    : { startSeconds: 0, endSeconds: recording.seconds }
}

/**
 * What a shared Toot's row, and a shared Recording's profile page row (#448), plays and draws:
 * only the fart. That's the fart between its Trim's handles, or what analysis found. The rest of
 * a take is whatever else the microphone heard, and sharing a Toot doesn't share that. Null
 * before analysis has found it, when there's nothing to play.
 */
export function tootFartPart({ trim, analysis }: Recording): Trim | null {
  const fart = trim
    ? trim.fart
    : analysis.state === 'analyzed'
      ? {
          startSeconds: analysis.analysis.gestureStartSeconds,
          endSeconds: analysis.analysis.gestureEndSeconds
        }
      : null
  if (!fart) return null
  const startSeconds = Math.max(fart.startSeconds, trim?.startSeconds ?? 0)
  const endSeconds = Math.min(fart.endSeconds, trim?.endSeconds ?? Number.POSITIVE_INFINITY)
  return endSeconds > startSeconds ? { startSeconds, endSeconds } : null
}

/** A shared Recording's fart, as its profile page row plays it and its own page prints it. */
export type RecordingFart = {
  /** The fart, in seconds of the whole take. */
  inTake: Trim
  /** The fart, in seconds of the audio its link serves, which starts at `sharedPart`'s start. */
  part: Trim
  /** "1.1 s": how long `part` lasts, rounded down as fart lengths are (`formattedFartSeconds`). */
  length: string
}

/**
 * A shared Recording's fart (#450): `tootFartPart` inside what its link serves, or all of that
 * when analysis hasn't found a fart between its Trim's handles. Its length is that span's, so its
 * profile page row never prints one length and plays another, and its own page prints the same.
 */
export function recordingFart(recording: Recording): RecordingFart {
  const served = sharedPart(recording)
  const inTake = tootFartPart(recording) ?? served
  return {
    inTake,
    part: {
      startSeconds: inTake.startSeconds - served.startSeconds,
      endSeconds: inTake.endSeconds - served.startSeconds
    },
    length: formattedFartSeconds(inTake.endSeconds - inTake.startSeconds)
  }
}

/** The bars of a whole take's `waveform` that fall in `part`. */
export function partBars(waveform: number[], seconds: number, part: Trim): number[] {
  if (waveform.length === 0 || seconds <= 0) return waveform
  const from = Math.floor((part.startSeconds / seconds) * waveform.length)
  const to = Math.ceil((part.endSeconds / seconds) * waveform.length)
  const bars = waveform.slice(Math.max(0, from), Math.max(from + 1, to))
  return bars.length > 0 ? bars : waveform
}

/**
 * How many loudness bars a fart's row draws, as Song Creator's do, however short the fart: a few
 * stored bars across its 72 px would draw as round blobs (#451).
 */
const FART_ROW_BARS = 16

/** `levels` in at most `count` bars, each the loudest it covers. */
function fewerBars(levels: number[], count: number): number[] {
  if (levels.length <= count) return levels
  return Array.from({ length: count }, (_, bar) =>
    Math.max(
      ...levels.slice(
        Math.floor((bar * levels.length) / count),
        Math.floor(((bar + 1) * levels.length) / count)
      )
    )
  )
}

/** How long a tap is drawn, in seconds, when its fart's length isn't known: deleted, or not found. */
const UNKNOWN_TAP_SECONDS = 0.25

/**
 * What a shared Toot's page shows of what it's made of: its roll, and each fart it plays by its
 * place in `tootRecordingIds`, so no Recording's id leaves the server. Call it only for a share
 * found in D1 (`findSharedToot`).
 */
export async function sharedTootParts(
  db: Database,
  { row: { share, toot } }: { row: SharedTootRow }
): Promise<SharedTootParts> {
  const ids = tootRecordingIds(toot)
  const found = await liveRecordingsOf(db, share.userId, ids)
  const live = new Map(found.map(row => [row.id, toRecording(row)]))
  const places = new Map(found.map(row => [row.id, row.place]))
  const showPlaces = await showsFartPlaces(db, share.userId)
  const fartOf = (id: string): SharedFart | null => {
    const recording = live.get(id)
    if (!recording) return null
    const part = tootFartPart(recording)
    return {
      ...(showPlaces ? recordedInOf(places.get(id) ?? null) : NOT_SAID),
      place: ids.indexOf(id),
      name: recordingName(recording),
      length: part ? formattedFartSeconds(part.endSeconds - part.startSeconds) : '',
      levels: part
        ? finerBars(
            fewerBars(partBars(recording.waveform, recording.seconds, part), FART_ROW_BARS),
            FART_ROW_BARS
          )
        : [],
      recordedAt: recording.createdAt,
      playable: part !== null
    }
  }

  if (toot.performance) {
    const { recordings: farts, taps } = toot.performance
    const tapSeconds = farts.map(id => {
      const recording = live.get(id)
      const part = recording ? tootFartPart(recording) : null
      return part ? part.endSeconds - part.startSeconds : UNKNOWN_TAP_SECONDS
    })
    return {
      song: {
        // A beat is a second, so each tap's beat is when it was played.
        bpm: 60,
        length_beats: toot.seconds,
        notes: taps.map(([at, lane]) => ({
          start: at,
          dur: Math.max(0, Math.min(tapSeconds[lane], toot.seconds - at)),
          pitch: lane
        })),
        pitches: farts.map((_, lane) => lane)
      },
      catalogSong: null,
      transposition: 0,
      lanes: true,
      rows: tootFartRows(toot, null).map(({ recordingId, ...row }) => ({
        plays: null,
        ...row,
        fart: fartOf(recordingId)
      }))
    }
  }

  const transposition = toot.arrangement?.transposition ?? 0
  const { song, catalogSong } = arrangedRoll(toot)
  const rows: SharedFartRow[] = tootFartRows(toot, song?.pitches ?? null).map(
    ({ recordingId, ...row }) => ({
      plays: noteName(row.pitch + transposition),
      ...row,
      fart: fartOf(recordingId)
    })
  )
  return { song, catalogSong, transposition, lanes: false, rows }
}

/** The pitches a Song Toot's farts play, lowest first. */
const playedPitches = (toot: TootPlays) =>
  Object.keys(toot.arrangement?.recordingForPitch ?? {})
    .map(Number)
    .sort((a, b) => a - b)

/** A Song Toot's roll: its score or catalog Song, and the pitches it plays. No lookup needed. */
function arrangedRoll(toot: SharedTootRow['toot']): TootRoll {
  const song = toot.score ? rollOfScore(toot.score) : null
  const catalogSong = song ? null : (songIndex.find(s => s.id === toot.songId) ?? null)
  return { song, catalogSong, played: playedPitches(toot) }
}

/** A row of a Toot's "Recordings used" before its fart is looked up: the Recording it plays. */
export type TootFartRow = Pick<SharedFartRow, 'pitch' | 'colorIndex'> & { recordingId: string }

/**
 * A Toot's "Recordings used" rows, in order, a deleted Recording's too: a Sound Pad Toot's one per
 * lane, colored by its lane; a Song Toot's one per pitch a fart plays, lowest first, colored by
 * its place among the Song's pitches, lowest first: `scorePitches`, the notes it saved
 * (`rollOfScore`), else its catalog Song's, else the ones played. Its shared page and its row's
 * dots on its owner's profile page (#457) both come from this, so their colors match.
 */
export function tootFartRows(
  toot: TootPlays & Pick<SharedTootRow['toot'], 'songId'>,
  scorePitches: readonly number[] | null
): TootFartRow[] {
  if (toot.performance) {
    return toot.performance.recordings.map((recordingId, lane) => ({
      pitch: lane,
      colorIndex: lane,
      recordingId
    }))
  }
  const recordingForPitch = toot.arrangement?.recordingForPitch ?? {}
  const played = playedPitches(toot)
  const pitches = scorePitches ?? songIndex.find(s => s.id === toot.songId)?.pitches ?? played
  return played.map(pitch => ({
    pitch,
    colorIndex: Math.max(0, pitches.indexOf(pitch)),
    recordingId: recordingForPitch[pitch]
  }))
}

/**
 * A shared Toot's roll, as `tootRollOf(sharedTootParts(…))`, without its farts' lookups for a Song
 * Toot. A Sound Pad Toot's notes last as long as its farts, so it still looks them up.
 */
export async function sharedTootRoll(
  db: Database,
  shared: { row: SharedTootRow }
): Promise<TootRoll> {
  const { toot } = shared.row
  return toot.performance ? tootRollOf(await sharedTootParts(db, shared)) : arrangedRoll(toot)
}

/**
 * Where the shared audio's copy is kept in this data center's cache: by its R2 key, which is
 * written once, and for a Recording the part of it served, so a changed Trim never serves the old
 * cut. A Toot's is its whole WAV.
 */
export const sharedAudioCacheKey = (request: Request, key: string, part?: Trim) =>
  new Request(
    new URL(
      part
        ? `/__shared-audio/${key}?from=${part.startSeconds}&to=${part.endSeconds}`
        : `/__shared-audio/${key}`,
      request.url
    )
  )

/** The Workers cache, where there is one (not in `next dev`). */
function workersCache(): Cache | null {
  return typeof caches !== 'undefined' && 'default' in caches
    ? (caches as unknown as { default: Cache }).default
    : null
}

/**
 * The frames `[start, end)` of a take of `frames` at `sampleRate` that `part` covers, each end at
 * its nearest frame: at least one.
 */
export function partFrames(
  part: Trim,
  sampleRate: number,
  frames: number
): { start: number; end: number } {
  const start = Math.min(frames - 1, Math.max(0, Math.round(part.startSeconds * sampleRate)))
  const end = Math.min(frames, Math.max(start + 1, Math.round(part.endSeconds * sampleRate)))
  return { start, end }
}

/**
 * The part of the WAV at `key` that `part` covers, as a WAV of its own: a plain cut of its frames,
 * read from R2 as a range, under a fresh header. Nothing outside `part` is read. Null when the
 * object is gone or isn't a WAV as Farty writes one.
 */
async function cutWav(
  media: R2Bucket,
  key: string,
  part: Trim
): Promise<{ bytes: Uint8Array<ArrayBuffer>; etag: string } | null> {
  const head = await media.get(key, { range: { offset: 0, length: HEADER_BYTES } })
  if (!head) return null
  const header = wavHeaderOf(new Uint8Array(await head.arrayBuffer()), head.size)
  if (!header) return null
  const { start, end } = partFrames(part, header.sampleRate, header.frames)
  const length = (end - start) * 2
  const body = await media.get(key, { range: { offset: HEADER_BYTES + start * 2, length } })
  if (!body) return null
  const bytes = new Uint8Array(HEADER_BYTES + length)
  bytes.set(wavHeader(header.sampleRate, length))
  bytes.set(new Uint8Array(await body.arrayBuffer()), HEADER_BYTES)
  return { bytes, etag: await partEtag(body.etag, start, end) }
}

/** A part's ETag: it changes with the part, and doesn't say where in its take the part sits. */
async function partEtag(objectEtag: string, start: number, end: number): Promise<string> {
  const name = new TextEncoder().encode(`${objectEtag}-${start}-${end}`)
  const hash = await crypto.subtle.digest('SHA-256', name)
  return `"${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')}"`
}

/** Shared audio, as it's served: a WAV's bytes or stream, its size and its ETag. */
type SharedWav = { body: BodyInit; size: number; etag: string }

/**
 * `GET /@<handle>/r/<id>/audio/` and `GET /@<handle>/t/<id>/audio/`: a shared item's audio, for
 * anyone with the link. A Recording's is the part its page plays (`sharedPart`) as a WAV of its
 * own, and the rest of the take is never served. A Toot's is its saved WAV, whole and as stored.
 * Every request checks the share in D1 first, so a link that stopped working never plays, then the
 * WAV comes from this data center's cache, or from R2 into it. The browser revalidates every time
 * (`no-cache`, with the ETag), and nothing between keeps it (`private`), so a link taken down is
 * down at once.
 */
export async function sharedAudio(
  kind: Kind,
  { db, media }: Stores,
  request: Request,
  handle: string,
  link: string
): Promise<Response> {
  if (kind === 'toots') {
    const shared = await findSharedToot(db, handle, link)
    if (!shared) return apiError(404, 'not_found')
    const key = sharedTootKey(shared)
    return cachedAudio(request, sharedAudioCacheKey(request, key), async () => {
      const object = await media.get(key)
      return object && { body: object.body, size: object.size, etag: object.httpEtag }
    })
  }
  const shared = await findSharedRecording(db, handle, link)
  if (!shared) return apiError(404, 'not_found')
  const { share, recording } = shared.row
  return recordingPartAudio(
    media,
    request,
    share.userId,
    recording.id,
    sharedPart(toRecording(recording))
  )
}

/** `part` of a Recording, as a WAV of its own (`cachedAudio`). */
function recordingPartAudio(
  media: R2Bucket,
  request: Request,
  userId: string,
  recordingId: string,
  part: Trim
): Promise<Response> {
  const key = audioKey(userId, 'recordings', recordingId)
  return cachedAudio(request, sharedAudioCacheKey(request, key, part), async () => {
    const cut = await cutWav(media, key, part)
    return cut && { body: cut.bytes, size: cut.bytes.byteLength, etag: cut.etag }
  })
}

/** A fart's place in a shared Toot's list, as its audio's path says it. */
const FART_PLACE = /^\d{1,3}$/

/**
 * `GET /@<handle>/t/<link>/farts/<place>/audio/`: one fart a shared Toot plays, by its place in
 * `tootRecordingIds`, for anyone with the Toot's link. Only the fart, never the rest of its take
 * (`tootFartPart`). The Toot's share is checked in D1 first, so it stops with the link. A Recording
 * since deleted answers 404, though the Toot's own audio still plays it, and so does one whose fart
 * analysis hasn't found.
 */
export async function sharedFartAudio(
  { db, media }: Stores,
  request: Request,
  handle: string,
  link: string,
  place: string
): Promise<Response> {
  if (!FART_PLACE.test(place)) return notFound()
  const shared = await findSharedToot(db, handle, link)
  if (!shared) return notFound()
  const { share, toot } = shared.row
  const id = tootRecordingIds(toot)[Number(place)]
  if (id === undefined) return notFound()
  const [row] = await liveRecordingsOf(db, share.userId, [id])
  if (!row) return notFound()
  const part = tootFartPart(toRecording(row))
  if (!part) return notFound()
  return recordingPartAudio(media, request, share.userId, row.id, part)
}

/**
 * The WAV kept at `cacheKey` in this data center's cache, or else `read`'s, kept there for next
 * time, answered as `sharedAudio` says: `private, no-cache` with its ETag, and 304 when the browser
 * has it. 404 when `read` finds nothing.
 */
async function cachedAudio(
  request: Request,
  cacheKey: Request,
  read: () => Promise<SharedWav | null>
): Promise<Response> {
  const cache = workersCache()
  let copy = await cache?.match(cacheKey)
  if (!copy) {
    const wav = await read()
    if (!wav) return apiError(404, 'not_found')
    copy = new Response(wav.body, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.size),
        ETag: wav.etag,
        'Cache-Control': 'public, max-age=86400'
      }
    })
    await cache?.put(cacheKey, copy.clone())
  }
  const etag = copy.headers.get('ETag') ?? ''
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
  if (etag && request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(copy.body, {
    headers: {
      ...headers,
      'Content-Type': 'audio/wav',
      'Content-Length': copy.headers.get('Content-Length') ?? ''
    }
  })
}

/** How many loudness bars a shared Toot's page and link image draw. */
export const SHARED_TOOT_BARS = 60

/** At most about this many frames are read for a Toot's bars; a longer one is read every few. */
const LEVEL_FRAMES = 480_000

/**
 * The loudness bars of a shared Toot's saved WAV at `key` (`sharedTootKey`), each 0…1, for its
 * page and link image: from this data center's cache, or read from R2 into it, since the WAV at a
 * key never changes. Flat when the audio is gone. Call it only for a share found in D1
 * (`findSharedToot`). A Toot longer than `LEVEL_FRAMES` is read every few frames, which draws the
 * same bars for a fraction of the work. `origin` is the site's, which the cache keys it under.
 */
export async function sharedTootLevels(
  media: R2Bucket,
  key: string,
  origin: string
): Promise<number[]> {
  const flat = Array<number>(SHARED_TOOT_BARS).fill(0.05)
  const cache = workersCache()
  const cacheKey = new Request(new URL(`/__shared-levels/${key}?bars=${SHARED_TOOT_BARS}`, origin))
  const kept = await cache?.match(cacheKey)
  if (kept) return (await kept.json()) as number[]
  const object = await media.get(key)
  if (!object) return flat
  const bytes = new Uint8Array(await object.arrayBuffer())
  const header = readWavHeader(bytes)
  if (!header) return flat
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset + HEADER_BYTES, header.frames)
  const step = Math.max(1, Math.floor(header.frames / LEVEL_FRAMES))
  const levels = waveformLevels(samples, SHARED_TOOT_BARS, step)
  await cache?.put(
    cacheKey,
    Response.json(levels, { headers: { 'Cache-Control': 'public, max-age=86400' } })
  )
  return levels
}

/** A shared Toot's row on its owner's profile page (#448, #451): its waveform's bars. */
export type ProfileTootRow = { levels: number[] }

/**
 * `GET /@<handle>/t/<id>/row/`: what a shared Toot's row on its owner's profile page draws (#448),
 * for anyone with the link: its loudness bars (`sharedTootLevels`). Each row fetches its own once
 * it's on screen, so the page never reads every Toot's WAV. The share is checked in D1 first, as
 * its audio's is, and nothing between keeps it, so a link taken down is down at once.
 */
export async function sharedTootRow(
  { db, media }: Stores,
  request: Request,
  handle: string,
  link: string
): Promise<Response> {
  const shared = await findSharedToot(db, handle, link)
  if (!shared) return apiError(404, 'not_found')
  const levels = await sharedTootLevels(media, sharedTootKey(shared), servedOrigin(request))
  const drawn: ProfileTootRow = { levels }
  return Response.json(drawn, { headers: { 'Cache-Control': 'private, no-cache' } })
}

/**
 * How many reports Farty keeps, each a row in `rate_limit` (`consumeSlots`), for Recordings and
 * Toots alike: a few per reporter an hour, so one client can't spend the site's; a few per item a
 * day, since one is enough for Farty to look, and stopping and sharing it again doesn't start
 * them over; and a cap for the whole site, so a script can't fill D1. A report spends a slot of
 * each only when all three have one, so a refused report never spends a link's.
 */
export const REPORT_LIMITS = {
  perReporter: { window: 60 * 60, max: 10 },
  perItem: { window: 24 * 60 * 60, max: 5 },
  siteWide: { window: 60 * 60, max: 300 }
} satisfies Record<string, SlotRule>

/** The site's one row for Reports. */
export const SITE_REPORTS_KEY = 'share_report'

/** A shared item's row for Reports, whichever link it's shared under: its owner's and own id. */
export const itemReportsKey = (share: { userId: string; kind: Kind; itemId: string }) =>
  `share_report_item|${share.userId}|${share.kind}|${share.itemId}`

/**
 * `POST /@<handle>/r/<id>/report/` and `POST /@<handle>/t/<id>/report/`: anyone's report of a
 * shared Recording or Toot, from its page. It keeps a row in `share_reports` naming the share and
 * the item, never the reporter, and logs `share_reported` with the link's id and kind, for Farty
 * to check (docs/agents/web.md). 204 once kept; 403
 * from another site, 404 when the link doesn't work, 429 `too_many_reports` past any of
 * `REPORT_LIMITS`. The reporter's limit is keyed by an HMAC of their `cf-connecting-ip` under
 * `secret`, never the address.
 */
export async function reportShare(
  kind: Kind,
  { db }: Stores,
  request: Request,
  handle: string,
  link: string,
  secret: string
): Promise<Response> {
  if (request.headers.get('origin') !== servedOrigin(request)) {
    return apiError(403, 'cross_origin')
  }
  const share = await liveShare(kind, db, handle, link)
  if (!share) return apiError(404, 'not_found')
  const now = Date.now()
  const allowed = await consumeSlots(
    db.$client,
    [
      {
        key: await reporterLimitKey(secret, requestClient(request)),
        rule: REPORT_LIMITS.perReporter
      },
      { key: itemReportsKey(share), rule: REPORT_LIMITS.perItem },
      { key: SITE_REPORTS_KEY, rule: REPORT_LIMITS.siteWide }
    ],
    now
  )
  if (!allowed) return apiError(429, 'too_many_reports')
  await addReport(db, share, crypto.randomUUID(), new Date(now))
  console.warn(JSON.stringify({ event: 'share_reported', shareId: share.id, kind }))
  return new Response(null, { status: 204 })
}

/** The live share of a `kind` item at a link, while its item is live too, or null. */
async function liveShare(
  kind: Kind,
  db: Database,
  handle: string,
  link: string
): Promise<ShareRow | null> {
  const shared =
    kind === 'toots'
      ? await findSharedToot(db, handle, link)
      : await findSharedRecording(db, handle, link)
  return shared?.row.share ?? null
}

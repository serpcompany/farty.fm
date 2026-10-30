'use client'

import { Check, ChevronLeft, CircleAlert, Play, Square, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { libraryOwner } from '@/lib/account'
import type { Song } from '@/lib/catalog/song'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import { TOOT_PRICE_LABEL } from '@/lib/pricing'
import * as store from '@/lib/recording-store'
import { type Recording, recordingName, songPitch } from '@/lib/recordings'
import { holdReload } from '@/lib/stale-build'
import { reportError } from '@/lib/telemetry/errors'
import {
  noteCaption,
  type SongToot,
  type SongTootDraft,
  soundingPitch,
  type TootDraft
} from '@/lib/toot'
import {
  type CheckoutReturn,
  clearCheckoutReturn,
  paidReturnPath,
  readCheckoutReturn,
  saveAsksForPayment,
  startCheckout,
  waitUntilPaid
} from '@/lib/toot-payment'
import { TootError } from '@/lib/toot-renderer'
import { cn } from '@/lib/utils'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { useAccount } from './account-provider'
import { NoteView, pitchColor } from './note-view'
import { tootPlayback, usePedos } from './pedos-provider'
import { previousPage } from './previous-page'
import { Waveform } from './waveform'

type Phase =
  | { kind: 'making' }
  | { kind: 'ready'; draft: SongTootDraft; back: CheckoutReturn | null }
  | { kind: 'locked' }
  | { kind: 'failed' }

/**
 * Song Creator: hear an Unlocked Song played by your Recordings, and keep it as a Toot. It's not
 * an editor: nothing here changes the Arrangement (ADR 0005). As the iPhone app's
 * `SongCreatorView`.
 */
export function SongCreator({ song }: { song: Song }) {
  const pedos = usePedos()
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'making' })
  /** Bumped by Try again, to make the Toot again. */
  const [attempt, setAttempt] = useState(0)
  const loaded = pedos.recordings !== null

  // Back from Checkout, the same Toot is made again, with the id it was paid for (ADR 0010).
  const make = useEffectEvent(async () => {
    const back = readCheckoutReturn()
    return { draft: await pedos.makeToot(song, back?.tootId), back }
  })
  const playOnce = useEffectEvent((draft: TootDraft) => {
    // A page opened from a link or a reload can't start sound before a tap.
    if (navigator.userActivation?.hasBeenActive ?? true) pedos.toggleTootPlayback(draft)
  })

  // Makes the Toot once the Recordings have loaded, then plays it once. Leaving the screen
  // before it's made drops it; coming back makes it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what Try again changes.
  useEffect(() => {
    if (!loaded) return
    let left = false
    make().then(
      ({ draft, back }) => {
        if (left) return
        setPhase({ kind: 'ready', draft, back })
        // Back from Checkout, the Toot was heard already: it waits for a tap.
        if (!back) playOnce(draft)
      },
      error => {
        const locked = error instanceof TootError && error.reason === 'locked'
        // "Couldn't make this Toot": reported by the error that caused it, such as a decode.
        if (!locked)
          reportError(
            'toot-make-failed',
            error instanceof TootError ? (error.cause ?? error) : error
          )
        if (left) return
        setPhase({ kind: locked ? 'locked' : 'failed' })
      }
    )
    return () => {
      left = true
    }
  }, [loaded, attempt])

  const { stopPlayback, forgetToot } = pedos
  useEffect(() => stopPlayback, [stopPlayback])
  const draftId = phase.kind === 'ready' ? phase.draft.id : null
  useEffect(() => {
    if (draftId) return () => forgetToot(draftId)
  }, [draftId, forgetToot])

  return (
    <div className="flex flex-1 flex-col">
      <header className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 px-2 pt-2 pb-3">
        {/* Back to the Compose it came from, or in its place, so the system Back never opens
            this Toot again. */}
        <Link
          href="/compose/"
          replace
          onClick={event => {
            if (previousPage()?.replace(/\/$/, '') !== '/compose') return
            event.preventDefault()
            router.back()
          }}
          aria-label="Back to Compose"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11')}
        >
          <ChevronLeft className="size-6" />
        </Link>
        <div className="min-w-0 text-center">
          <h1 className="truncate font-semibold">{song.title}</h1>
          <p className="truncate text-xs text-muted-foreground">{song.source}</p>
        </div>
      </header>

      {phase.kind === 'making' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Spinner className="size-6" />
          <p>Making your Toot…</p>
        </div>
      )}
      {phase.kind === 'locked' && (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          This Song is locked. Record the notes it needs to unlock it.
        </p>
      )}
      {phase.kind === 'failed' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-muted-foreground">Couldn't make this Toot.</p>
          <Button
            variant="outline"
            className="h-11 px-5 text-base"
            onClick={() => {
              setPhase({ kind: 'making' })
              setAttempt(a => a + 1)
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {phase.kind === 'ready' && <Ready draft={phase.draft} back={phase.back} />}
    </div>
  )
}

/** What Save says when it didn't save the Toot. */
const SAVE_PROBLEMS = {
  saveFailed: "Couldn't save this Toot.",
  unavailable: "Payments aren't available right now.",
  limitReached: "You've kept as many Toots as an account can. Delete one to save this one.",
  charged: (
    <>
      You were charged, but this Toot couldn't be saved.{' '}
      <Link href="/support/" className="underline">
        Contact support
      </Link>{' '}
      for a refund.
    </>
  ),
  tooMany: "You've started a lot of payments. Try again later.",
  failed: "Couldn't start the payment.",
  notPaidYet: "Your payment hasn't come through yet. Tap Save to check again.",
  notKept: "This take can't be saved in this browser: it can't keep the take while you pay.",
  unreachable: "Couldn't reach your account. Tap Save to try again."
}

/** Whether this browser's library is an account's (`libraryOwner`), when storage can be read. */
function heldByAnAccount(): boolean {
  try {
    return libraryOwner() !== null
  } catch {
    return false
  }
}

/** The made Toot of a Song, with Save to Toots pinned above the tabs. */
export function Ready({ draft, back }: { draft: SongTootDraft; back: CheckoutReturn | null }) {
  return (
    <>
      <TootLayout toot={draft} song={draft.song} />
      <SaveToToots draft={draft} back={back} />
    </>
  )
}

/**
 * Save to Toots, pinned above the tabs, for a made Toot: of a Song (Song Creator), or of a Sound
 * Pad Performance (the Sound Pad, ADR 0017). Saving needs an account everywhere (#237): a guest's
 * Save opens the account step first, and carries on once it signs in. Where saving is paid
 * (ADR 0010), Save goes to Checkout for this Toot; back from Checkout, it saves the Toot once the
 * server says it's paid. A Toot of this Song paid for and never saved is saved instead of paying
 * again. Where it's free, Save saves, offline too in an account's browser.
 *
 * `keep`, before Checkout, keeps what makes the Toot again back from it (the Sound Pad's take):
 * false when this browser can't, and then Checkout isn't started, so nothing is paid for that
 * can't be saved.
 */
export function SaveToToots({
  draft,
  back,
  keep: keepForCheckout
}: {
  draft: TootDraft
  back: CheckoutReturn | null
  keep?: () => boolean
}) {
  const pedos = usePedos()
  const { account, stepOpen, openStep, retry } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const isPaid = saveAsksForPayment()
  const isSaved = pedos.toot(draft.id) !== undefined
  const returnedPaid = isPaid && back?.done === true && back.tootId === draft.id
  const [busy, setBusy] = useState<'saving' | 'paying' | 'confirming' | null>(null)
  const [problem, setProblem] = useState<keyof typeof SAVE_PROBLEMS | null>(null)
  /** Save opened the account step: once it signs in, on to Checkout, or to saving. */
  const [savesAfterSignIn, setSavesAfterSignIn] = useState(false)
  /** A second tap, before the first one's answer, starts nothing. */
  const paying = useRef(false)
  // A new build's reload waits while this Toot is unsaved (`stale-build.ts`, #222).
  useEffect(() => (isSaved ? undefined : holdReload()), [isSaved])

  /** Saves the Toot. True once it's saved. */
  const save = async (): Promise<boolean> => {
    setBusy('saving')
    setProblem(null)
    try {
      await pedos.saveToot(draft)
      return true
    } catch (error) {
      reportError('toot-save-failed', error)
      setProblem('saveFailed')
      return false
    } finally {
      setBusy(null)
    }
  }

  const pay = async (accountId: string) => {
    if (paying.current) return
    if (keepForCheckout && !keepForCheckout()) {
      setProblem('notKept')
      return
    }
    paying.current = true
    setBusy('paying')
    setProblem(null)
    const checkout = await startCheckout(draft.id, draft.song?.id ?? null, accountId)
    if (checkout.kind === 'pay') {
      // Off to Checkout: Save stays busy while the page goes.
      window.location.assign(checkout.url)
      return
    }
    if (checkout.kind === 'paidToot' && draft.song) {
      // That Toot is made again and saved, as back from its Checkout. This one is left unpaid.
      window.location.replace(paidReturnPath(draft.song.id, checkout.tootId))
      return
    }
    paying.current = false
    setBusy(null)
    if (checkout.kind === 'paid') {
      if (await save()) clearCheckoutReturn()
    } else setProblem(checkout.kind === 'failed' ? checkout.problem : 'failed')
  }
  /** Saves the Toot, paying first where saving is paid. */
  const keep = (accountId: string) => void (isPaid ? pay(accountId) : save())
  const keepAfterSignIn = useEffectEvent(keep)

  const tapSave = () => {
    if (accountId) keep(accountId)
    else if (account.status === 'signedOut' || account.status === 'expired') {
      setSavesAfterSignIn(true)
      openStep()
    } else if (account.status === 'unreachable' && !isPaid && heldByAnAccount()) {
      // Offline, in a browser whose library is an account's: a free Toot saves here and uploads
      // once the account can be read, as before #237.
      void save()
    } else if (account.status === 'unreachable') {
      // The session couldn't be read, so it isn't known who is paying, or whether there's an
      // account: read it again. Back from Checkout, the Toot then saves by itself.
      setProblem(returnedPaid ? null : 'unreachable')
      retry()
    } else {
      // The session is still being read.
      setProblem(isPaid ? 'failed' : 'saveFailed')
    }
  }

  // The account is back: Save can pay.
  useEffect(() => {
    if (accountId) setProblem(current => (current === 'unreachable' ? null : current))
  }, [accountId])

  // The account step that Save opened: signed in, on to Checkout or saving; Not now saves nothing.
  useEffect(() => {
    if (!savesAfterSignIn) return
    if (accountId) {
      setSavesAfterSignIn(false)
      keepAfterSignIn(accountId)
    } else if (!stepOpen) setSavesAfterSignIn(false)
  }, [savesAfterSignIn, accountId, stepOpen])

  // Back to this page from Checkout's with the browser's Back, Save can be tapped again.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      paying.current = false
      setBusy(null)
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [])

  // Back from Checkout for this Toot: saved once it's paid, which Stripe usually says at once. A
  // paid Toot is saved even if the screen has been left meanwhile. Until it's saved, the address
  // keeps the return, so a reload makes the same Toot and checks again.
  const confirm = useEffectEvent(async (accountId: string) => {
    setBusy('confirming')
    const paid = await waitUntilPaid(draft.id, accountId)
    setBusy(null)
    if (!paid) setProblem('notPaidYet')
    else if (await save()) clearCheckoutReturn()
  })
  // The account isn't read yet: the confirming waits for it. If it can't be read, Save reads it
  // again, rather than waiting for the browser to come online.
  const waitsForAccount =
    returnedPaid && !isSaved && busy === null && problem === null && account.status === 'checking'
  const shownProblem =
    problem ??
    (returnedPaid && !isSaved && busy === null && account.status === 'unreachable'
      ? 'unreachable'
      : null)
  const confirming = useRef(false)
  useEffect(() => {
    if (!returnedPaid || !accountId || confirming.current) return
    confirming.current = true
    void confirm(accountId)
  }, [returnedPaid, accountId])
  // Back from a cancelled Checkout: the address is Song Creator's own again.
  useEffect(() => {
    if (back && !back.done) clearCheckoutReturn()
  }, [back])

  return (
    <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] mt-auto md:bottom-0 bg-linear-to-t from-background from-70% to-transparent px-5 pt-5 pb-3">
      <Button
        className="h-12 w-full text-base"
        disabled={isSaved || busy !== null || waitsForAccount}
        onClick={tapSave}
      >
        {isSaved ? (
          <>
            <Check className="size-5" />
            Saved to Toots
          </>
        ) : busy === 'confirming' || waitsForAccount ? (
          <>
            <Spinner className="size-5" />
            Confirming payment…
          </>
        ) : isPaid ? (
          `Save to Toots · ${TOOT_PRICE_LABEL}`
        ) : (
          'Save to Toots'
        )}
      </Button>
      {shownProblem && (
        <p className="pt-2 text-center text-sm text-muted-foreground">
          {SAVE_PROBLEMS[shownProblem]}
        </p>
      )}
    </div>
  )
}

/** A Recording's notes (by the Song pitch it plays), or one note, stand out. */
type Focus = { pitch: number } | { note: number } | null

/**
 * What Song Creator and a Toot's screen share: Play, the note view, and the Recordings used. Tap a
 * Recording to hear it alone and see which notes it plays; tap a note to hear just that note as
 * rendered, with what it is and how far its Recording moved. As the iPhone app's `TootLayout`.
 *
 * `toot` is the made Toot (Song Creator) or a saved one (its screen, with no Save). When its audio
 * is missing, Play and the notes can't play, and the Recordings still can. `children` are more
 * lines under "N of your Recordings, one per note".
 */
export function TootLayout({
  toot,
  song,
  isAudioMissing = false,
  children
}: {
  toot: SongTootDraft | SongToot
  song: Song
  isAudioMissing?: boolean
  children?: ReactNode
}) {
  const pedos = usePedos()
  const { arrangement } = toot
  const [focus, setFocus] = useState<Focus>(null)
  const isPlaying = pedos.nowPlaying === tootPlayback(toot.id)
  const playingNote = song.notes.findIndex((_, i) => pedos.nowPlaying === tootPlayback(toot.id, i))
  const selectedNote = focus && 'note' in focus ? focus.note : null
  const highlightedPitch =
    focus === null ? null : 'pitch' in focus ? focus.pitch : song.notes[focus.note].pitch
  const recordingFor = (pitch: number) => {
    const id = arrangement.recordingForPitch[pitch]
    return id === undefined ? undefined : pedos.recording(id)
  }

  return (
    <div className="flex flex-col gap-6 px-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={isAudioMissing ? 'Audio missing' : isPlaying ? 'Stop' : 'Play'}
          data-testid="song-creator-play"
          disabled={isAudioMissing}
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            isAudioMissing
              ? 'bg-muted text-muted-foreground'
              : isPlaying
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/10 text-primary'
          )}
          onClick={() => {
            setFocus(null)
            pedos.toggleTootPlayback(toot)
          }}
        >
          {isAudioMissing ? (
            <CircleAlert className="size-6" />
          ) : isPlaying ? (
            <Square className="size-5 fill-current" />
          ) : (
            <Play className="size-6 fill-current" />
          )}
        </button>
        <div className="min-w-0">
          <p className="font-semibold" data-testid="song-creator-state">
            {isAudioMissing
              ? 'Audio missing'
              : isPlaying
                ? 'Playing'
                : pedos.tootPlayFailed === toot.id
                  ? "Couldn't play"
                  : 'Ready'}
          </p>
          <p className="text-sm text-muted-foreground">
            {song.pitches.length} of your Recordings, one per note
          </p>
          {children}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <NoteView
          song={song}
          arrangement={arrangement}
          recordingName={note => {
            const recording = recordingFor(note.pitch)
            return recording ? recordingName(recording) : 'Recording deleted'
          }}
          startedAt={isPlaying ? pedos.playbackStartedAt : null}
          highlightedPitch={highlightedPitch}
          selectedNote={selectedNote}
          playingNote={playingNote === -1 ? null : playingNote}
          onTapNote={index => {
            if (isAudioMissing) return
            setFocus({ note: index })
            pedos.toggleTootPlayback(toot, index)
          }}
        />
        {selectedNote !== null && (
          <p className="px-4 text-sm text-muted-foreground" data-testid="note-caption">
            {noteCaption(
              song,
              arrangement,
              song.notes[selectedNote],
              recordingFor(song.notes[selectedNote].pitch)
            )}
          </p>
        )}
      </div>

      <section aria-labelledby="recordings-used">
        <h2 id="recordings-used" className="px-4 pb-1.5 text-xs font-normal text-muted-foreground">
          Recordings used
        </h2>
        <ul className="divide-y overflow-hidden rounded-xl bg-muted/60">
          {song.pitches.map((pitch, index) => {
            const recording = recordingFor(pitch)
            const plays = noteName(soundingPitch(arrangement, pitch))
            const isHighlighted = highlightedPitch === pitch
            return recording ? (
              <RecordingUsedRow
                key={pitch}
                recording={recording}
                color={pitchColor(index)}
                plays={plays}
                isHighlighted={isHighlighted}
                onTap={() => {
                  const stopping = pedos.nowPlaying === recording.id
                  setFocus(stopping ? null : { pitch })
                  pedos.togglePlayback(recording)
                }}
              />
            ) : (
              <DeletedRecordingRow
                key={pitch}
                color={pitchColor(index)}
                plays={plays}
                isHighlighted={isHighlighted}
              />
            )
          })}
        </ul>
      </section>
    </div>
  )
}

/**
 * A Recording the Toot uses: the color of its notes, play, its name, its waveform and its fart's
 * length, and the note it plays in the Song. As the iPhone app's `RecordingRow` in Song Creator,
 * which shows the whole take's length.
 */
function RecordingUsedRow({
  recording,
  color,
  plays,
  isHighlighted,
  onTap
}: {
  recording: Recording
  color: string
  plays: string
  isHighlighted: boolean
  onTap: () => void
}) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === recording.id
  const levels = useWholeLevels(recording.id)
  const name = recordingName(recording)
  const pitch = songPitch(recording)
  const length = formattedFartLength(recording)

  return (
    <li
      className={cn(
        'flex items-center gap-3 py-2 pr-4 pl-4',
        (isPlaying || isHighlighted) && 'bg-primary/10'
      )}
      data-testid="recording-used"
    >
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={[
          name,
          `plays ${plays}`,
          length,
          isHighlighted && 'highlighted',
          pitch === null ? 'noise-like' : noteName(pitch)
        ]
          .filter(Boolean)
          .join(', ')}
        aria-pressed={isPlaying}
        onClick={onTap}
      >
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span
          aria-hidden
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
          )}
        >
          {isPlaying ? (
            <Square className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span>{name}</span>
          <span className="flex items-center gap-2">
            <Waveform
              levels={levels}
              isPlaying={isPlaying}
              className="h-[18px] w-[72px] gap-[1.5px]"
            />
            <span className="text-sm text-muted-foreground">{length}</span>
          </span>
        </span>
      </button>
      <PlaysBadge plays={plays} />
    </li>
  )
}

/** A Recording the Toot used that has since been deleted: the note it played, and no play button. */
function DeletedRecordingRow({
  color,
  plays,
  isHighlighted
}: {
  color: string
  plays: string
  isHighlighted: boolean
}) {
  return (
    <li
      className={cn(
        'flex min-h-15 items-center gap-3 py-2 pr-4 pl-4',
        isHighlighted && 'bg-primary/10'
      )}
      data-testid="recording-used"
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Trash2 className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-muted-foreground">Recording deleted</span>
      <PlaysBadge plays={plays} />
    </li>
  )
}

/** "plays F3": the note a Recording plays in the Song. */
function PlaysBadge({ plays }: { plays: string }) {
  return (
    <span
      aria-hidden
      className="shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-semibold tabular-nums"
    >
      plays {plays}
    </span>
  )
}

/** 16 loudness bars of the whole Recording, as the iPhone's Song Creator rows show it. */
function useWholeLevels(id: string): number[] {
  const [levels, setLevels] = useState<number[]>([])
  useEffect(() => {
    let left = false
    store
      .loadAudio(id)
      .then(wav => {
        if (!left) setLevels(waveformLevels(decodeWav(wav).samples, 16))
      })
      .catch(() => {})
    return () => {
      left = true
    }
  }, [id])
  return levels
}

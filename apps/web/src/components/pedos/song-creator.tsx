'use client'

import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Lock,
  Play,
  Square,
  Trash2
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { libraryOwner } from '@/lib/account'
import type { Song, SongSummary } from '@/lib/catalog/song'
import { type Arrangement, type MissingNote, songPitches } from '@/lib/engine/auto-map'
import { arrangeChoices, type FartChoices, sameFartChoices } from '@/lib/engine/fart-choices'
import { changedChoices, changeLine, type FartChange, fartSheet } from '@/lib/fart-sheet'
import { noteName } from '@/lib/pitch'
import {
  autoMapRecordings,
  coverageFraction,
  coverageSummary,
  engineSong,
  formattedFartLength,
  missingNotes
} from '@/lib/pitch-coverage'
import { TOOT_PRICE_LABEL } from '@/lib/pricing'
import * as store from '@/lib/recording-store'
import { playedPart, type Recording, recordingName, songPitch } from '@/lib/recordings'
import { holdReload } from '@/lib/stale-build'
import { reportError } from '@/lib/telemetry/errors'
import {
  noteCaption,
  type SongToot,
  type SongTootDraft,
  soundingPitch,
  type TootArrangement,
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
import { TootError, tootArrangement } from '@/lib/toot-renderer'
import { cn } from '@/lib/utils'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { useAccount } from './account-provider'
import { FartSheetView } from './fart-sheet'
import { FavoriteButton } from './favorite-button'
import { NoteView, pitchColor } from './note-view'
import { tootPlayback, usePedos } from './pedos-provider'
import { previousPage } from './previous-page'
import { ReportSong } from './report-song-sheet'
import { changeFartChoices, useFartChoices } from './use-fart-choices'
import { useSongNotes } from './use-song-notes'
import { Waveform } from './waveform'

type Phase =
  /** `again`: after a change to the Song's farts, the Toot shows while it's made again. */
  | { kind: 'making'; again?: boolean }
  | { kind: 'ready'; draft: SongTootDraft; back: CheckoutReturn | null }
  | { kind: 'locked' }
  | { kind: 'failed' }

/** What a Song's page shows of it before the Song Catalog loads (#322): which Song it is. */
export type SongHeading = Pick<Song, 'id' | 'title' | 'source'>

/**
 * Song Creator: hear an Unlocked Song played by your Recordings, and keep it as a Toot. It's not
 * an editor: no note of the Song changes (ADR 0005). The user can only swap the fart that plays a
 * pitch, or leave a fart out of the Song, in the fart sheet (#360), kept as the Song's Fart
 * Choices; a fart left out with no other to play its pitch locks the Song. As the iPhone app's
 * `SongCreatorView`.
 *
 * The Song comes from the Song Catalog the browser fetches (`usePedos().songs`), and its notes
 * when it's opened (`useSongNotes`, #323); its page gives only its `heading`, which shows until
 * then.
 */
export function SongCreator({ id, heading }: { id: string; heading?: SongHeading }) {
  const pedos = usePedos()
  const router = useRouter()
  const summary = pedos.song(id)
  const notes = useSongNotes(summary)
  const song = notes.song
  const shown = summary ?? heading
  const [phase, setPhase] = useState<Phase>({ kind: 'making' })
  /** Bumped by Try again, to make the Toot again. */
  const [attempt, setAttempt] = useState(0)
  /** Every changed Song's Fart Choices; null while they're read. */
  const allChoices = useFartChoices()
  const choices = allChoices?.get(id) ?? null
  /** The Song's Fart Choices as they're kept: the Toot is made again when they change. */
  const choicesKey = JSON.stringify(choices)
  /** What the last change to the Song's farts did, until the next one. */
  const [changed, setChanged] = useState<string | null>(null)
  /** The Song pitch whose fart sheet is open. */
  const [sheetPitch, setSheetPitch] = useState<number | null>(null)
  const loaded = pedos.recordings !== null && song !== null && allChoices !== null
  // The catalog or the Song's notes didn't load, or the catalog has no Song of this id.
  const view =
    (summary === undefined && pedos.songsFailed) || notes.failed
      ? 'failed'
      : summary === undefined && pedos.songs !== null
        ? 'missing'
        : phase.kind

  // The Arrangement as Auto-map reads the Song, with its Fart Choices: what the fart sheet lists
  // and a gap shows. The render makes the same one (`makeToot`).
  const pitches = useMemo(() => (song ? songPitches(engineSong(song)) : null), [song])
  const melodic = useMemo(() => autoMapRecordings(pedos.recordings ?? []), [pedos.recordings])
  const arrangement = useMemo(
    () => (pitches ? arrangeChoices(pitches, melodic, choices) : null),
    [pitches, melodic, choices]
  )
  const sheet = useMemo(
    () =>
      pitches && sheetPitch !== null ? fartSheet(pitches, melodic, choices, sheetPitch) : null,
    [pitches, melodic, choices, sheetPitch]
  )

  // Back from Checkout, the same Toot is made again, with the id it was paid for (ADR 0010).
  const make = useEffectEvent(async (song: Song) => {
    const back = readCheckoutReturn()
    return { draft: await pedos.makeToot(song, back?.tootId, choices), back }
  })
  const playOnce = useEffectEvent((draft: TootDraft) => {
    // A page opened from a link or a reload can't start sound before a tap.
    if (navigator.userActivation?.hasBeenActive ?? true) pedos.toggleTootPlayback(draft)
  })
  /** The first Toot made here has played once; one made again after a change waits for a tap. */
  const playedOnce = useRef(false)

  // Makes the Toot once the Recordings, the Song and its Fart Choices have loaded, then plays it
  // once, and again whenever the Fart Choices change. Leaving the screen before it's made drops
  // it; coming back makes it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what Try again changes, and `choicesKey` what a change to the Song's farts does.
  useEffect(() => {
    if (!loaded || !song) return
    let left = false
    setPhase(current => (current.kind === 'making' ? current : { kind: 'making', again: true }))
    make(song).then(
      ({ draft, back }) => {
        if (left) return
        setPhase({ kind: 'ready', draft, back })
        // Back from Checkout, the Toot was heard already: it waits for a tap.
        if (!back && !playedOnce.current) playOnce(draft)
        playedOnce.current = true
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
  }, [loaded, attempt, choicesKey])

  const { stopPlayback, forgetToot } = pedos
  useEffect(() => stopPlayback, [stopPlayback])
  const draftId = phase.kind === 'ready' ? phase.draft.id : null
  useEffect(() => {
    if (draftId) return () => forgetToot(draftId)
  }, [draftId, forgetToot])

  /** Opens the fart sheet for a Song pitch, stopping what plays. */
  const changeFart = (songPitch: number) => {
    stopPlayback()
    setSheetPitch(songPitch)
  }
  /** Makes a change from the fart sheet or the lock card: kept, said, and the Toot made again. */
  const change = (fartChange: FartChange) => {
    setSheetPitch(null)
    if (!pitches || !arrangement) return
    const next = changedChoices(fartChange, pitches, melodic, choices)
    if (sameFartChoices(next, choices)) return
    const named = (recordingId: string) => {
      const recording = pedos.recording(recordingId)
      return recording ? recordingName(recording) : 'A deleted Recording'
    }
    stopPlayback()
    setChanged(changeLine(fartChange, arrangement, arrangeChoices(pitches, melodic, next), named))
    setPhase({ kind: 'making', again: true })
    void changeFartChoices(id, next)
  }
  const changes: FartChanging | undefined =
    arrangement && song
      ? { onChangeFart: changeFart, picks: picksOf(arrangement, choices), line: changed }
      : undefined
  // A Song a fart left out locks (#360): it shows its notes and the lock card, where a Song
  // locked for want of farts shows only that it's locked.
  const isGap = view === 'locked' && choices !== null && arrangement !== null
  // The Arrangement the Toot is made from while it's made again after a change, or a gap's.
  const unmade =
    arrangement && (isGap || (view === 'making' && phase.kind === 'making' && phase.again))
      ? {
          kind: isGap ? ('locked' as const) : ('making' as const),
          arrangement: tootArrangement(arrangement),
          missing: arrangement.missingNotes
        }
      : null

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
          <h1 className="truncate font-semibold">{shown?.title}</h1>
          <p className="truncate text-xs text-muted-foreground">{shown?.source}</p>
        </div>
        {shown && <FavoriteButton song={shown} />}
      </header>

      {view === 'making' && !unmade && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Spinner className="size-6" />
          <p>Making your Toot…</p>
        </div>
      )}
      {view === 'missing' && (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          Couldn't find this Song.
        </p>
      )}
      {view === 'locked' && !isGap && (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          This Song is locked. Record the notes it needs to unlock it.
        </p>
      )}
      {view === 'failed' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-muted-foreground">
            {pedos.songsFailed
              ? "Couldn't load the Songs."
              : notes.failed
                ? "Couldn't load this Song."
                : "Couldn't make this Toot."}
          </p>
          <Button
            variant="outline"
            className="h-11 px-5 text-base"
            onClick={() => {
              if (pedos.songsFailed) pedos.reloadSongs()
              if (notes.failed) notes.retry()
              setPhase({ kind: 'making' })
              setAttempt(a => a + 1)
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {/* One TootLayout while the Toot is made again after a change, so the selected note and
          the change line stay. */}
      {view === 'ready' && phase.kind === 'ready' ? (
        <TootLayout toot={phase.draft} song={phase.draft.song} changes={changes} />
      ) : (
        song && unmade && <TootLayout toot={null} unmade={unmade} song={song} changes={changes} />
      )}
      {view === 'ready' && phase.kind === 'ready' && (
        <>
          <ReportSong song={phase.draft.song} />
          <SaveToToots draft={phase.draft} back={phase.back} />
        </>
      )}
      {isGap && arrangement && (
        <LockCard
          arrangement={arrangement}
          onReset={() => change({ kind: 'resetAll' })}
          onRecord={() => router.push('/')}
        />
      )}
      <FartSheetView sheet={sheet} onClose={() => setSheetPitch(null)} onChange={change} />
    </div>
  )
}

/** The Song pitches whose fart is the one the user swapped in. */
function picksOf(arrangement: Arrangement, choices: FartChoices | null): ReadonlySet<number> {
  return new Set(
    arrangement.pitches
      .filter(c => c.recordingId !== null && choices?.preferred[c.songPitch] === c.recordingId)
      .map(c => c.songPitch)
  )
}

/**
 * In place of Save, for a Song a fart left out locks (#360): its Pitch Coverage, the notes it
 * needs, Reset to automatic (every change undone) and Record. The locked Song sheet's pieces, in
 * its order.
 */
function LockCard({
  arrangement,
  onReset,
  onRecord
}: {
  arrangement: Arrangement
  onReset: () => void
  onRecord: () => void
}) {
  const missing = missingNotes({ missing: arrangement.missingNotes })
  return (
    <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] mt-auto md:bottom-0 bg-linear-to-t from-background from-70% to-transparent px-4 pt-5 pb-3">
      <Card size="sm" className="gap-3 px-4" data-testid="lock-card">
        <div className="flex flex-col gap-1.5">
          <Progress value={coverageFraction(arrangement) * 100} aria-hidden />
          <p className="flex items-center gap-2 text-muted-foreground">
            <Lock className="size-4" aria-hidden />
            {coverageSummary(arrangement)}
          </p>
        </div>
        {missing && <p className="text-base">Needs a fart near {missing}.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11 text-base" onClick={onReset}>
            Reset to automatic
          </Button>
          <Button className="h-11 text-base" onClick={onRecord}>
            Record
          </Button>
        </div>
      </Card>
    </div>
  )
}

/**
 * Song Creator for the Song the address names: the page the service worker answers every Song's
 * page with offline (`/compose/song/`, public/sw.js). It knows the Song only once the catalog
 * loads, and then gives the tab the Song's title, as the Song's own page has.
 */
export function SongCreatorFromAddress() {
  const id = /^\/compose\/([^/]+)/.exec(usePathname())?.[1] ?? ''
  const title = usePedos().song(id)?.title
  useEffect(() => {
    if (!title) return
    const wanted = `${title} · Farty`
    const set = () => {
      // Leaving the Song, the next page's title lands before this effect's cleanup runs (#351).
      const here = /^\/compose\/([^/]+)/.exec(location.pathname)?.[1]
      if (here === id && document.title !== wanted) document.title = wanted
    }
    set()
    // The page's metadata title ("Compose · Farty") can land after this effect, and would stay;
    // so set the Song's title again whenever the `<title>` changes (#351).
    const observer = new MutationObserver(set)
    observer.observe(document.head, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [id, title])
  return <SongCreator id={id} />
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
  keep?: (accountId: string) => boolean
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
    if (keepForCheckout && !keepForCheckout(accountId)) {
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
 * A Song's Toot before it's made, or when it can't be: what Song Creator shows while it makes the
 * Toot again after a change to its farts, or when a fart left out locks the Song (#360).
 */
export type UnmadeToot = {
  kind: 'making' | 'locked'
  arrangement: TootArrangement
  /** The notes no fart plays, with how long a fart each needs. */
  missing: readonly MissingNote[]
}

/** Song Creator's way into the fart sheet (#360). A saved Toot's screen has none. */
export type FartChanging = {
  /** Opens the fart sheet for a Song pitch. */
  onChangeFart: (songPitch: number) => void
  /** The Song pitches whose fart the user swapped in. */
  picks: ReadonlySet<number>
  /** What the last change did, until the next one. */
  line: string | null
}

const andList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

/**
 * What Song Creator and a Toot's screen share: Play, the note view, and the Recordings used. Tap a
 * Recording to hear it alone and see which notes it plays; tap a note to hear just that note as
 * rendered, with what it is and how far its Recording moved. As the iPhone app's `TootLayout`.
 *
 * `toot` is the made Toot (Song Creator) or a saved one (its screen, with no Save). When its audio
 * is missing, Play and the notes can't play, and the Recordings still can. `children` are more
 * lines under "N of your Recordings, one per note". With no `toot`, `unmade` is what shows in its
 * place, and nothing plays but the Recordings.
 *
 * `changes`, in Song Creator only, opens the fart sheet from a selected note's caption and from
 * each Recording's "plays C♯3" (#360), and shows what the last change did.
 *
 * Play needs only the Toot's audio, so a saved Toot's screen shows it before its Song's notes load
 * (#323): `song` is then the Song without them, and `notesFallback` stands in for the note view.
 */
export function TootLayout(
  props: {
    song: Song | SongSummary
    notesFallback?: ReactNode
    isAudioMissing?: boolean
    changes?: FartChanging
    children?: ReactNode
  } & ({ toot: SongTootDraft | SongToot; unmade?: undefined } | { toot: null; unmade: UnmadeToot })
) {
  const { toot, song, notesFallback, isAudioMissing = false, changes, children } = props
  const pedos = usePedos()
  const arrangement = props.toot === null ? props.unmade.arrangement : props.toot.arrangement
  const unmade = props.toot === null ? props.unmade : null
  const [focus, setFocus] = useState<Focus>(null)
  /** The Song with its notes, once they've loaded. */
  const melody = 'notes' in song ? song : null
  const canPlay = toot !== null && !isAudioMissing
  const isPlaying = toot !== null && pedos.nowPlaying === tootPlayback(toot.id)
  const playingNote =
    toot === null
      ? -1
      : (melody?.notes.findIndex((_, i) => pedos.nowPlaying === tootPlayback(toot.id, i)) ?? -1)
  const selectedNote = melody && focus && 'note' in focus ? focus.note : null
  const highlightedPitch =
    focus === null
      ? null
      : 'pitch' in focus
        ? focus.pitch
        : (melody?.notes[focus.note].pitch ?? null)
  const recordingFor = (pitch: number) => {
    const id = arrangement.recordingForPitch[pitch]
    return id === undefined ? undefined : pedos.recording(id)
  }
  const sounding = (pitch: number) => noteName(soundingPitch(arrangement, pitch))
  const gaps = song.pitches.filter(p => arrangement.recordingForPitch[p] === undefined)

  return (
    <div className="flex flex-col gap-6 px-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label={
              unmade?.kind === 'locked'
                ? 'Locked'
                : unmade
                  ? 'Making your Toot'
                  : isAudioMissing
                    ? 'Audio missing'
                    : isPlaying
                      ? 'Stop'
                      : 'Play'
            }
            data-testid="song-creator-play"
            disabled={!canPlay}
            className={cn(
              'flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              !canPlay
                ? 'bg-muted text-muted-foreground'
                : isPlaying
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary/10 text-primary'
            )}
            onClick={() => {
              if (toot === null) return
              setFocus(null)
              pedos.toggleTootPlayback(toot)
            }}
          >
            {unmade?.kind === 'locked' ? (
              <Lock className="size-6" />
            ) : unmade ? (
              <Spinner className="size-6" />
            ) : isAudioMissing ? (
              <CircleAlert className="size-6" />
            ) : isPlaying ? (
              <Square className="size-5 fill-current" />
            ) : (
              <Play className="size-6 fill-current" />
            )}
          </button>
          <div className="min-w-0">
            <p className="font-semibold" data-testid="song-creator-state">
              {unmade?.kind === 'locked'
                ? 'Locked'
                : unmade
                  ? 'Making your Toot…'
                  : isAudioMissing
                    ? 'Audio missing'
                    : isPlaying
                      ? 'Playing'
                      : pedos.tootPlayFailed === toot?.id
                        ? "Couldn't play"
                        : 'Ready'}
            </p>
            <p className="text-sm text-muted-foreground">
              {unmade?.kind === 'locked' && gaps.length > 0
                ? `${andList.format(gaps.map(sounding))} ${gaps.length === 1 ? 'has' : 'have'} no fart, so farts can't play`
                : `${song.pitches.length} of your Recordings, one per note`}
            </p>
            {children}
          </div>
        </div>
        {changes && (
          <output className="block">
            {changes.line && (
              <p
                className="flex items-start gap-2 rounded-xl bg-brand/13 px-3 py-2.5 text-sm"
                data-testid="fart-change"
              >
                <Check className="mt-0.5 size-4 shrink-0 text-brand-strong" aria-hidden />
                {changes.line}
              </p>
            )}
          </output>
        )}
      </div>

      {melody ? (
        <div className="flex flex-col gap-2">
          <NoteView
            song={melody}
            arrangement={arrangement}
            recordingName={note => {
              if (arrangement.recordingForPitch[note.pitch] === undefined) return 'No fart'
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
              // Before the Toot is made again, or while it's locked, a tap only picks the note.
              if (toot !== null) pedos.toggleTootPlayback(toot, index, melody)
            }}
          />
          {selectedNote !== null && (
            <div className="flex min-h-8 items-center justify-between gap-3 px-4">
              <p className="text-sm text-muted-foreground" data-testid="note-caption">
                {noteCaption(
                  melody,
                  arrangement,
                  melody.notes[selectedNote],
                  recordingFor(melody.notes[selectedNote].pitch)
                )}
              </p>
              {changes && (
                <Button
                  variant="outline"
                  className="h-11 shrink-0 px-4 text-base"
                  onClick={() => changes.onChangeFart(melody.notes[selectedNote].pitch)}
                >
                  Change fart
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        notesFallback
      )}

      <section aria-labelledby="recordings-used">
        <h2 id="recordings-used" className="px-4 pb-1.5 text-xs font-normal text-muted-foreground">
          Recordings used
        </h2>
        <ul className="divide-y overflow-hidden rounded-xl bg-muted/60">
          {song.pitches.map((pitch, index) => {
            const recording = recordingFor(pitch)
            const plays = sounding(pitch)
            const isHighlighted = highlightedPitch === pitch
            const badge = (
              <PlaysBadge
                key="plays"
                plays={plays}
                onChangeFart={changes && (() => changes.onChangeFart(pitch))}
              />
            )
            if (arrangement.recordingForPitch[pitch] === undefined) {
              const needed = unmade?.missing.find(m => m.midi === soundingPitch(arrangement, pitch))
              return (
                <NoFartRow
                  key={pitch}
                  color={pitchColor(index)}
                  needs={needed ? `${plays} (${needed.seconds.toFixed(1)} s)` : plays}
                  isHighlighted={isHighlighted}
                  badge={badge}
                />
              )
            }
            return recording ? (
              <RecordingUsedRow
                key={pitch}
                recording={recording}
                color={pitchColor(index)}
                plays={plays}
                isYourPick={changes?.picks.has(pitch) ?? false}
                isHighlighted={isHighlighted}
                badge={badge}
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
                isHighlighted={isHighlighted}
                badge={badge}
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
 * length, "Your pick" when the user swapped it in (#360), and the note it plays in the Song. As
 * the iPhone app's `RecordingRow` in Song Creator, which shows the whole take's length.
 */
function RecordingUsedRow({
  recording,
  color,
  plays,
  isYourPick,
  isHighlighted,
  badge,
  onTap
}: {
  recording: Recording
  color: string
  plays: string
  isYourPick: boolean
  isHighlighted: boolean
  badge: ReactNode
  onTap: () => void
}) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === recording.id
  const levels = usePlayedLevels(recording)
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
          isYourPick && 'your pick',
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
          {isYourPick && <span className="text-sm font-semibold text-brand-strong">Your pick</span>}
        </span>
      </button>
      {badge}
    </li>
  )
}

/** A Recording the Toot used that has since been deleted: the note it played, and no play button. */
function DeletedRecordingRow({
  color,
  isHighlighted,
  badge
}: {
  color: string
  isHighlighted: boolean
  badge: ReactNode
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
      {badge}
    </li>
  )
}

/**
 * A pitch no fart plays, as when the user left its fart out of the Song (#360): "No fart", and
 * what it needs: "Needs a fart near F♯3 (0.6 s)".
 */
function NoFartRow({
  color,
  needs,
  isHighlighted,
  badge
}: {
  color: string
  needs: string
  isHighlighted: boolean
  badge: ReactNode
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
        className="size-2.5 shrink-0 rounded-full border border-dashed"
        style={{ borderColor: color }}
      />
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Ban className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>No fart</span>
        <span className="text-sm text-muted-foreground">Needs a fart near {needs}</span>
      </span>
      {badge}
    </li>
  )
}

/**
 * "plays F3": the note a Recording plays in the Song. In Song Creator it opens the fart sheet for
 * that pitch (#360).
 */
function PlaysBadge({ plays, onChangeFart }: { plays: string; onChangeFart?: () => void }) {
  const pill = 'shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-semibold tabular-nums'
  if (!onChangeFart) {
    return (
      <span aria-hidden className={pill}>
        plays {plays}
      </span>
    )
  }
  // A thumb's 44 points around the pill.
  return (
    <button
      type="button"
      aria-label={`Change the fart for ${plays}`}
      className="-my-1 flex h-11 shrink-0 items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onChangeFart}
    >
      <span
        className={cn(pill, 'flex h-9 items-center gap-0.5 bg-background pr-2 ring-1 ring-border')}
      >
        plays {plays}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </span>
    </button>
  )
}

/**
 * 16 loudness bars of what the Recording plays, as the iPhone's Song Creator rows show it: the
 * whole take, or its Trim (ADR 0019).
 */
function usePlayedLevels(recording: Recording): number[] {
  const [levels, setLevels] = useState<number[]>([])
  const { id } = recording
  const { startSeconds, endSeconds } = playedPart(recording)
  useEffect(() => {
    let left = false
    store
      .loadAudio(id)
      .then(wav => {
        const { samples, sampleRate } = decodeWav(wav)
        const from = Math.round(startSeconds * sampleRate)
        const to = Math.max(from, Math.round(endSeconds * sampleRate))
        if (!left) setLevels(waveformLevels(samples.subarray(from, to), 16))
      })
      .catch(() => {})
    return () => {
      left = true
    }
  }, [id, startSeconds, endSeconds])
  return levels
}

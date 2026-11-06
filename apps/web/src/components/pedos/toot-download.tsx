'use client'

import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { hasFullAccess, startDownloadCheckout, waitForFullAccess } from '@/lib/full-access'
import { runsOnIPhoneOrIPad } from '@/lib/install'
import { reportError } from '@/lib/telemetry/errors'
import type { Toot } from '@/lib/toot'
import { handOverFile, tootFileName } from '@/lib/toot-file'
import { loadTootAudio, TootAudioMissing } from '@/lib/toot-store'
import { useAccount } from './account-provider'
import { FullAccessSheet } from './full-access-sheet'
import { PAYMENT_PROBLEMS } from './payment-problems'
import { usePedos } from './pedos-provider'
import { NotePill } from './share-recording'

// A saved Toot's Download (#408): the Toot's own WAV, as a file on the phone, for an account with
// Full Access. The tap asks the server whether the account has it, so the action never waits on an
// earlier answer, and an account without it gets the sheet Save offers.

const UNREACHABLE = "Couldn't reach Farty. Check your connection and try again."
/** A note lasts this long, unless only support can sort it out. */
const NOTE_MS = 5_000

/** One Toot's Download, as `useTootDownload` gives it. */
export type TootDownload = {
  /** Download is checking, reading the file, or waiting for a payment to come through. */
  busy: boolean
  /** Download, from the top: an account, then Full Access, then the file. */
  start: () => void
  /** The Full Access sheet, the file the browser held back, and the note. */
  dialogs: ReactNode
}

/**
 * Download for one saved Toot, behind its More menu. Render `dialogs` outside the menu, so they stay
 * open once it closes. `backFromCheckout` says this page is Checkout's return from paying for this
 * Toot's Download: the Toot's file is offered once the payment comes through, by a tap of its own,
 * since the wait outlasts the one that started it.
 */
export function useTootDownload(toot: Toot, backFromCheckout = false): TootDownload {
  const { markAudioMissing } = usePedos()
  const { account, openStep } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const [busy, setBusy] = useState(false)
  const [offering, setOffering] = useState(false)
  const [paying, setPaying] = useState(false)
  /** A file the browser won't hand over without a fresh tap. */
  const [ready, setReady] = useState<File | null>(null)
  const [note, setNote] = useState<ReactNode>(null)
  /** A guest's Download, which carries on once the account step closes signed in. */
  const [resume, setResume] = useState(false)
  /** A second tap, before the first one's answer, starts nothing. */
  const running = useRef(false)
  const readyDownload = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (typeof note !== 'string') return
    const timer = setTimeout(() => setNote(null), NOTE_MS)
    return () => clearTimeout(timer)
  }, [note])

  // The page comes back on the Record tab, so nothing is left open here.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState !== 'hidden') return
      setOffering(false)
      setReady(null)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  // Back to this page from Checkout's with the browser's Back, Download can be tapped again.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      running.current = false
      setPaying(false)
      setBusy(false)
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [])

  /** Whether the account has Full Access. If not, says why, or offers it. */
  const checkAccess = async (accountId: string, afterPaying: boolean): Promise<boolean> => {
    if (afterPaying) {
      if ((await waitForFullAccess(accountId)) !== null) return true
      setNote("Your payment hasn't come through yet. Tap Download to check again.")
      return false
    }
    const active = await hasFullAccess(accountId)
    // As Save: with no answer, nothing is offered to an account that may have paid already.
    if (active === null) setNote(UNREACHABLE)
    if (active === false) setOffering(true)
    return active === true
  }

  /** The Toot's file, from the audio this browser holds or the account's. */
  const readFile = async (): Promise<File | null> => {
    try {
      const wav = await loadTootAudio(toot.id)
      return new File([wav], tootFileName(toot.title), { type: 'audio/wav' })
    } catch (error) {
      if (error instanceof TootAudioMissing) {
        reportError('toot-audio-missing', error)
        markAudioMissing(toot.id)
        setNote("This Toot's audio is missing.")
      } else {
        reportError('toot-audio-read-failed', error)
        setNote("Couldn't download this Toot. Check your connection and try again.")
      }
      return null
    }
  }

  const handOver = async (file: File, tapped = false) => {
    const handed = await handOverFile(file, tapped)
    if (handed === 'needsTap') setReady(file)
    if (handed === 'downloading') {
      setNote(
        runsOnIPhoneOrIPad()
          ? 'Look for it in the Files app, under Downloads.'
          : 'Look for it in your Downloads.'
      )
    }
  }

  const start = async (afterPaying = false) => {
    if (running.current) return
    setNote(null)
    if (account.status === 'signedOut' || account.status === 'expired') {
      openStep(() => setResume(true))
      return
    }
    if (!accountId) {
      setNote(UNREACHABLE)
      return
    }
    running.current = true
    setBusy(true)
    const file = (await checkAccess(accountId, afterPaying)) ? await readFile() : null
    running.current = false
    setBusy(false)
    if (!file) return
    if (afterPaying) setReady(file)
    else await handOver(file)
  }

  const pay = async () => {
    if (running.current) return
    if (!accountId) {
      setOffering(false)
      return
    }
    running.current = true
    setPaying(true)
    const checkout = await startDownloadCheckout(toot.id, accountId)
    if (checkout.kind === 'pay') {
      // Off to Checkout: Pay stays busy while the page goes.
      window.location.assign(checkout.url)
      return
    }
    running.current = false
    setPaying(false)
    setOffering(false)
    if (checkout.kind === 'active') void start()
    else if (checkout.problem === 'limitReached') setNote(PAYMENT_PROBLEMS.failed)
    else setNote(PAYMENT_PROBLEMS[checkout.problem])
  }

  // Back from the account step: carry on if it signed in. The step closes either way.
  const carryOn = useEffectEvent(() => void start())
  useEffect(() => {
    if (!resume || account.status === 'checking') return
    setResume(false)
    if (account.status === 'signedIn') carryOn()
  }, [resume, account.status])

  // Back from Checkout, once the account is read. The address loses the return, so a reload or a
  // later visit doesn't wait for a payment again.
  const startAfterPaying = useEffectEvent(() => {
    const address = new URL(window.location.href)
    address.searchParams.delete('checkout')
    window.history.replaceState(null, '', address)
    void start(true)
  })
  const returned = useRef(false)
  useEffect(() => {
    if (!backFromCheckout || returned.current || account.status === 'checking') return
    returned.current = true
    startAfterPaying()
  }, [backFromCheckout, account.status])

  const dialogs = (
    <>
      <FullAccessSheet
        open={offering}
        busy={paying}
        onPay={() => void pay()}
        onClose={() => setOffering(false)}
      />

      <AlertDialog open={ready !== null} onOpenChange={open => !open && setReady(null)}>
        <AlertDialogContent initialFocus={readyDownload}>
          <AlertDialogHeader>
            <AlertDialogTitle>Your Toot is ready to download</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{ready?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={readyDownload}
              className="h-11 text-base"
              onClick={() => {
                const file = ready
                setReady(null)
                // Straight from the tap, so the browser lets the share sheet open.
                if (file) void handOver(file, true)
              }}
            >
              Download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {note && <NotePill>{note}</NotePill>}
    </>
  )

  return { busy, start: () => void start(), dialogs }
}

'use client'

import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

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
import { hasStoredFullAccess } from '@/lib/full-access'
import type { Toot } from '@/lib/toot'
import { fetchTootFile, offerTootFile, type TootFile } from '@/lib/toot-download'

import { useAccount } from './account-provider'

// Download on a saved Toot, for an account with Full Access (#408). The server decides, at the tap:
// this only hides the menu item from an account it knows doesn't have it, so every row of the Toots
// list shares one read, as they do for Share.

type Known = { accountId: string; active: boolean; readAt: number }

let known: Known | null = null
let reading: string | null = null
const listeners = new Set<() => void>()

function setKnown(next: Known) {
  known = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reads the account's Full Access, unless it was read in the last few seconds. */
async function refresh(accountId: string): Promise<void> {
  if (reading === accountId) return
  if (known?.accountId === accountId && Date.now() - known.readAt < 5_000) return
  reading = accountId
  try {
    const active = await hasStoredFullAccess(accountId)
    if (active !== null) setKnown({ accountId, active, readAt: Date.now() })
  } finally {
    reading = null
  }
}

const notes: Record<Exclude<TootFile, { file: File }>['error'], string> = {
  noFullAccess: 'Download needs Full Access.',
  notUploaded: "This Toot hasn't reached your account yet. Try again in a moment.",
  failed: "Couldn't download. Check your connection and try again."
}

/** One Toot's Download, as `useTootDownload` gives it. */
export type TootDownloadFlow = {
  /** The account has Full Access, as far as Farty knows, and the Toot's audio is its own. */
  available: boolean
  /** The file is on its way. */
  busy: boolean
  download: () => void
  /** The file the browser held back, and the note. */
  dialogs: ReactNode
}

/** Download for one saved Toot. Render `dialogs` outside any menu, so they stay open once it closes. */
export function useTootDownload(toot: Toot | undefined): TootDownloadFlow {
  const { account } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const current = useSyncExternalStore(
    subscribe,
    () => known,
    () => null
  )
  const [busy, setBusy] = useState(false)
  /** A file the browser wouldn't hand to the share sheet without a fresh tap. */
  const [ready, setReady] = useState<File | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (accountId) void refresh(accountId)
  }, [accountId])

  useEffect(() => {
    if (note === null) return
    const timer = setTimeout(() => setNote(null), 3_000)
    return () => clearTimeout(timer)
  }, [note])

  const offer = async (file: File) => {
    if ((await offerTootFile(file)) === 'needsTap') setReady(file)
  }

  const download = async () => {
    if (!toot || !accountId) return
    setBusy(true)
    const fetched = await fetchTootFile(toot.id, toot.title, accountId)
    setBusy(false)
    if ('file' in fetched) return offer(fetched.file)
    // Ended since the last read, as a refund does: the item goes with it.
    if (fetched.error === 'noFullAccess') setKnown({ accountId, active: false, readAt: Date.now() })
    setNote(notes[fetched.error])
  }

  const shownNote = busy ? 'Downloading…' : note

  return {
    available: Boolean(
      toot &&
        !toot.isAudioMissing &&
        accountId &&
        current?.accountId === accountId &&
        current.active
    ),
    busy,
    download: () => void download(),
    dialogs: (
      <>
        <AlertDialog open={ready !== null} onOpenChange={open => !open && setReady(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Your file is ready</AlertDialogTitle>
              <AlertDialogDescription className="break-all">{ready?.name}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="h-11 text-base"
                onClick={() => {
                  const file = ready
                  setReady(null)
                  // Straight from the tap, so the browser lets the share sheet open.
                  if (file) void offer(file)
                }}
              >
                Save file
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {shownNote && (
          <output
            aria-live="polite"
            className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-foreground px-4 py-2 text-center text-sm text-background shadow-lg md:top-20 md:bottom-auto"
          >
            {shownNote}
          </output>
        )}
      </>
    )
  }
}

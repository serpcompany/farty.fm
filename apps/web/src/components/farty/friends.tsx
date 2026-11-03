'use client'

import { type ReactNode, useRef, useState } from 'react'
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
import { type RequestRefusal, requestFriend } from '@/lib/friends'
import { readHandle } from '@/lib/sharing'
import { HandleDialog } from './handle-dialog'
import { rememberHandle } from './share-recording'

export function refusalMessage(refusal: RequestRefusal | 'cancelled', handle: string): string {
  switch (refusal) {
    case 'no_such_handle':
      return `No one on Farty has the handle @${handle}.`
    case 'own_handle':
      return "That's your own handle."
    case 'already_friends':
      return `You're already friends with @${handle}.`
    case 'already_requested':
      return `You already asked @${handle}.`
    case 'too_many_requests':
      return 'Too many friend requests right now. Try again later.'
    case 'cancelled':
      return 'Pick a handle to add friends.'
    default:
      return "Couldn't send the request. Check your connection and try again."
  }
}

export type SendResult =
  | { state: 'requested' | 'friends' }
  | { refused: RequestRefusal | 'cancelled' }

export function useFriendRequest(accountId: string | null): {
  send: (handle: string) => Promise<SendResult>
  ensureHandle: (action: string) => Promise<string | null>
  dialog: ReactNode
} {
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [action, setAction] = useState('Add friend')
  const picked = useRef<((handle: string | null) => void) | null>(null)

  const finish = (handle: string | null) => {
    setSuggestion(null)
    picked.current?.(handle)
    picked.current = null
  }

  const ensureHandle = async (action: string): Promise<string | null> => {
    if (!accountId) return null
    const read = await readHandle(accountId)
    if (!read) return null
    if (read.handle !== null) return read.handle
    return new Promise<string | null>(resolve => {
      picked.current = resolve
      setAction(action)
      setSuggestion(read.suggestion ?? '')
    })
  }

  const send = async (handle: string): Promise<SendResult> => {
    if (!accountId) return { refused: 'failed' }
    const sent = await requestFriend(handle, accountId)
    if (!('refused' in sent) || sent.refused !== 'no_handle') return sent
    if ((await ensureHandle('Add friend')) === null) return { refused: 'cancelled' }
    return requestFriend(handle, accountId)
  }

  const dialog = accountId ? (
    <HandleDialog
      accountId={accountId}
      suggestion={suggestion}
      action={action}
      onClose={() => finish(null)}
      onPicked={handle => {
        rememberHandle(accountId, handle)
        finish(handle)
      }}
    />
  ) : null
  return { send, ensureHandle, dialog }
}

export function RemoveFriendDialog({
  handle,
  onClose,
  onRemove
}: {
  handle: string | null
  onClose: () => void
  onRemove: (handle: string) => void
}) {
  const [shown, setShown] = useState(handle)
  if (handle !== null && handle !== shown) setShown(handle)
  return (
    <AlertDialog open={handle !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove @{shown}?</AlertDialogTitle>
          <AlertDialogDescription>
            You stop being friends. @{shown} isn't told.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-11 text-base"
            onClick={() => {
              if (handle) onRemove(handle)
            }}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

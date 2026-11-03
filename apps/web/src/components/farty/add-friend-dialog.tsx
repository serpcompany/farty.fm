'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { normalizeHandle } from '@/lib/handle'
import { refusalMessage, type SendResult } from './friends'
import { HandleField, linkHost } from './handle-dialog'

export function AddFriendDialog({
  open,
  own,
  friends,
  send,
  onClose,
  onSent
}: {
  open: boolean
  own: string | null
  friends: string[]
  send: (handle: string) => Promise<SendResult>
  onClose: () => void
  onSent: (handle: string, state: 'requested' | 'friends') => void
}) {
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTyped('')
      setProblem(null)
    }
  }

  const submit = async () => {
    const handle = normalizeHandle(typed)
    if (handle === '') return setProblem('Enter a handle.')
    if (handle === own) return setProblem(refusalMessage('own_handle', handle))
    if (friends.includes(handle)) return setProblem(refusalMessage('already_friends', handle))
    setSending(true)
    setProblem(null)
    const sent = await send(handle)
    setSending(false)
    if ('state' in sent) onSent(handle, sent.state)
    else setProblem(refusalMessage(sent.refused, handle))
  }

  return (
    <AlertDialog open={open} onOpenChange={next => !next && !sending && onClose()}>
      <AlertDialogContent>
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault()
            if (!sending) void submit()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Add a friend</AlertDialogTitle>
            <AlertDialogDescription>
              Enter their handle. They get a friend request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <HandleField
            label="Their handle"
            messageId="friend-message"
            invalid={problem !== null}
            message={problem ?? `Their handle is on their page: ${linkHost()}/u/handle`}
            autoComplete="off"
            placeholder="handle"
            value={typed}
            onChange={event => {
              setTyped(event.target.value)
              setProblem(null)
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base" disabled={sending}>
              Cancel
            </AlertDialogCancel>
            <Button type="submit" className="h-11 text-base" disabled={sending}>
              {sending ? <Spinner /> : 'Send request'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

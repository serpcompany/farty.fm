'use client'

import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import {
  HANDLE_MAX,
  HANDLE_MIN,
  type HandleProblem,
  handleMessage,
  handleProblem,
  normalizeHandle
} from '@/lib/handle'
import { checkHandle, pickHandle } from '@/lib/sharing'
import { cn } from '@/lib/utils'

export function linkHost(): string {
  return typeof window === 'undefined' ? 'farty.fm' : window.location.host
}

export function HandleField({
  label,
  messageId,
  invalid,
  failed = false,
  message,
  ...input
}: {
  label: string
  messageId: string
  invalid: boolean
  failed?: boolean
  message: ReactNode
} & Pick<ComponentProps<typeof Input>, 'value' | 'onChange' | 'placeholder' | 'autoComplete'>) {
  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <span
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-muted-foreground"
          aria-hidden
        >
          @
        </span>
        <Input
          aria-label={label}
          aria-describedby={messageId}
          aria-invalid={invalid}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={HANDLE_MAX + 1}
          className="h-11 pl-7 text-base"
          {...input}
        />
      </div>
      <p
        id={messageId}
        aria-live="polite"
        className={cn('text-sm', invalid || failed ? 'text-destructive' : 'text-muted-foreground')}
      >
        {message}
      </p>
    </div>
  )
}

type Check = { handle: string; problem: HandleProblem | null } | { handle: string; checking: true }

function useHandleCheck(accountId: string, handle: string, suggestion: string | null) {
  const [check, setCheck] = useState<Check | null>(null)
  const local = handle === '' ? null : handleProblem(handle)

  useEffect(() => {
    if (suggestion === null || handle === '' || local !== null) return
    setCheck({ handle, checking: true })
    const timer = setTimeout(async () => {
      const problem = await checkHandle(handle, accountId)
      if (problem === 'unreachable') setCheck(null)
      else setCheck(current => (current?.handle === handle ? { handle, problem } : current))
    }, 300)
    return () => clearTimeout(timer)
  }, [accountId, handle, local, suggestion])

  const checked = check && check.handle === handle && 'problem' in check ? check : null
  const problem = local ?? checked?.problem ?? null
  const free = handle !== '' && local === null && checked !== null && checked.problem === null
  return { problem, free, setCheck }
}

function checkMessage(handle: string, problem: HandleProblem | null, free: boolean): string {
  if (handle === '') return `${HANDLE_MIN} to ${HANDLE_MAX} letters, numbers or _`
  if (problem) return handleMessage(handle, problem)
  return free ? handleMessage(handle, null) : 'Checking…'
}

export function HandleDialog({
  accountId,
  suggestion,
  action = 'Share',
  onClose,
  onPicked
}: {
  accountId: string
  suggestion: string | null
  action?: string
  onClose: () => void
  onPicked: (handle: string) => void
}) {
  const [typed, setTyped] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const handle = normalizeHandle(typed)
  const { problem, free, setCheck } = useHandleCheck(accountId, handle, suggestion)
  if (suggestion !== shown) {
    setShown(suggestion)
    if (suggestion !== null) {
      setTyped(suggestion)
      setCheck(null)
      setFailed(false)
    }
  }

  return (
    <AlertDialog open={suggestion !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <form
          className="grid gap-4"
          onSubmit={async event => {
            event.preventDefault()
            if (!free || saving) return
            setSaving(true)
            setFailed(false)
            const picked = await pickHandle(handle, accountId)
            setSaving(false)
            if ('handle' in picked) onPicked(picked.handle)
            else if ('problem' in picked) setCheck({ handle, problem: picked.problem })
            else setFailed(true)
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Pick a handle</AlertDialogTitle>
            <AlertDialogDescription>
              Your links start
              <span className="block break-all font-medium text-foreground">
                {linkHost()}/u/
                {handle || '…'}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <HandleField
            label="Handle"
            messageId="handle-message"
            invalid={problem !== null}
            failed={failed}
            message={
              failed
                ? "Couldn't save your handle. Check your connection and try again."
                : checkMessage(handle, problem, free)
            }
            value={typed}
            onChange={event => setTyped(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
            <Button type="submit" className="h-11 text-base" disabled={!free || saving}>
              {action}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

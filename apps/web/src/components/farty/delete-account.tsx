'use client'

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
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
import { Spinner } from '@/components/ui/spinner'
import { useAccount } from './account-provider'
import { CodeField, useSignInCode } from './sign-in-code'

const action = 'h-11 text-base'

export function DeleteAccount({
  className,
  disabled,
  onFailed
}: {
  className: string
  disabled: boolean
  onFailed(): void
}) {
  const { account, deleteAccount } = useAccount()
  const email = account.status === 'signedIn' ? account.email : ''
  const [open, setOpen] = useState(false)
  const [asksCode, setAsksCode] = useState(false)
  const steps = useSignInCode(email, open && asksCode)
  const { phase, busy } = steps
  const title = useRef<HTMLHeadingElement>(null)
  const codeField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!asksCode) return
    if (phase === 'code') codeField.current?.focus()
    else title.current?.focus()
  }, [asksCode, phase])

  const start = () => {
    setAsksCode(false)
    steps.setPhase('email')
    steps.setProblem(null)
    setOpen(true)
  }

  const deleteNow = async () => {
    steps.setBusy(true)
    const result = await deleteAccount()
    if (result === 'done' || result === 'otherAccount') return
    steps.setBusy(false)
    if (result === 'signInAgain') {
      steps.setPhase('email')
      setAsksCode(true)
      return
    }
    setOpen(false)
    onFailed()
  }

  const send = (event: FormEvent) => {
    event.preventDefault()
    if (steps.hasToken) void steps.send()
    else steps.checkAgainIfFailed()
  }

  const confirmCode = async (event: FormEvent) => {
    event.preventDefault()
    if (await steps.signIn()) await deleteNow()
  }

  const cancel = (
    <AlertDialogCancel type="button" className={action} disabled={busy}>
      Cancel
    </AlertDialogCancel>
  )
  const header = (description: ReactNode) => (
    <AlertDialogHeader>
      <AlertDialogTitle ref={title} tabIndex={-1} className="outline-none">
        Delete your account?
      </AlertDialogTitle>
      <AlertDialogDescription>{description}</AlertDialogDescription>
    </AlertDialogHeader>
  )
  const problem = steps.message && (
    <p role="alert" className="text-center text-sm text-destructive">
      {steps.message}
    </p>
  )
  const to = <span className="text-foreground">{email}</span>

  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={start}>
        Delete account
      </button>
      <AlertDialog open={open} onOpenChange={next => !busy && setOpen(next)}>
        <AlertDialogContent className="data-[size=default]:max-w-[min(24rem,calc(100%_-_2rem))]">
          {!asksCode ? (
            <>
              {header(
                "This deletes your email, Recordings and Toots from Farty, on every device. It can't be undone."
              )}
              <AlertDialogFooter>
                {cancel}
                <AlertDialogAction
                  variant="destructive"
                  className={action}
                  disabled={busy}
                  onClick={() => void deleteNow()}
                >
                  {busy ? <Spinner /> : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : phase === 'email' ? (
            <form className="contents" onSubmit={send}>
              {header(<>To delete your account, sign in again. We'll send a code to {to}.</>)}
              {steps.turnstile}
              {problem}
              <AlertDialogFooter>
                {cancel}
                <AlertDialogAction
                  type="submit"
                  className={action}
                  disabled={busy || steps.waitsForCheck}
                >
                  {busy ? <Spinner /> : 'Send code'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </form>
          ) : (
            <form className="contents" onSubmit={confirmCode}>
              {header(<>Enter the code we sent to {to} to delete your account.</>)}
              <div className="grid gap-2">
                <CodeField
                  id="delete-account-code"
                  inputRef={codeField}
                  value={steps.code}
                  onChange={steps.setCode}
                />
              </div>
              {problem}
              <AlertDialogFooter>
                {cancel}
                <AlertDialogAction
                  type="submit"
                  variant="destructive"
                  className={action}
                  disabled={busy}
                >
                  {busy ? <Spinner /> : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </form>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

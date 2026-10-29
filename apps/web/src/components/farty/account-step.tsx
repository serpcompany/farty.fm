'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { readStepDraft, saveStepDraft } from '@/lib/account'
import { unsavedBeforeSignIn } from '@/lib/library-sync'
import { useAccount } from './account-provider'
import { CodeField, useSignInCode } from './sign-in-code'

export function AccountStep() {
  const { stepOpen } = useAccount()
  return stepOpen ? <Step /> : null
}

function Step() {
  const { account, skipStep, finishSignIn } = useAccount()
  const again = account.status === 'expired'
  const [draft] = useState(readStepDraft)
  const [email, setEmail] = useState(draft?.email ?? '')
  const steps = useSignInCode(email, true, draft?.phase)
  const { phase, busy } = steps
  const [unsaved, setUnsaved] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const emailField = useRef<HTMLInputElement>(null)
  const codeField = useRef<HTMLInputElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const focusedPhase = useRef<string | null>(null)

  useEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    if (phase === 'code') codeField.current?.focus()
    else if (focusedPhase.current === 'code') emailField.current?.focus()
    else heading.current?.focus()
    focusedPhase.current = phase
  }, [phase])

  const warns = unsaved > 0
  useEffect(() => {
    if (warns) backButton.current?.focus()
  }, [warns])

  useEffect(() => saveStepDraft({ phase, email }), [phase, email])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!steps.hasToken) {
      steps.checkAgainIfFailed()
      return
    }
    steps.setBusy(true)
    steps.setProblem(null)
    const losing = await unsavedBeforeSignIn(email).catch(() => 0)
    steps.setBusy(false)
    if (losing > 0) {
      setUnsaved(losing)
      return
    }
    await sendNow()
  }

  const goBack = () => {
    setUnsaved(0)
    requestAnimationFrame(() => emailField.current?.focus())
  }

  const sendNow = async () => {
    setUnsaved(0)
    await steps.send()
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    const signedIn = await steps.signIn()
    if (signedIn) finishSignIn(signedIn)
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="account-step-title"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:top-[calc(4rem+1px)] md:p-6"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 md:my-auto md:flex-none md:rounded-3xl md:border md:py-3 md:shadow-sm">
        <div className="flex flex-1 flex-col justify-center gap-6 py-6">
          <div className="space-y-2 text-center">
            <h1
              ref={heading}
              id="account-step-title"
              tabIndex={-1}
              className="text-3xl font-bold tracking-tight outline-none"
            >
              {again ? 'Sign in again' : 'Keep your farts'}
            </h1>
            <p className="text-muted-foreground">
              {again
                ? 'Your session ended. Your farts stay on this device until you sign in.'
                : 'Make a free account to keep your farts.'}
            </p>
          </div>

          {phase === 'email' && unsaved > 0 ? (
            <div className="grid gap-3" data-testid="account-step-unsaved">
              <p role="alert" className="text-center">
                {unsaved === 1
                  ? "1 fart on this device hasn't saved to the other account. Signing in here removes it from this device."
                  : `${unsaved} farts on this device haven't saved to the other account. Signing in here removes them from this device.`}
              </p>
              <Button ref={backButton} className="h-12 text-base" onClick={goBack}>
                Go back
              </Button>
              <Button
                variant="secondary"
                className="h-12 text-base"
                disabled={!steps.hasToken}
                onClick={() => void sendNow()}
              >
                Sign in anyway
              </Button>
            </div>
          ) : phase === 'email' ? (
            <form className="grid gap-3" onSubmit={send}>
              <label htmlFor="account-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                ref={emailField}
                id="account-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                className="h-12"
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
              {steps.turnstile}
              <Button
                type="submit"
                className="h-12 text-base"
                disabled={busy || steps.waitsForCheck}
              >
                {busy ? <Spinner /> : 'Send code'}
              </Button>
            </form>
          ) : (
            <form className="grid gap-3" onSubmit={submitCode}>
              <CodeField
                id="account-code"
                inputRef={codeField}
                value={steps.code}
                onChange={steps.setCode}
              >
                <p className="-mt-2 text-sm text-muted-foreground">
                  We sent a 6-digit code to <span className="text-foreground">{email.trim()}</span>.
                </p>
              </CodeField>
              <Button type="submit" className="h-12 text-base" disabled={busy}>
                {busy ? <Spinner /> : 'Sign in'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-base"
                onClick={() => {
                  steps.setProblem(null)
                  steps.setPhase('email')
                }}
              >
                Change email
              </Button>
            </form>
          )}

          {steps.message && (
            <p role="alert" className="text-center text-sm text-destructive">
              {steps.message}
            </p>
          )}

          <p className="text-center text-xs text-muted-foreground">
            We'll also send you Farty news. You can turn it off on Profile.{' '}
            <a
              href="/privacy/"
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center px-2 underline underline-offset-2"
            >
              Privacy
            </a>
          </p>
        </div>

        <div className="grid gap-2 pb-3">
          {!again && (
            <p
              className="text-center text-sm text-muted-foreground"
              data-testid="account-step-guest"
            >
              Without an account, your farts are gone when you close Farty.
            </p>
          )}
          <Button variant="secondary" className="h-12 text-base" onClick={skipStep}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  )
}

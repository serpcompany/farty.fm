'use client'

import { type FormEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  readStepDraft,
  type SignInProblem,
  saveStepDraft,
  sendCode,
  signIn,
  turnstileSiteKey
} from '@/lib/account'
import { unsavedBeforeSignIn } from '@/lib/library-sync'
import { useAccount } from './account-provider'
import { Turnstile } from './turnstile'

const messages: Record<SignInProblem, string> = {
  invalidEmail: 'Enter a valid email address.',
  wrongCode: "That code isn't right. Check it and try again.",
  codeExpired: 'That code no longer works. Send a new one.',
  tooManyTries: 'Too many tries. Wait a few minutes, then try again.',
  notChecked: "Couldn't check that you're a person. Try again.",
  unavailable: "Accounts aren't available right now.",
  failed: "Couldn't reach Farty. Check your connection and try again."
}

export function AccountStep() {
  const { stepOpen } = useAccount()
  return stepOpen ? <Step /> : null
}

function Step() {
  const { account, skipStep, finishSignIn } = useAccount()
  const again = account.status === 'expired'
  const [draft] = useState(readStepDraft)
  const [phase, setPhase] = useState(draft?.phase ?? 'email')
  const [email, setEmail] = useState(draft?.email ?? '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<SignInProblem | null>(null)
  const [unsaved, setUnsaved] = useState(0)
  const [siteKey, setSiteKey] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [widget, setWidget] = useState(0)
  const [checkFailed, setCheckFailed] = useState(false)
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

  const readSiteKey = async () => {
    const read = await turnstileSiteKey()
    if (read.ok) setSiteKey(read.value)
    else {
      setProblem(read.problem)
      setCheckFailed(true)
    }
  }
  const readSiteKeyOnShow = useEffectEvent(readSiteKey)
  const needsSiteKey = phase === 'email' && siteKey === null
  useEffect(() => {
    if (needsSiteKey) void readSiteKeyOnShow()
  }, [needsSiteKey])

  const checkAgain = () => {
    setCheckFailed(false)
    setProblem(null)
    if (siteKey === null) void readSiteKey()
    else setWidget(n => n + 1)
  }
  const checkAgainOnline = useEffectEvent(checkAgain)

  useEffect(() => {
    if (!checkFailed) return
    const again = () => checkAgainOnline()
    window.addEventListener('online', again)
    return () => window.removeEventListener('online', again)
  }, [checkFailed])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (token === null) {
      if (checkFailed) checkAgain()
      return
    }
    setBusy(true)
    setProblem(null)
    const losing = await unsavedBeforeSignIn(email).catch(() => 0)
    setBusy(false)
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
    if (token === null) return
    setUnsaved(0)
    setBusy(true)
    setProblem(null)
    const sent = await sendCode(email, token)
    setToken(null)
    setWidget(n => n + 1)
    setBusy(false)
    if (!sent.ok) {
      setProblem(sent.problem)
      return
    }
    setCode('')
    setPhase('code')
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    const result = await signIn(email, code)
    setBusy(false)
    if (result.ok) {
      finishSignIn(result.value)
      return
    }
    setProblem(result.problem)
    if (result.problem === 'codeExpired') setPhase('email')
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
                disabled={token === null}
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
              {siteKey && (
                <Turnstile
                  key={widget}
                  siteKey={siteKey}
                  onToken={setToken}
                  onFailed={() => {
                    setToken(null)
                    setProblem('failed')
                    setCheckFailed(true)
                  }}
                />
              )}
              <Button
                type="submit"
                className="h-12 text-base"
                disabled={busy || (token === null && !checkFailed)}
              >
                {busy ? <Spinner /> : 'Send code'}
              </Button>
            </form>
          ) : (
            <form className="grid gap-3" onSubmit={submitCode}>
              <label htmlFor="account-code" className="text-sm font-medium">
                Code
              </label>
              <p className="-mt-2 text-sm text-muted-foreground">
                We sent a 6-digit code to <span className="text-foreground">{email.trim()}</span>.
              </p>
              <Input
                ref={codeField}
                id="account-code"
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                className="h-12 text-center text-lg tracking-widest"
                value={code}
                onChange={event => setCode(event.target.value)}
              />
              <Button type="submit" className="h-12 text-base" disabled={busy}>
                {busy ? <Spinner /> : 'Sign in'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-base"
                onClick={() => {
                  setProblem(null)
                  setPhase('email')
                }}
              >
                Change email
              </Button>
            </form>
          )}

          {problem && (
            <p role="alert" className="text-center text-sm text-destructive">
              {messages[problem]}
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

'use client'

import { type ReactNode, type Ref, useEffect, useEffectEvent, useState } from 'react'
import { Input } from '@/components/ui/input'
import { type Account, type SignInProblem, sendCode, signIn, turnstileSiteKey } from '@/lib/account'
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

export type CodePhase = 'email' | 'code'

export function useSignInCode(email: string, showing: boolean, firstPhase: CodePhase = 'email') {
  const [phase, setPhase] = useState(firstPhase)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<SignInProblem | null>(null)
  const [siteKey, setSiteKey] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [widget, setWidget] = useState(0)
  const [checkFailed, setCheckFailed] = useState(false)

  const failCheck = (failure: SignInProblem) => {
    setProblem(failure)
    setCheckFailed(true)
  }

  const readSiteKey = async () => {
    const read = await turnstileSiteKey()
    if (read.ok) setSiteKey(read.value)
    else failCheck(read.problem)
  }
  const readSiteKeyOnShow = useEffectEvent(readSiteKey)
  const needsSiteKey = showing && phase === 'email' && siteKey === null
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

  const send = async () => {
    if (token === null) return
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

  const signInWithCode = async (): Promise<Account | null> => {
    setBusy(true)
    setProblem(null)
    const result = await signIn(email, code)
    setBusy(false)
    if (result.ok) return result.value
    setProblem(result.problem)
    if (result.problem === 'codeExpired') setPhase('email')
    return null
  }

  return {
    phase,
    setPhase,
    code,
    setCode,
    busy,
    setBusy,
    message: problem && messages[problem],
    setProblem,
    hasToken: token !== null,
    waitsForCheck: token === null && !checkFailed,
    checkAgainIfFailed: () => {
      if (checkFailed) checkAgain()
    },
    send,
    signIn: signInWithCode,
    turnstile:
      siteKey === null ? null : (
        <Turnstile
          key={widget}
          siteKey={siteKey}
          onToken={setToken}
          onFailed={() => {
            setToken(null)
            failCheck('failed')
          }}
        />
      )
  }
}

export function CodeField({
  id,
  inputRef,
  value,
  onChange,
  children
}: {
  id: string
  inputRef: Ref<HTMLInputElement>
  value: string
  onChange(value: string): void
  children?: ReactNode
}) {
  return (
    <>
      <label htmlFor={id} className="text-sm font-medium">
        Code
      </label>
      {children}
      <Input
        ref={inputRef}
        id={id}
        autoComplete="one-time-code"
        inputMode="numeric"
        required
        className="h-12 text-center text-lg tracking-widest"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </>
  )
}

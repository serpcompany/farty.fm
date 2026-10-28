'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import { welcomedKey } from '@/lib/welcomed'

type Welcome = {
  showsWelcome: boolean
  finishWelcome(): void
}

const WelcomeContext = createContext<Welcome | null>(null)

export function useWelcome(): Welcome {
  const welcome = useContext(WelcomeContext)
  if (!welcome) throw new Error('useWelcome needs a WelcomeProvider')
  return welcome
}

function rememberWelcomed(): void {
  document.documentElement.setAttribute('data-welcomed', '')
  try {
    localStorage.setItem(welcomedKey, '1')
  } catch {
    return
  }
}

export function WelcomeProvider({ children }: { children: ReactNode }) {
  const [showsWelcome, setShowsWelcome] = useState(false)

  useEffect(() => {
    setShowsWelcome(localStorage.getItem(welcomedKey) === null)
  }, [])

  const finishWelcome = useCallback(() => {
    rememberWelcomed()
    setShowsWelcome(false)
  }, [])

  const value = useMemo(() => ({ showsWelcome, finishWelcome }), [showsWelcome, finishWelcome])
  return <WelcomeContext value={value}>{children}</WelcomeContext>
}

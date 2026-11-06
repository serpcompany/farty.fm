'use client'

import { Lock, Mic, Music } from 'lucide-react'
import Image from 'next/image'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { askForMicrophone } from '@/lib/audio/recorder'
import { wide } from '@/lib/desktop'
import { FULL_ACCESS_PRICE_LABEL } from '@/lib/pricing'
import { reachStep } from '@/lib/telemetry/steps'
import { useFullAccessOffers } from './full-access-offers'
import { usePedos } from './pedos-provider'

/**
 * Says what Farty does and asks for the microphone before the first recording. First visit only.
 * Matches the iPhone app's `WelcomeSheet`, with Full Access offered beside it (#407), never in the
 * way of recording for free. On a touch tablet the lander takes its place at `/`, and
 * on a computer on every tab (`lander.tsx`).
 */
export function Welcome() {
  const pedos = usePedos()
  const { welcomeOffer, offerAtWelcome } = useFullAccessOffers()

  // Welcome shows only on a phone: wider, this stays mounted behind the lander.
  useEffect(() => {
    if (!window.matchMedia(wide).matches) reachStep('open')
  }, [])

  useEffect(() => {
    if (welcomeOffer === 'shows' && !window.matchMedia(wide).matches) {
      reachStep('offer-welcome-shown')
    }
  }, [welcomeOffer])

  async function allowMicrophone() {
    try {
      // Ask now, so the first Record tap records instead of prompting. Over Record, the
      // microphone stays open, so that first tap captures at once.
      await askForMicrophone()
      reachStep('mic-allowed')
    } catch {
      // Saying no is an answer, not an error: Record explains it if they tap it later.
    }
    pedos.finishWelcome()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex-1" />
        <Image
          src="/welcome-icon.png"
          alt=""
          width={88}
          height={88}
          // A small static PNG; Workers has no image optimizer configured.
          unoptimized
          priority
          className="mb-4 rounded-[20px]"
        />
        <h1 className="text-4xl font-bold tracking-tight">Farty</h1>
        <p className="mt-1 text-xl text-muted-foreground">
          Record your farts. Turn them into songs.
        </p>
        <ul className="mt-9 space-y-5 text-base">
          <li className="flex items-center gap-3">
            <Mic className="size-5 text-muted-foreground" aria-hidden />
            One fart per Recording
          </li>
          <li className="flex items-center gap-3">
            <Music className="size-5 text-muted-foreground" aria-hidden />
            Each fart has a note
          </li>
          <li className="flex items-center gap-3">
            <Lock className="size-5 text-muted-foreground" aria-hidden />
            Collect notes to unlock Songs
          </li>
        </ul>
        <div className="flex-1" />
        <div className="space-y-2">
          <Button size="lg" className="h-12 w-full text-base" onClick={allowMicrophone}>
            Allow microphone
          </Button>
          {welcomeOffer !== 'none' && (
            <Button
              size="lg"
              variant="secondary"
              className="h-12 w-full text-base"
              disabled={welcomeOffer === 'unsure'}
              onClick={offerAtWelcome}
            >
              Get Full Access for {FULL_ACCESS_PRICE_LABEL}
            </Button>
          )}
          <Button
            size="lg"
            variant="ghost"
            className="h-12 w-full text-base"
            onClick={pedos.finishWelcome}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  )
}

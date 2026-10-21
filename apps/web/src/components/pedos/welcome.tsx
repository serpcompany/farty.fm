'use client'

import { Lock, Mic, Music } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { askForMicrophone } from '@/lib/audio/recorder'
import { usePedos } from './pedos-provider'

/**
 * Says what Farty does and asks for the microphone before the first recording. First visit only.
 * Matches the iPhone app's `WelcomeSheet`. From 768px it's a hero above the app instead of a
 * full-screen sheet.
 */
export function Welcome() {
  const pedos = usePedos()

  async function allowMicrophone() {
    try {
      // Ask now, so the first Record tap records instead of prompting. Over Record, the
      // microphone stays open, so that first tap captures at once.
      await askForMicrophone()
    } catch {
      // Saying no is an answer, not an error: Record explains it if they tap it later.
    }
    pedos.finishWelcome()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] md:static md:z-auto md:border-b md:px-6 md:py-14">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-4xl md:items-center md:text-center">
        <div className="flex-1 md:hidden" />
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
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Farty</h1>
        <p className="mt-1 text-xl text-muted-foreground md:mt-3 md:text-2xl">
          Record your farts. Turn them into songs.
        </p>
        <ul className="mt-9 space-y-5 text-base md:flex md:gap-10 md:space-y-0">
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
        <div className="flex-1 md:hidden" />
        <div className="space-y-2 md:mt-10 md:flex md:gap-3 md:space-y-0">
          <Button
            size="lg"
            className="h-12 w-full text-base md:w-auto md:px-8"
            onClick={allowMicrophone}
          >
            Allow microphone
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="h-12 w-full text-base md:w-auto md:px-8"
            onClick={pedos.finishWelcome}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  )
}

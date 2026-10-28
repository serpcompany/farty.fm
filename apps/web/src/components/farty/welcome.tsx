'use client'

import { Lock, Mic, Music } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { askForMicrophone } from '@/lib/audio/keep-microphone-open'
import { useWelcome } from './welcome-provider'

export function Welcome() {
  const { finishWelcome } = useWelcome()

  async function allowMicrophone() {
    await askForMicrophone().catch(() => undefined)
    finishWelcome()
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
          <Button
            size="lg"
            variant="ghost"
            className="h-12 w-full text-base"
            onClick={finishWelcome}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  )
}

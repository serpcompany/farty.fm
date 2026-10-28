'use client'

import type { ReactNode } from 'react'
import { PlaybackProvider } from './playback-provider'
import { RecordFlowProvider } from './record-flow-provider'
import { RecordingsProvider } from './recordings-provider'
import { TootsProvider } from './toots-provider'
import { WelcomeProvider } from './welcome-provider'

export function PedosProvider({ children }: { children: ReactNode }) {
  return (
    <WelcomeProvider>
      <PlaybackProvider>
        <RecordingsProvider>
          <TootsProvider>
            <RecordFlowProvider>{children}</RecordFlowProvider>
          </TootsProvider>
        </RecordingsProvider>
      </PlaybackProvider>
    </WelcomeProvider>
  )
}

'use client'

import type { ReactNode } from 'react'
import { PlaybackProvider } from './playback-provider'
import { RecordFlowProvider } from './record-flow-provider'
import { RecordingsProvider } from './recordings-provider'
import { SongCatalogProvider } from './song-catalog-provider'
import { TootsProvider } from './toots-provider'
import { WelcomeProvider } from './welcome-provider'

export function FartyProvider({ children }: { children: ReactNode }) {
  return (
    <WelcomeProvider>
      <PlaybackProvider>
        <SongCatalogProvider>
          <RecordingsProvider>
            <TootsProvider>
              <RecordFlowProvider>{children}</RecordFlowProvider>
            </TootsProvider>
          </RecordingsProvider>
        </SongCatalogProvider>
      </PlaybackProvider>
    </WelcomeProvider>
  )
}

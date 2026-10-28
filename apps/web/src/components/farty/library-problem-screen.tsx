'use client'

import type { LibraryProblem } from './recordings-provider'
import { ReloadScreen } from './reload-screen'

const messages: Record<LibraryProblem, { title: string; description: string }> = {
  newer: {
    title: 'Farty was updated',
    description: 'Your library was saved by a newer version of Farty. Reload to open it.'
  },
  unreadable: {
    title: 'Farty can’t open your library',
    description: 'Your browser didn’t let Farty read its storage. Reload to try again.'
  }
}

export function LibraryProblemScreen({ problem }: { problem: LibraryProblem }) {
  return <ReloadScreen {...messages[problem]} />
}

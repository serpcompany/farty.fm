import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'

const navigation = vi.hoisted(() => ({ segments: [] as string[] }))

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegments: () => navigation.segments,
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('@/lib/audio/player', () => ({ stopPlayback: vi.fn() }))
vi.mock('@/lib/recording-store', () => ({ onWaitingForOtherTabs: () => () => {} }))
vi.mock('./recordings-provider', () => ({
  useRecordings: () => ({ libraryProblem: 'unreadable' })
}))
vi.mock('./welcome-provider', () => ({
  useWelcome: () => ({ showsWelcome: false, finishWelcome: vi.fn() })
}))
vi.mock('./record-flow-provider', () => ({
  useRecordFlow: () => ({ showsRecordFlow: false, flow: null, capture: { kind: 'idle' } })
}))
vi.mock('./account-provider', () => ({ useAccount: () => ({ stepOpen: false }) }))
vi.mock('./previous-page', () => ({ useTrackPages: () => {} }))
vi.mock('./lander', () => ({ appMain: 'app-main', Lander: () => null }))
vi.mock('./record-flow', () => ({ RecordFlow: () => null }))
vi.mock('./account-step', () => ({ AccountStep: () => null }))
vi.mock('./welcome', () => ({ Welcome: () => null }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const unmounts: (() => void)[] = []

async function showAt(segments: string[]): Promise<HTMLElement> {
  navigation.segments = segments
  const container = document.createElement('div')
  const root = createRoot(container)
  unmounts.push(() => root.unmount())
  await act(async () =>
    root.render(
      <AppShell qrCode={null}>
        <h1>The page</h1>
      </AppShell>
    )
  )
  return container
}

afterEach(() => {
  for (const unmount of unmounts.splice(0)) act(unmount)
})

describe('AppShell, when the library won’t open', () => {
  it('replaces a tab’s screen with the problem and a Reload button', async () => {
    const shell = await showAt(['recordings'])
    expect(shell.textContent).toContain('Farty can’t open your library')
    expect(shell.textContent).not.toContain('The page')
  })

  it.each([
    ['privacy', ['privacy']],
    ['support', ['support']],
    ['404', ['/_not-found']]
  ])('still shows the %s page, which needs no library', async (_, segments) => {
    const shell = await showAt(segments)
    expect(shell.textContent).toContain('The page')
    expect(shell.textContent).not.toContain('Farty can’t open your library')
  })
})

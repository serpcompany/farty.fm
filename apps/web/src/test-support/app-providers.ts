import { vi } from 'vitest'

vi.mock('@/lib/audio/keep-microphone-open', () => ({ keepMicrophoneOpen: () => undefined }))
vi.mock('@/lib/analysis-upgrade', () => ({ upgradeAnalyses: async () => {} }))
vi.mock('@/lib/audio/player', () => ({
  forgetDecoded: () => undefined,
  play: async () => {},
  playbackPosition: () => null,
  stopPlayback: () => undefined
}))
vi.mock('@/lib/audio/context', () => ({ startAudioInTap: () => undefined }))
vi.mock('@/lib/library-changes', () => ({
  onLibraryChanged: () => () => {},
  recordingsAfter: (list: unknown) => list
}))
vi.mock('@/lib/toot-store', () => ({ loadToots: async () => [] }))
vi.mock('@/lib/catalog/load-songs', () => import('./fake-load-songs'))
vi.mock('@/lib/toot-renderer', () => ({ makeToot: () => new Promise(() => {}) }))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/stale-build', () => ({ holdReload: () => () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({}), usePathname: () => '/' }))
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  preload: () => undefined
}))

import type { Metadata } from 'next'
import { SoundPad } from '@/components/pedos/sound-pad'

export const metadata: Metadata = { title: 'Sound Pad · Farty' }

// The Sound Pad, inside the Compose tab: `/compose/pad/`. A static segment, so it comes before
// the Songs' `[song]` (no Song's id is `pad`: `pads.test.ts`).
export default function SoundPadPage() {
  return <SoundPad />
}

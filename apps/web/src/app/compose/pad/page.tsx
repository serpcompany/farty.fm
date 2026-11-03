import type { Metadata } from 'next'
import { SoundPad } from '@/components/farty/sound-pad'

export const metadata: Metadata = { title: 'Sound Pad · Farty' }

export default function SoundPadPage() {
  return <SoundPad />
}

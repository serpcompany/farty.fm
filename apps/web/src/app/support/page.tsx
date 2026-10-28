import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Support · Farty' }

const questions = [
  {
    q: "Farty can't use the microphone.",
    a: "Allow the microphone for this site in your browser's site settings, then reload. Farty only listens while you are recording."
  },
  {
    q: 'It says "No steady note this time".',
    a: 'Some farts are just noise, with no clear pitch. The Recording is still saved, but it can’t play melody notes. Try again: longer, steadier farts are more likely to hold a note.'
  },
  {
    q: 'It says "Didn’t catch that".',
    a: 'Farty heard nothing louder than the room. Hold the phone closer, tap Record, and tap Stop after the fart.'
  },
  {
    q: 'It says "We kept the first fart".',
    a: 'Farty keeps the first fart in a Recording. Record one fart at a time.'
  },
  {
    q: 'Where are my Recordings? Can you recover them?',
    a: 'Without an account, they’re gone when you close Farty, and we never receive them, so we can’t recover them. With a free account, they’re kept with your account, on any phone or tablet you sign in on.'
  }
]

export default function SupportPage() {
  return (
    <article className="flex flex-col gap-3 px-4 pt-4 pb-6 text-sm leading-relaxed [&_a]:underline [&_h2]:pt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5">
      <h1 className="text-3xl font-bold tracking-tight">Support</h1>
      <p>
        Farty records your farts and finds the note of each one, using only your Recordings as
        sound.
      </p>
      <p>
        <strong>Contact:</strong> <a href="mailto:devin@serp.co">devin@serp.co</a>. Please include
        your browser, your device and what you were doing.
      </p>

      <h2>How it works</h2>
      <ol>
        <li>
          <strong>Record.</strong> On the Record tab, tap the big red button, fart, and tap Stop.
          One fart per Recording.
        </li>
        <li>
          <strong>Save.</strong> Farty finds the fart&apos;s note, like G3, or tells you it is
          noise-like.
        </li>
        <li>
          <strong>Find it again.</strong> Every saved Recording is on the Recordings tab with its
          note. Play or delete it there.
        </li>
      </ol>

      <h2>Questions</h2>
      {questions.map(({ q, a }) => (
        <div key={q} className="flex flex-col gap-1">
          <h3 className="font-semibold">{q}</h3>
          <p>{a}</p>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">Does Farty collect my data?</h3>
        <p>
          No. See the <Link href="/privacy/">privacy policy</Link>.
        </p>
      </div>
    </article>
  )
}

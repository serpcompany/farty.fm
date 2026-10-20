import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Privacy · Pedos' }

export default function PrivacyPage() {
  return (
    <article className="flex flex-col gap-3 px-4 pt-4 pb-6 text-sm leading-relaxed [&_a]:underline [&_h2]:pt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
      <h1 className="text-3xl font-bold tracking-tight">Privacy</h1>
      <p className="text-muted-foreground">Last updated: October 21, 2026</p>
      <p>
        Pedos records your farts, finds the note of each one, and plays songs with them. This policy
        explains what happens to your data. The short version:{' '}
        <strong>it stays in your browser.</strong>
      </p>

      <h2>What Pedos keeps, and where</h2>
      <ul>
        <li>
          <strong>Your Recordings.</strong> When you tap Record, Pedos uses your microphone until
          you tap Stop. If you save the take, it is kept in your browser&apos;s own storage on your
          device. If you discard it, it is deleted.
        </li>
        <li>
          <strong>What Pedos works out from them.</strong> Pedos analyzes each saved Recording in
          your browser to find its note, and keeps that result next to the Recording.
        </li>
        <li>
          <strong>The songs you make (Toots).</strong> They are made in your browser from your
          Recordings.
        </li>
        <li>
          <strong>One setting:</strong> whether you have already seen the welcome screen.
        </li>
      </ul>
      <p>
        Pedos only uses the microphone while you are recording, and only after you have allowed it.
        You can turn microphone access off at any time in your browser&apos;s site settings.
      </p>

      <h2>What Pedos doesn&apos;t do</h2>
      <ul>
        <li>
          It doesn&apos;t send your Recordings, or anything else you make, to us or to anyone.
          Recording, analysis and playback all happen in your browser.
        </li>
        <li>It has no accounts or sign-in, and it is free.</li>
        <li>It has no ads, analytics or tracking, and contains no third-party code that does.</li>
        <li>It doesn&apos;t sell or share data, because it doesn&apos;t collect any.</li>
      </ul>
      <p>
        Opening the site is an ordinary web request, like any website. Pedos runs on Cloudflare,
        which keeps logs of requests to the site, such as the time, the page asked for and the
        details your browser sends with every request. Pedos reads them only to run the site and fix
        problems.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Delete a Recording or a Toot in Pedos, or clear this site&apos;s data in your browser&apos;s
        settings to remove everything Pedos stored. Because it only exists in your browser, we
        can&apos;t recover it for you.
      </p>

      <h2>Children</h2>
      <p>Pedos doesn&apos;t collect personal information from anyone, including children.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the new version will be posted here with a new date. If Pedos ever
        starts sending data off your device, this policy will say so first.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy: <a href="mailto:privacy@serp.co">privacy@serp.co</a>
      </p>
    </article>
  )
}

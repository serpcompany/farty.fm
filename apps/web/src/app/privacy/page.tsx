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
        <strong>without an account, nothing you record is kept.</strong>
      </p>

      <h2>Without an account</h2>
      <p>
        Nothing you record is kept. Your Recordings and Toots last only until you close Pedos, and
        they stay in your browser on your device. We never receive them.
      </p>

      <h2>With an account</h2>
      <ul>
        <li>
          Your email, Recordings and Toots (audio included) are stored on Cloudflare, in your
          account, so you can use them on any device.
        </li>
        <li>
          Your email is used for sign-in codes and for Pedos news, which is on by default. You can
          unsubscribe from any email or on Profile. It&apos;s never sold.
        </li>
      </ul>

      <h2>The microphone</h2>
      <p>
        Pedos only uses the microphone while you are recording, and only after you have allowed it.
        You can turn microphone access off at any time in your browser&apos;s site settings. Pedos
        analyzes each Recording in your browser to find its note.
      </p>

      <h2>Error reports and usage</h2>
      <p>
        These help us find what breaks and see how many people use Pedos. Neither says who you are,
        and neither uses cookies.
      </p>
      <ul>
        <li>
          <strong>Error reports.</strong> When something goes wrong, such as a Recording that
          couldn&apos;t be saved, your browser tells Pedos which problem it was, the kind of error,
          the screen you were on, the Pedos version and how long the report waited offline. It never
          includes your farts, their names, your email or anything you type. Cloudflare keeps
          reports in Pedos&apos;s logs for up to 7 days.
        </li>
        <li>
          <strong>Usage.</strong> On pedos.app, Cloudflare Web Analytics counts visits: the page,
          the site you came from, your browser and device type, your country and how fast the page
          loaded. Cloudflare keeps the full records for 7 days and a sampled summary for 6 months.
        </li>
      </ul>
      <p>
        To stop both, turn off Share anonymous error reports and usage on Profile. It&apos;s kept in
        this browser, so turn it off in each browser you use. Pedos also sends neither when your
        browser sends Global Privacy Control. Because neither says who you are, we can&apos;t find
        one person&apos;s to delete; they go when Cloudflare&apos;s time is up.
      </p>

      <h2>What Pedos doesn&apos;t do</h2>
      <ul>
        <li>It has no ads, and nothing in it follows you to other sites.</li>
        <li>It doesn&apos;t sell your data.</li>
      </ul>
      <p>
        Opening the site is an ordinary web request, like any website. Pedos runs on Cloudflare,
        which keeps logs of requests to the site, such as the time, the page asked for and the
        details your browser sends with every request. Pedos reads them only to run the site and fix
        problems.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Delete account on Profile removes your email, Recordings and Toots. Without an account,
        close Pedos and everything is gone.
      </p>

      <h2>Children</h2>
      <p>
        Pedos doesn&apos;t ask anyone&apos;s age. Without an account it collects nothing that says
        who you are. An account needs only an email address, so please ask a parent or guardian
        before making one. If a child&apos;s email is on an account, write to us and we&apos;ll
        delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the new version will be posted here with a new date. If we ever
        change what Pedos keeps, this policy will say so first.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy: <a href="mailto:support@pedos.app">support@pedos.app</a>
      </p>
    </article>
  )
}

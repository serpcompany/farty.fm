import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Privacy · Farty' }

export default function PrivacyPage() {
  return (
    <article className="flex flex-col gap-3 px-4 pt-4 pb-6 text-sm leading-relaxed [&_a]:underline [&_h2]:pt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
      <h1 className="text-3xl font-bold tracking-tight">Privacy</h1>
      <p className="text-muted-foreground">Last updated: October 28, 2026</p>
      <p>
        Farty records your farts, finds the note of each one, and plays songs with them. This policy
        explains what happens to your data. The short version:{' '}
        <strong>without an account, nothing you record leaves your device.</strong>
      </p>

      <h2>Without an account</h2>
      <p>
        Your Recordings and Toots stay in your browser on your device, and only until you close
        Farty. We never receive them.
      </p>

      <h2>With an account</h2>
      <ul>
        <li>
          Your email, Recordings and Toots (audio included) are stored on Cloudflare, in your
          account, so you can use them on any phone or tablet you sign in on.
        </li>
        <li>
          Your email is used for sign-in codes and for Farty news, which is on by default. You can
          unsubscribe from any email or on Profile. It&apos;s never sold.
        </li>
        <li>
          Before Farty sends a sign-in code, Cloudflare Turnstile checks that a person asked for it.
          Cloudflare&apos;s use of what it reads from your browser is described in its{' '}
          <a href="https://www.cloudflare.com/turnstile-privacy-policy/">
            Turnstile privacy addendum
          </a>
          .
        </li>
      </ul>

      <h2>Payments</h2>
      <p>
        When you pay to save a Toot, Stripe processes the payment on its own checkout page. Your
        card details go to Stripe and never reach Farty. Farty keeps which Toot was paid for, when,
        and Stripe&apos;s reference for the payment. Stripe&apos;s use of your data is described in
        its <a href="https://stripe.com/privacy">privacy policy</a>.
      </p>

      <h2>The microphone</h2>
      <p>
        Farty only uses the microphone while you are recording, and only after you have allowed it.
        You can turn microphone access off at any time in your browser&apos;s site settings. Farty
        analyzes each Recording in your browser to find its note.
      </p>

      <h2>Error reports</h2>
      <p>
        When something goes wrong, such as a Recording that couldn&apos;t be saved, your browser
        tells Farty which problem it was, the kind of error, the screen you were on, the Farty
        version and how long the report waited offline. It never includes your farts, their names,
        your email or anything you type, and it&apos;s sent without cookies. Cloudflare keeps
        reports in Farty&apos;s logs for up to 7 days.
      </p>
      <p>
        To stop error reports, turn off Share anonymous error reports on Profile. It&apos;s kept in
        this browser, so turn it off in each browser you use. Farty also sends none when your
        browser sends Global Privacy Control.
      </p>

      <h2>Page views</h2>
      <p>
        Cloudflare Web Analytics counts page views on every page of Farty: the page, the site you
        came from, your browser and device type, your country and how fast the page loaded. It uses
        no cookies and doesn&apos;t include your account, name or email. Cloudflare keeps the full
        records for 7 days and a sampled summary for 6 months. The switch and Global Privacy Control
        don&apos;t stop it: they stop error reports.
      </p>

      <h2>What Farty doesn&apos;t do</h2>
      <ul>
        <li>It has no ads, and nothing in it follows you to other sites.</li>
        <li>It doesn&apos;t sell your data.</li>
      </ul>
      <p>
        Farty runs on Cloudflare. Like any website, it logs every request, error reports included:
        Cloudflare&apos;s request log keeps your IP address, browser and rough location, with the
        time and the page, for up to 7 days. Farty reads it only to run the site and fix problems,
        and briefly uses your IP address to limit how many error reports one device can send.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Delete account on Profile removes your email, Recordings, Toots and Farty&apos;s record of
        your payments. Stripe keeps its own record of each payment. Without an account, delete a
        Recording on the Recordings tab, or clear this site&apos;s data in your browser to remove
        everything.
      </p>

      <h2>Children</h2>
      <p>
        Farty doesn&apos;t ask anyone&apos;s age. Without an account it never asks for a name or
        email. An account needs only an email address, so please ask a parent or guardian before
        making one. If a child&apos;s email is on an account, write to us and we&apos;ll delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the new version will be posted here with a new date. If we ever
        change what Farty keeps, this policy will say so first.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy: <a href="mailto:support@farty.fm">support@farty.fm</a>
      </p>
    </article>
  )
}

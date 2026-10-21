'use client'

import { ArrowRight, AudioLines, Ear, Music2, UserRound } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { usePedos } from './pedos-provider'

/** From 768px (Tailwind's `md`), as a media query. */
export const desktop = '(min-width: 48rem)'

/** The app's `main` (`app-shell.tsx`), where focus goes once the lander hides. */
export const appMain = 'app'

/**
 * Farty's product page at `/`, from 768px, until the app has been opened in this browser. Open
 * Farty shows the app on the same page; Sign up opens the account step in it. Phones never see it,
 * or download its images: they get Welcome.
 */
export function Lander() {
  const pedos = usePedos()
  const { openStep } = useAccount()

  function openFarty() {
    pedos.finishWelcome()
    window.scrollTo({ top: 0 })
    // The lander, and the button just pressed, are hidden now, so focus moves to the app instead of
    // dropping to the page. The account step, opened next by Sign up, gives it back here too.
    document.getElementById(appMain)?.focus({ preventScroll: true })
  }

  function signUp() {
    openFarty()
    openStep()
  }

  return (
    <div id="top" className="hidden md:unwelcomed:block">
      <header className="sticky top-0 z-40 px-4 pt-4">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 rounded-2xl border bg-background/80 pr-2.5 pl-4 shadow-sm backdrop-blur">
          <a
            href="#top"
            className="flex h-11 items-center gap-2.5 rounded-md text-lg font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Image
              src="/icons/icon-192.png"
              alt=""
              width={32}
              height={32}
              unoptimized
              className="rounded-lg"
            />
            Farty
          </a>
          <nav aria-label="Sections" className="flex">
            <SectionLink href="#features">Features</SectionLink>
            <SectionLink href="#how-it-works">How it works</SectionLink>
            <SectionLink href="#faq">FAQ</SectionLink>
          </nav>
          <div className="flex gap-1.5">
            <Button variant="ghost" className="h-11 px-4 text-sm" onClick={signUp}>
              Sign in
            </Button>
            <Button
              className="h-11 bg-brand-strong px-5 text-sm text-white hover:bg-brand-strong/90"
              onClick={openFarty}
            >
              Open Farty
            </Button>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[46rem] bg-[radial-gradient(55%_60%_at_50%_0%,color-mix(in_oklch,var(--brand)_24%,transparent),transparent)]"
        />
        <div className="mx-auto max-w-5xl px-6 pt-16 text-center lg:pt-20">
          <h1 className="text-5xl font-bold tracking-tight text-balance lg:text-6xl">
            Record your farts. <span className="text-brand">Turn them into songs.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground lg:text-xl">
            Farty finds the note in each fart, then plays songs with your own farts.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button
              className="h-12 bg-brand-strong px-7 text-base text-white hover:bg-brand-strong/90"
              onClick={openFarty}
            >
              Open Farty
              <ArrowRight className="size-5" aria-hidden />
            </Button>
            <Button variant="outline" className="h-12 px-7 text-base" onClick={signUp}>
              Sign up free
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Free, in this browser. Nothing to download.
          </p>
        </div>
        <div className="mx-auto mt-14 flex max-w-5xl items-start justify-center gap-8 px-6">
          <Phone
            src="/lander/result.webp"
            alt="Farty's Result screen: your note is G3, and Mary Had a Little Lamb has 1 of 4 notes covered."
            className="mt-24 hidden w-60 -rotate-6 lg:block"
          />
          <Phone
            src="/lander/song.webp"
            alt="Farty playing Mary Had a Little Lamb with 4 of your Recordings, one per note."
            className="w-72"
            first
          />
          <Phone
            src="/lander/compose.webp"
            alt="Farty's Compose tab: 12 unlocked Songs, each Ready to play."
            className="mt-24 hidden w-60 rotate-6 lg:block"
          />
        </div>
      </section>

      <section id="features" className="scroll-mt-24 border-t py-24">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            eyebrow="Features"
            title="Songs, played by your farts"
            text="Everything Farty plays comes from your own Recordings."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, text }) => (
              <Card key={title}>
                <CardHeader>
                  <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-brand/12 text-brand">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription className="text-base">{text}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24 border-t bg-muted/40 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading eyebrow="How it works" title="From one fart to a whole song" />
          <ol className="mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {steps.map(({ title, text }, index) => (
              <li key={title} className="relative">
                <span className="flex size-11 items-center justify-center rounded-full bg-brand-strong text-lg font-bold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="faq" className="scroll-mt-24 border-t py-24">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[2fr_3fr]">
          <div>
            <SectionHeading eyebrow="FAQ" title="Questions" align="left" />
            <p className="mt-4 text-muted-foreground">
              Something else?{' '}
              <Link
                href="/support/"
                className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
              >
                Ask Support
              </Link>
              .
            </p>
          </div>
          <dl className="divide-y rounded-xl border bg-card">
            {faq.map(({ question, answer }) => (
              <div key={question} className="p-5">
                <dt className="font-semibold">{question}</dt>
                <dd className="mt-1.5 text-muted-foreground">{answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="mx-auto grid max-w-6xl items-center gap-8 overflow-hidden rounded-3xl border bg-brand/8 px-8 pt-12 md:grid-cols-[3fr_2fr] lg:px-16">
          <div className="pb-12">
            <h2 className="text-4xl font-bold tracking-tight text-balance">Make your first Toot</h2>
            <p className="mt-4 max-w-md text-lg text-muted-foreground">
              Record a fart, see its note, and start collecting. It's free.
            </p>
            <Button
              className="mt-8 h-12 bg-brand-strong px-7 text-base text-white hover:bg-brand-strong/90"
              onClick={openFarty}
            >
              Open Farty
              <ArrowRight className="size-5" aria-hidden />
            </Button>
          </div>
          <div className="h-80 self-end overflow-hidden">
            <Phone
              src="/lander/record.webp"
              alt="Farty's Record tab: one big red button."
              className="mx-auto w-52 rounded-b-none border-b-0 lg:w-64"
            />
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-10">
          <div className="flex items-center gap-3">
            <Image
              src="/icons/icon-192.png"
              alt=""
              width={28}
              height={28}
              unoptimized
              className="rounded-md"
            />
            <span className="font-semibold">Farty</span>
            <span className="text-sm text-muted-foreground">
              Record your farts. Turn them into songs.
            </span>
          </div>
          <nav aria-label="Footer" className="flex gap-2 text-sm">
            <FooterLink href="/privacy/">Privacy</FooterLink>
            <FooterLink href="/support/">Support</FooterLink>
          </nav>
        </div>
      </footer>
    </div>
  )
}

const features = [
  {
    icon: AudioLines,
    title: 'Only real farts',
    text: 'Every note you hear is one of your Recordings, shifted to the right pitch. No synths.'
  },
  {
    icon: Music2,
    title: 'Songs you know',
    text: 'Twinkle, Twinkle, Jingle Bells, Ode to Joy and more, from public-domain scores.'
  },
  {
    icon: Ear,
    title: 'Hear every note',
    text: 'Tap a note in a Song to hear just that note, and which fart played it.'
  },
  {
    icon: UserRound,
    title: 'Keep them anywhere',
    text: 'Sign in with your email to keep your Recordings and Toots on any device.'
  }
]

const steps = [
  {
    title: 'Record a fart',
    text: 'Tap the red button, fart, and tap Stop. One fart per Recording.'
  },
  { title: 'Get its note', text: 'Farty finds the note in your fart, such as G3.' },
  {
    title: 'Unlock a Song',
    text: 'Each Song needs a different fart near each of its notes. Compose shows how close you are.'
  },
  {
    title: 'Save a Toot',
    text: 'An unlocked Song plays with your farts. Save it to Toots to play again.'
  }
]

const faq = [
  { question: 'Is Farty free?', answer: 'Yes. Farty is free, and so is an account.' },
  {
    question: 'Do I need to download anything?',
    answer: 'No. Farty runs in your browser. On a phone you can add it to your Home Screen.'
  },
  {
    question: 'Where do my farts go?',
    answer:
      'Without an account they stay in this browser, and are gone when you close Farty. Sign in with your email to keep them on any device.'
  },
  {
    question: 'Why has my fart got no note?',
    answer: "Some farts are noise-like, with no steady pitch. They're kept, but can't play a note."
  }
]

function SectionHeading({
  eyebrow,
  title,
  text,
  align = 'center'
}: {
  eyebrow: string
  title: string
  text?: string
  align?: 'center' | 'left'
}) {
  return (
    <div className={cn(align === 'center' && 'mx-auto max-w-2xl text-center')}>
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">{eyebrow}</p>
      <h2 className="mt-2 text-4xl font-bold tracking-tight text-balance">{title}</h2>
      {text && <p className="mt-4 text-lg text-muted-foreground">{text}</p>}
    </div>
  )
}

/** A real screenshot of Farty on a phone, in a plain device frame. */
function Phone({
  src,
  alt,
  className,
  first
}: {
  src: string
  alt: string
  className?: string
  /** The hero's: fetched first. */
  first?: boolean
}) {
  return (
    <div
      className={cn(
        'shrink-0 rounded-[2.75rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl ring-1 ring-black/10 dark:border-neutral-800 dark:ring-white/10',
        className
      )}
    >
      <picture>
        {/* Below 768px the browser takes the blank pixel instead, so a phone downloads nothing. */}
        <source media={desktop} srcSet={src} />
        <img
          src={blank}
          alt={alt}
          width={780}
          height={1688}
          // Lazy, so a hidden lander, once Farty has been opened, downloads nothing either.
          loading="lazy"
          decoding="async"
          fetchPriority={first ? 'high' : undefined}
          className="h-auto w-full rounded-[2.1rem]"
        />
      </picture>
    </div>
  )
}

/** A transparent pixel. */
const blank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </a>
  )
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center rounded-md px-3 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  )
}

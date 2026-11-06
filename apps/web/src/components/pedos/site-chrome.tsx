import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The site's header and footer, on the lander and on `/@<handle>/` pages (#441).

const sections = [
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'faq', label: 'FAQ' }
]

/**
 * The bar at the top of the page: Farty, which goes to `home`, the lander's sections, on the
 * lander's own page or `sectionsOn` another, and `children`.
 */
export function SiteHeader({
  home,
  sectionsOn = '',
  sectionsClassName = 'flex',
  children
}: {
  home: string
  sectionsOn?: string
  sectionsClassName?: string
  children: ReactNode
}) {
  return (
    <header className="sticky top-[env(safe-area-inset-top)] z-40 px-4 pt-4">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 rounded-2xl border bg-background/80 pr-2.5 pl-4 shadow-sm backdrop-blur">
        <Link
          href={home}
          className="flex h-11 items-center gap-2.5 rounded-md text-lg font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={32}
            height={32}
            // A small static PNG; Workers has no image optimizer configured.
            unoptimized
            className="rounded-lg"
          />
          Farty
        </Link>
        <nav aria-label="Sections" className={sectionsClassName}>
          {sections.map(({ id, label }) => (
            <Link
              key={id}
              href={`${sectionsOn}#${id}`}
              className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex gap-1.5">{children}</div>
      </div>
    </header>
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

/** The site's footer: Farty, its line, Privacy and Support. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t', className)}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-8 md:py-10">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
        <nav aria-label="Footer" className="-mx-3 flex gap-2 text-sm md:mx-0">
          <FooterLink href="/privacy/">Privacy</FooterLink>
          <FooterLink href="/support/">Support</FooterLink>
        </nav>
      </div>
    </footer>
  )
}

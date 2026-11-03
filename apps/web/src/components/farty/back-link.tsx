'use client'

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { cameFrom } from './previous-page'

export function useGoBack(href: string): () => void {
  const router = useRouter()
  return () => {
    if (cameFrom(href)) router.back()
    else router.replace(href)
  }
}

export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter()
  return (
    <Link
      href={href}
      replace
      onClick={event => {
        if (!cameFrom(href)) return
        event.preventDefault()
        router.back()
      }}
      aria-label={label}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11')}
    >
      <ChevronLeft className="size-6" />
    </Link>
  )
}

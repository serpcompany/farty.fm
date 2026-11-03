'use client'

import { Dialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CoverName = { title: string; label?: never } | { title?: never; label: string }

export function Cover({
  title,
  label,
  tone,
  action,
  onClose,
  children
}: CoverName & {
  tone?: 'record'
  action?: ReactNode
  onClose?: () => void
  children: ReactNode
}) {
  const page =
    'contents md:fixed md:inset-x-0 md:top-[calc(4rem+1px)] md:bottom-0 md:z-40 md:flex md:items-center md:justify-center md:bg-background md:p-6'
  const card = cn(
    'fixed inset-0 z-40 flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none md:static md:h-full md:max-h-[44rem] md:w-full md:max-w-md md:rounded-3xl md:border md:py-3 md:shadow-sm',
    tone === 'record' && 'bg-record-screen text-record-foreground md:border-transparent'
  )
  const content = (
    <>
      <header
        className={cn(
          'relative flex h-12 shrink-0 items-center justify-center px-4',
          action && 'px-14'
        )}
      >
        {title && <h1 className="truncate font-semibold">{title}</h1>}
        {action && <div className="absolute top-1/2 right-2 -translate-y-1/2">{action}</div>}
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">{children}</div>
    </>
  )
  if (onClose) {
    return (
      <Dialog.Root open disablePointerDismissal onOpenChange={open => !open && onClose()}>
        <Dialog.Portal>
          <div className={page}>
            <Dialog.Popup aria-modal aria-label={title ?? label} className={card}>
              {content}
            </Dialog.Popup>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    )
  }
  return (
    <div className={page}>
      <div role="dialog" aria-modal aria-label={title ?? label} className={card}>
        {content}
      </div>
    </div>
  )
}

export function FlowButtons({ secondary, primary }: { secondary?: ReactNode; primary: ReactNode }) {
  return (
    <div className={cn('grid gap-3 px-5 pb-3', secondary && 'grid-cols-2')}>
      {secondary}
      {primary}
    </div>
  )
}

export function FlowButton({
  variant,
  onClick,
  disabled,
  children
}: {
  variant: 'primary' | 'secondary'
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      size="lg"
      variant={variant === 'primary' ? 'default' : 'secondary'}
      className="h-12 text-base"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

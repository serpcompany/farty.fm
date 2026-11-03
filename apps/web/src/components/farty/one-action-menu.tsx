'use client'

import { X } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export function OneActionMenu({
  trigger,
  align,
  item,
  onSelect,
  children
}: {
  trigger: ReactElement
  align: 'center' | 'end'
  item: string
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-auto">
        <DropdownMenuItem
          variant="destructive"
          className="min-h-11 px-3 text-base"
          onClick={onSelect}
        >
          <X />
          {item}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'

/** Any URL with no page: Next answers it with status 404 and one `noindex` robots tag. */
export default function NotFound() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>There is no page at this address.</EmptyDescription>
      </EmptyHeader>
      <Link href="/" className={buttonVariants()}>
        Back to Pedos
      </Link>
    </Empty>
  )
}

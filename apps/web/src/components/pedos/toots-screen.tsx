import { ListMusic } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

/** The Toots tab, for now: the iPhone app's `TootsTab` with no Toots yet. #112 brings Toots. */
export function TootsScreen() {
  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-3 text-3xl font-bold tracking-tight">Toots</h1>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListMusic />
          </EmptyMedia>
          <EmptyTitle>Nothing yet</EmptyTitle>
          <EmptyDescription>Make one in Compose.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

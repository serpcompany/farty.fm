import { requestStores } from '@/server/library'
import { reportProfile } from '@/server/profiles'
import { reportRoute } from '@/server/public-route'

export const dynamic = 'force-dynamic'

export const POST = reportRoute<{ handle: string }>((request, { handle }, secret) =>
  reportProfile(requestStores(), request, handle, secret)
)

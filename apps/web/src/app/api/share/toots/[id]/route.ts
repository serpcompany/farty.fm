import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { shareItem, unshareItem } from '@/server/sharing'

type Params = { id: string }

export const PUT = userRoute<Params>((user, request, { id }) =>
  shareItem('toots', requestStores(), user, id, request)
)

export const DELETE = userRoute<Params>((user, request, { id }) =>
  unshareItem('toots', requestStores(), user, id, request)
)

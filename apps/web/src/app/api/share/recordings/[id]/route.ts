import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { shareItem, unshareItem } from '@/server/sharing'

type Params = { id: string }

/** Shares one of the user's Recordings, and answers its link. */
export const PUT = userRoute<Params>((user, request, { id }) =>
  shareItem('recordings', requestStores(), user, id, request)
)

/** Stops sharing it: the link stops working. */
export const DELETE = userRoute<Params>((user, request, { id }) =>
  unshareItem('recordings', requestStores(), user, id, request)
)

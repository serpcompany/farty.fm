import { deleteItem, patchToot, putItem, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { requestPayments } from '@/server/toot-payments'

type Params = { id: string }

export const PUT = userRoute<Params>((user, request, { id }) =>
  putItem('toots', requestStores(), user, id, request, requestPayments(request).kind !== 'free')
)

export const PATCH = userRoute<Params>((user, request, { id }) =>
  patchToot(requestStores(), user, id, request)
)

export const DELETE = userRoute<Params>((user, request, { id }) =>
  deleteItem('toots', requestStores(), user, id, request)
)

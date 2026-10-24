import { deleteItem, patchToot, putItem, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { requestPayments } from '@/server/toot-payments'

type Params = { id: string }

/** Keeps a new Toot and its WAV (multipart `metadata` and `audio`), once it's paid for. */
export const PUT = userRoute<Params>((user, request, { id }) =>
  putItem('toots', requestStores(), user, id, request, requestPayments(request).kind !== 'free')
)

/** Renames a Toot (`{ title }`). */
export const PATCH = userRoute<Params>((user, request, { id }) =>
  patchToot(requestStores(), user, id, request)
)

/** Deletes a Toot and its WAV, leaving a tombstone. */
export const DELETE = userRoute<Params>((user, request, { id }) =>
  deleteItem('toots', requestStores(), user, id, request)
)

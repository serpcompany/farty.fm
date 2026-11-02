import { deleteFavorite, putFavorite, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** `id`: the catalog Song's id. */
type Params = { id: string }

/** Marks a Song a Favorite Song (#313). */
export const PUT = userRoute<Params>((user, request, { id }) =>
  putFavorite(requestStores(), user, id, request)
)

/** Takes a Favorite Song off, leaving a tombstone. */
export const DELETE = userRoute<Params>((user, request, { id }) =>
  deleteFavorite(requestStores(), user, id, request)
)

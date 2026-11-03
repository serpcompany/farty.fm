import { deleteFavorite, putFavorite, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

type Params = { id: string }

export const PUT = userRoute<Params>((user, request, { id }) =>
  putFavorite(requestStores(), user, id, request)
)

export const DELETE = userRoute<Params>((user, request, { id }) =>
  deleteFavorite(requestStores(), user, id, request)
)

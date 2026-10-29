import { deleteItem, patchRecording, putItem, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

type Params = { id: string }

export const PUT = userRoute<Params>((user, request, { id }) =>
  putItem('recordings', requestStores(), user, id, request)
)

export const PATCH = userRoute<Params>((user, request, { id }) =>
  patchRecording(requestStores(), user, id, request)
)

export const DELETE = userRoute<Params>((user, request, { id }) =>
  deleteItem('recordings', requestStores(), user, id, request)
)

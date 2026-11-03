import { getItemAudio, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

export const GET = userRoute<{ id: string }>((user, request, { id }) =>
  getItemAudio('toots', requestStores(), user, id, request)
)

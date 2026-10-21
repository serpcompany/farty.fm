import { getItemAudio, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** A Toot's WAV. */
export const GET = userRoute<{ id: string }>((user, _request, { id }) =>
  getItemAudio('toots', requestStores(), user, id)
)

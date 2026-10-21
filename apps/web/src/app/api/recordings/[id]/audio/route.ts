import { getItemAudio, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** A Recording's WAV. */
export const GET = userRoute<{ id: string }>((user, _request, { id }) =>
  getItemAudio('recordings', requestStores(), user, id)
)

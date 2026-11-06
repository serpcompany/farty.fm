import { downloadToot, requestPayments } from '@/server/full-access'
import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** A saved Toot's own WAV as a file, on an account with Full Access. */
export const GET = userRoute<{ id: string }>((user, request, { id }) =>
  downloadToot(requestStores(), requestPayments(request), user, id, request)
)

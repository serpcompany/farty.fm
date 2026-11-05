import { getFullAccess, requestPayments } from '@/server/full-access'
import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** Whether the account has Full Access: `{ active, limitReached }`. */
export const GET = userRoute((user, request) =>
  getFullAccess(requestStores(), requestPayments(request), user, request)
)

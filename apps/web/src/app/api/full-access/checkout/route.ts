import { requestPayments, startCheckout } from '@/server/full-access'
import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** Where to pay for Full Access (`{ tootId, songId }`): `{ url }`, or `{ active: true }`. */
export const POST = userRoute((user, request) =>
  startCheckout(requestStores(), requestPayments(request), user, request)
)

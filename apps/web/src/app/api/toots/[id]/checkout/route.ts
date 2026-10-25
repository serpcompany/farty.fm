import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { requestPayments, startCheckout } from '@/server/toot-payments'

type Params = { id: string }

/** Where to pay to save the Toot (`{ songId }`): `{ url }`, or `{ paid: true }`. */
export const POST = userRoute<Params>((user, request, { id }) =>
  startCheckout(requestStores(), requestPayments(request), user, id, request)
)

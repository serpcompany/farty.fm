import { payDevCheckout, requestPayments } from '@/server/full-access'
import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** The dev checkout's Pay (`/dev/checkout/`), on a local run only. */
export const POST = userRoute((user, request) =>
  payDevCheckout(requestStores(), requestPayments(request), user, request)
)

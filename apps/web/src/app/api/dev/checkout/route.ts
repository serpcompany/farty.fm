import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { payDevCheckout, requestPayments } from '@/server/toot-payments'

export const POST = userRoute((user, request) =>
  payDevCheckout(requestStores(), requestPayments(request), user, request)
)

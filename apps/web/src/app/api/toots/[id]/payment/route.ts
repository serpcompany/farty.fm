import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { getTootPayment, requestPayments } from '@/server/toot-payments'

type Params = { id: string }

/** Whether the Toot is paid for: `{ paid }`. */
export const GET = userRoute<Params>((user, request, { id }) =>
  getTootPayment(requestStores(), requestPayments(request), user, id, request)
)

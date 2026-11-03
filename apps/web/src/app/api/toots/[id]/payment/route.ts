import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { getTootPayment, requestPayments } from '@/server/toot-payments'

type Params = { id: string }

export const GET = userRoute<Params>((user, request, { id }) =>
  getTootPayment(requestStores(), requestPayments(request), user, id, request)
)

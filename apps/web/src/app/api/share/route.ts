import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { listShares } from '@/server/sharing'

export const GET = userRoute((user, request) => listShares(requestStores().db, user, request))

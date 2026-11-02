import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { listShares } from '@/server/sharing'

/** The user's Handle and shared items, each with its link. */
export const GET = userRoute((user, request) => listShares(requestStores().db, user, request))

import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { getHandle, putHandle } from '@/server/sharing'

export const GET = userRoute((user, request) => getHandle(requestStores().db, user, request))

export const PUT = userRoute((user, request) => putHandle(requestStores().db, user, request))

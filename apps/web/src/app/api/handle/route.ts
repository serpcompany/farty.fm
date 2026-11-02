import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'
import { getHandle, putHandle } from '@/server/sharing'

/** The user's Handle, or one to suggest; with `?check=`, whether that Handle can be used. */
export const GET = userRoute((user, request) => getHandle(requestStores().db, user, request))

/** Gives the user their Handle (`{ handle }`), the first time they share. */
export const PUT = userRoute((user, request) => putHandle(requestStores().db, user, request))

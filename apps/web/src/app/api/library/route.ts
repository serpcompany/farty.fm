import { getLibrary, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** The signed-in user's Recordings and Toots changed since `?since=`, and those deleted. */
export const GET = userRoute((user, request) => getLibrary(requestStores(), user, request))

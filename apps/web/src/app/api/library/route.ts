import { getLibrary, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

export const GET = userRoute((user, request) => getLibrary(requestStores(), user, request))

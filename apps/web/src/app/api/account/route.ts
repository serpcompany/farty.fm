import { deleteAccount, patchAccount, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

export const PATCH = userRoute((user, request) => patchAccount(requestStores(), user, request))

export const DELETE = userRoute((user, request) => deleteAccount(requestStores(), user, request))

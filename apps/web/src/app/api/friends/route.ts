import { authSecret } from '@/server/auth'
import { listFriends, sendFriendRequest } from '@/server/friends'
import { apiError } from '@/server/http'
import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

export const GET = userRoute(user => listFriends(requestStores().db, user))

export const POST = userRoute((user, request) => {
  const secret = authSecret()
  return secret
    ? sendFriendRequest(requestStores().db, user, request, secret)
    : Promise.resolve(apiError(503, 'unavailable'))
})

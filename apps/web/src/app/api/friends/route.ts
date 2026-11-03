import { authSecret } from '@/server/auth'
import { listFriends, sendFriendRequest } from '@/server/friends'
import { requestStores } from '@/server/library'
import { apiError, userRoute } from '@/server/require-user'

/** The user's Handle, who asked them, their friends and whom they asked, by Handle. */
export const GET = userRoute(user => listFriends(requestStores().db, user))

/** Asks the user with `{ handle }` to be friends, or accepts them if they asked first. */
export const POST = userRoute((user, request) => {
  // A sender's limit is keyed by an HMAC under sign-in's secret: none here, no requests.
  const secret = authSecret()
  return secret
    ? sendFriendRequest(requestStores().db, user, request, secret)
    : Promise.resolve(apiError(503, 'unavailable'))
})

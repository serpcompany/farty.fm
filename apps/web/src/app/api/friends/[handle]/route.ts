import { actOnFriend, friendStatus } from '@/server/friends'
import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

type Params = { handle: string }

export const GET = userRoute<Params>((user, _request, { handle }) =>
  friendStatus(requestStores().db, user, handle)
)

export const POST = userRoute<Params>((user, request, { handle }) =>
  actOnFriend(requestStores().db, user, handle, request)
)

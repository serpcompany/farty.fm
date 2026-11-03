import { actOnFriend, friendStatus } from '@/server/friends'
import { requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

type Params = { handle: string }

/** How the user stands with the user at `handle`: none, requested, asked, friends, or own. */
export const GET = userRoute<Params>((user, _request, { handle }) =>
  friendStatus(requestStores().db, user, handle)
)

/** `{ action }` between the user and them: accept, decline, cancel or remove. */
export const POST = userRoute<Params>((user, request, { handle }) =>
  actOnFriend(requestStores().db, user, handle, request)
)

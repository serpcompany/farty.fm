import { deleteAccount, patchAccount, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** Turns Farty news by email (`{ marketingEmail }`) or Show where I farted (`{ showFartPlaces }`) on or off. */
export const PATCH = userRoute((user, request) => patchAccount(requestStores(), user, request))

/** Deletes the account: every WAV, then the user with their sessions, Recordings and Toots. */
export const DELETE = userRoute((user, request) => deleteAccount(requestStores(), user, request))

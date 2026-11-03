import { deleteFartChoices, putFartChoices, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

/** `id`: the catalog Song's id. */
type Params = { id: string }

/** Keeps a Song's Fart Choices (#360). */
export const PUT = userRoute<Params>((user, request, { id }) =>
  putFartChoices(requestStores(), user, id, request)
)

/** Makes the Song automatic again, leaving a tombstone. */
export const DELETE = userRoute<Params>((user, request, { id }) =>
  deleteFartChoices(requestStores(), user, id, request)
)

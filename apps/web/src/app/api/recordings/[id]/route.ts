import { deleteItem, patchRecording, putItem, requestStores } from '@/server/library'
import { userRoute } from '@/server/require-user'

type Params = { id: string }

/** Keeps a new Recording and its WAV (multipart `metadata` and `audio`). */
export const PUT = userRoute<Params>((user, request, { id }) =>
  putItem('recordings', requestStores(), user, id, request)
)

/** Changes a Recording's note, Trim or name, or takes any of them off (`{ placedPitch, trim, name }`). */
export const PATCH = userRoute<Params>((user, request, { id }) =>
  patchRecording(requestStores(), user, id, request)
)

/** Deletes a Recording and its WAV, leaving a tombstone. */
export const DELETE = userRoute<Params>((user, request, { id }) =>
  deleteItem('recordings', requestStores(), user, id, request)
)

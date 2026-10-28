import { z } from 'zod'

export type MailboxStore = Pick<KVNamespace, 'get' | 'put' | 'list'>

export type CapturedEmail = {
  id: string
  from: string
  to: string
  subject: string
  text: string
  html: string
  capturedAt: string
}

const PREFIX = 'mail:'
const KEEP_SECONDS = 7 * 24 * 60 * 60
const LIST_LIMIT = 50
const LAST_INSTANT = 9_999_999_999_999

const CAPTURED = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  capturedAt: z.string()
})

export async function captureEmail(
  store: MailboxStore,
  email: { from: EmailAddress; to: string; subject: string; text: string; html: string },
  now: Date
): Promise<void> {
  const id = crypto.randomUUID()
  const order = String(LAST_INSTANT - now.getTime()).padStart(13, '0')
  const captured: CapturedEmail = {
    ...email,
    id,
    from: `${email.from.name} <${email.from.email}>`,
    capturedAt: now.toISOString()
  }
  await store.put(`${PREFIX}${order}:${id}`, JSON.stringify(captured), {
    expirationTtl: KEEP_SECONDS
  })
}

export async function listCapturedEmails(store: MailboxStore): Promise<CapturedEmail[]> {
  const { keys } = await store.list({ prefix: PREFIX, limit: LIST_LIMIT })
  const values = await Promise.all(keys.map(({ name }) => store.get(name)))
  return values.flatMap(value => {
    const parsed = CAPTURED.safeParse(parseJson(value))
    return parsed.success ? [parsed.data] : []
  })
}

function parseJson(value: string | null): unknown {
  try {
    return JSON.parse(value ?? 'null')
  } catch {
    return null
  }
}

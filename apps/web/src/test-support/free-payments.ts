import type * as TootPayments from '@/server/toot-payments'

export async function freeTootPayments(
  importOriginal: <T>() => Promise<T>
): Promise<typeof TootPayments> {
  return {
    ...(await importOriginal<typeof TootPayments>()),
    requestPayments: () => ({ kind: 'free' })
  }
}

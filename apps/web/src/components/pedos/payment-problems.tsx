import Link from 'next/link'

/** What Save and Download say when paying for Full Access couldn't start (ADR 0022). */
export const PAYMENT_PROBLEMS = {
  unavailable: "Payments aren't available right now.",
  charged: (
    <>
      You were charged, but Full Access didn't start.{' '}
      <Link href="/support/" className="underline">
        Contact support
      </Link>{' '}
      for a refund.
    </>
  ),
  tooMany: "You've started a lot of payments. Try again later.",
  failed: "Couldn't start the payment."
}

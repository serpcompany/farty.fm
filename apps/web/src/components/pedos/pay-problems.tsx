import Link from 'next/link'

/** What Farty says when Pay couldn't start, at Save and at an offer. */
export const PAY_PROBLEMS = {
  unavailable: "Payments aren't available right now.",
  limitReached: "You've kept as many Toots as an account can. Delete one to save this one.",
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

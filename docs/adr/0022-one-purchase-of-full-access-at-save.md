# One purchase of Full Access at Save

The owner decided on 2026-11-06 (#406) to replace 99¢ per Toot (ADR 0010) with one payment of $4.99 per account. A 99¢ payment loses about a third to Stripe's fees, and asking again for each Toot puts a payment in front of the thing people want to do most. This changes ADR 0010's "One payment, one Toot", ADR 0013's rule 4, and how ADR 0017 keeps a Sound Pad take across Checkout. It doesn't change that making and hearing a Toot is free, or that there are no ads (ADR 0008).

$4.99 is a starting price from what comparable apps charge, not a tested one. #409 tests it against $9.99 once there's the traffic. Without that traffic, the owner moves to $6.99 as a judgement call.

## What it means

- **Full Access is one purchase per account.** It's $4.99, once, through hosted Stripe Checkout in `payment` mode. Every Save on that account then just saves, Song or Sound Pad, in any browser, up to the 300 Toots an account can keep (`MAX_SAVED_TOOTS`), which the offer says.
- **Save asks when it matters.** Recording, hearing Songs, a free account with its Handle, the public page, friends and Recording links stay free. An account still comes first: a guest's Save opens the account step, then the offer.
- **The offer is a sheet at Save.** It says the price, what it covers and the money back. Save no longer shows a price on its button, since most Saves on a paying account have none to show.
- **Past buyers have it.** Any paid, unrefunded `toot_payments` row gives Full Access, so a person who paid 99¢ once never pays again. Their row stays as it is.
- **Sessions already open are honored.** A 99¢ Checkout Session open when this ships can still be paid. The webhook marks its `toot_payments` row paid, which then gives Full Access.
- **The money back lasts 14 days.** Someone asks Support from their account's email, and it's refunded by hand in Stripe's Dashboard, found by that email, which Checkout is given rather than asking for it. `MONEY_BACK_DAYS` in `apps/web/src/lib/pricing.ts` is what the app says; nothing enforces it.
- **A full refund ends Full Access.** Stripe's `charge.refunded` event, whose charge says `refunded: true`, marks the row refunded. A partial refund changes nothing. Saved Toots stay, and Save offers Full Access again. If the event isn't turned on, everything else still works and a refunded account keeps Full Access until it is.
- **The server decides.** `PUT /api/toots/{id}/` answers 402 `payment_required` for a new Toot on an account without Full Access. It no longer asks about that one Toot. A deleted Toot still can't be saved again while its tombstone lasts (410 `deleted`), and Checkout refuses it the same way, so nobody pays for a Save that would be refused.
- **The owner hears about each sale (#422).** The first time a purchase is recorded as paid, Production emails the owner the product, the price and the payment's Stripe Dashboard link, and nothing about the buyer. Staging sends none, a send that fails is logged and not tried again, and it never holds up the payment. A purchase after a refund is another sale.

The price is `FULL_ACCESS_PRICE` in `apps/web/src/lib/pricing.ts`, the one place it is set.

## The name

"Full Access", since "Unlocked Song" is taken: it means a Song whose Pitch Coverage is complete, and buying this doesn't unlock any Song. Fart Choices and Pitch Coverage work as before.

## How a Toot gets back from Checkout

Checkout still goes back to the Toot whose Save asked for it, with its id, and saves it. Stripe fixes a session's return address when it's made, so an open session for the same Toot is reused, and one for another Toot is ended first (`/expire`) so that one payment is ever open. Taps and tabs one after another can't pay twice. If ending it fails because it was just paid, the next tap finds that.

The Sound Pad keeps a take across Checkout as before (ADR 0017). On its next open, a take that started a Checkout and never got back is made again and saved if the account has Full Access by then, newest first and one per open. A kept take that couldn't be made again costs nothing now, as the purchase isn't tied to it, so the Pad says to record it again instead of reporting a refund, and the `pad-paid-take-lost` report is gone.

## The fee

At Stripe's standard US card rate of 2.9% + 30¢, $4.99 pays about 44¢ and nets about $4.55, against 66¢ net of 99¢. A person needs to save seven Toots at 99¢ for Farty to net the same.

## Options considered

| Option | Why not, or why |
| --- | --- |
| **$4.99 once at Save (chosen)** | One decision for the user, at the moment they want to keep something they've already heard, with fees that stop eating the price. |
| 99¢ per Toot (ADR 0010) | Stripe takes a third, and it asks again every time. |
| A subscription | Nothing here costs more each month, so it would be hard to explain, and a fart app's use doesn't last long enough to renew. |
| A paywall before an account, or at the 3rd or 4th Recording | It stops people before they've heard their own farts play a Song, which is the hook. Accounts, Handles and public pages stay free because they bring people in. |
| Paying before making an account | A payment needs an account to belong to, and a free account first keeps sign-up from depending on Stripe. |

## Consequences

- Before Production, the owner adds `charge.refunded` to both Stripe webhook endpoints and takes a lawyer's view of the refund wording and tax.
- `toot_payments.saved_at` is no longer written or read. It stays, since dropping it during a deploy would break the Worker it replaces, and goes in a later migration.
- A late, replayed paid event for an old refunded session can give Full Access back once a new purchase has started. It needs a refund and a new Checkout inside Stripe's retry window, and the person has paid at least once, so it's left.
- A 99¢ session still open relies on the webhook alone: the Save that follows reads the row, and doesn't ask Stripe about old sessions.
- A Sound Pad take that started a Checkout and was then cancelled is saved by itself on a later open once the account has Full Access. The person tapped Save and Pay on it, so it's kept rather than lost.
- A tab open across the deploy calls routes that are gone (`/api/toots/{id}/checkout/`, `/payment/`). It says it couldn't start the payment until the person leaves the screen or reloads, since a 404 from an API doesn't start the stale-build reload (#222), and charges nothing.
- Two requests for different Toots that cross in the same instant can each make a session. Paying both is two deliberate payments: the second changes nothing, and it's for Support to refund.
- A refund made before D1 records the payment finds no row, since the row has no payment id yet, and the next check then marks it paid from Stripe's session. It needs the webhook to have failed and the buyer not to have come back, so it's left.
- A 99¢ payment refunded by hand before this ships still counts as a past buyer, since no refund was recorded then. It's left.
- A chargeback doesn't end Full Access: no dispute event is handled, and a lost dispute doesn't say `refunded: true`.
- Save asks the server, so an account with Full Access can't save offline. It says to try again, and nothing is lost.
- A Toot's delete lasts as its tombstone does. With `saved_at` no longer blocking a save, once a tombstone is purged (30 days), a stale browser's outbox can bring a deleted Toot back on an account with Full Access, as it can a Recording. It's accepted.
- Deleting an account deletes its `full_access` row. Stripe keeps its own record.
- ADR 0010's table of where saving is paid, and its Stripe keys, still hold.

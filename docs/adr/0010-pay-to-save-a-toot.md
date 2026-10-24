# Pay $0.99 to save a Toot

Farty's first paywall (#204). The owner decided it on 2026-10-25: anyone can make and hear a Toot for free, and keeping one costs $0.99. There are still no ads (ADR 0008).

## What Save means

- **Preview is free.** Anyone, guest or signed in, can open an Unlocked Song in Song Creator, have the Toot made and play it, its notes and its Recordings, as often as they like.
- **Saving costs $0.99 per Toot.** Save to Toots is what keeps a Toot: it goes into Toots, lasts past the visit and syncs to the account's other browsers. It needs an account, because a guest's Toots don't outlast the visit (#150), and a paid Toot must live somewhere. A guest's tap on Save opens the account step first.
- **One payment, one Toot.** The payment is for one Toot id. Renaming it is free; deleting it doesn't refund it, and a deleted Toot can't be saved again under the same id. Making the same Song again makes a new Toot, which is paid for again.
- **The server decides.** A Stripe webhook marks the Toot paid in D1 (`toot_payments`), and `PUT /api/toots/{id}/` refuses a Toot that isn't paid (402 `payment_required`). The return from Checkout also asks Stripe, so a late webhook doesn't hold the save up. A browser can still keep audio it played, as any web page can; what it can't do without paying is put the Toot in the account.
- **Download and share** aren't in the web app yet. When they come, they're for saved Toots only.

The price is `TOOT_PRICE` in `apps/web/src/lib/pricing.ts`, the one place it is set. A pack or another price later changes that file and the checkout, not this decision.

## How people pay

Stripe Checkout, hosted by Stripe: the server starts a Checkout Session for one Toot and the browser goes to Stripe's page, which offers card, Apple Pay and Google Pay without any setup on farty.fm. No card data reaches Farty. The Worker calls Stripe's API with `fetch` and checks the webhook's signature with Web Crypto, so there's no Stripe SDK in the bundle.

## The fee

Stripe's standard US card rate is 2.9% + 30¢, so a $0.99 payment pays about 33¢ in fees and nets about 66¢: Stripe takes a third. International cards and currency conversion take more. That's the cost of a price this small. Packs (for example 5 Toots for $3.99) or Stripe's micropayment pricing would keep more of each dollar, and the owner may switch later.

## Where it's on

| Environment | Saving | Stripe |
| --- | --- | --- |
| Local run | Paid | A stand-in for Checkout at `/dev/checkout/` when there's no Stripe key, for the e2e journeys and tap-throughs. It answers 404 anywhere else. |
| Staging | Paid | Test mode. Until its keys are set, Save says payments aren't available. |
| Production | Free, as before | None yet. It turns on once the owner has Stripe's live keys and they are set on Production's Worker; then `savingIsPaid` in `pricing.ts` changes, in its own PR. |

The server accepts only test-mode keys (`sk_test_`, `rk_test_`) for now, so a live key can't be used by mistake before Production is ready.

## Options considered

| Option | Why not, or why |
| --- | --- |
| **$0.99 per saved Toot, Stripe Checkout (chosen)** | The owner's price. Hosted Checkout gives Apple Pay with no card form to build or secure. |
| Pay to make or to hear a Toot | Hearing your own farts play a Song is the hook; a paywall before it would stop people before they know what they're paying for. |
| Packs or a subscription | Better margins, but more to explain and build. Left for later; the price is one constant. |
| Apple's or Google's in-app purchase | Apple's isn't available: Farty isn't in the App Store (ADR 0007). Google Play's billing policy asks apps from Play, Trusted Web Activities like #114 included, to sell digital goods through Play Billing, so before the Play app charges, it needs Play Billing (the Digital Goods API) or no sale inside it. That's #114's to settle. |
| Stripe Payment Element on farty.fm | Card fields in the app mean more code, more to secure and Apple Pay domain setup, for the same payment. |

## Consequences

- Saving needs an account and Stripe. On Staging, Save fails until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set on its Worker. The steps are in `docs/agents/web.md`.
- Deleting an account deletes its payment rows with it. Stripe keeps its own record of every payment.
- Refunds are made in Stripe's dashboard, by hand. A refund doesn't remove the Toot.

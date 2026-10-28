# Payments

Paying to save a Toot (ADR 0010): how it works, and the owner's Stripe setup.

- **Payments (#204, ADR 0010).** Saving a Toot costs `TOOT_PRICE` (`src/lib/pricing.ts`), paid through Stripe Checkout, which Stripe hosts. `POST /api/toots/{id}/checkout/` starts a Checkout Session for one Toot (or reuses the open one) and records it in `toot_payments`; `POST /api/stripe/webhook/` checks `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET` and marks the Toot paid on `checkout.session.completed` or `checkout.session.async_payment_succeeded`; `GET /api/toots/{id}/payment/` asks Stripe too, so the return from Checkout doesn't wait on the webhook. `PUT /api/toots/{id}/` answers 402 `payment_required` for a new Toot that isn't paid. The Worker calls Stripe with `fetch` (`src/server/stripe.ts`), with no SDK. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are Worker secrets the owner sets from their own terminal (below), never in `wrangler.jsonc`; only test-mode keys (`sk_test_`, `rk_test_`) are taken. Staging without them answers 503 `payments_unavailable`, which Save shows. A local run on a local host with no key uses the dev checkout (`/dev/checkout/`, and `POST /api/dev/checkout/`, which marks a started checkout paid), for the journeys and tap-throughs; both answer 404 anywhere else. Production saves free until `savingIsPaid` changes. The owner's Stripe steps are below.

## Stripe

Saving a Toot is paid on Staging in Stripe's test mode (ADR 0010). The code is done; the account and its keys are the owner's.

**The owner, once, for Staging (test mode):**

1. In the Stripe Dashboard, with **Test mode** on, open **Developers → API keys** and create a restricted key with **Write** on **Checkout Sessions** (everything else None), or use the test secret key.
2. Open **Developers → Webhooks → Add endpoint**: URL `https://staging.farty.fm/api/stripe/webhook/`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Keep the trailing slash: the Staging gate lets only that exact path through. Keep the endpoint's signing secret for the next step.
3. Set both on the Staging Worker (`pedos-web-staging`) from your own terminal in `apps/web/`. Each command asks for its value:
   - `pnpm exec wrangler secret put STRIPE_SECRET_KEY --env staging`, with the key from step 1;
   - the same with `STRIPE_WEBHOOK_SECRET`, with the signing secret from step 2.

   An agent then checks both by name with `wrangler secret list --env staging`. Never paste either value into chat.
4. In **Settings → Payments → Payment methods**, leave Cards, Apple Pay and Google Pay on. Hosted Checkout needs no Apple Pay domain setup. Checkout asks for cards only (Apple Pay and Google Pay are cards), since a slower method would leave the Toot unsaved after the return.
5. Pay once on https://staging.farty.fm with Stripe's test card `4242 4242 4242 4242`, and check that the Toot shows as saved and the payment shows in the Dashboard.

**Later, for Production:** live keys and a live webhook endpoint on `https://farty.fm/api/stripe/webhook/`, set on `pedos-web-production` the same way; then a PR that lets `paymentsConfig` take live keys there, lets the webhook take live events (`receiveStripeEvent` in `toot-payments.ts` takes only `livemode: false`), and changes `savingIsPaid`. Settle Google Play's billing policy for the Play app (#114) first.

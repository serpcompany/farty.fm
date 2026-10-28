# Paying to save a Toot

Making and playing a Toot is free. Saving one to Toots needs a free account and costs $0.99,
through Stripe Checkout, on Production as on Staging and a local run
([ADR 0010](../../../../docs/adr/0010-pay-to-save-a-toot.md),
[ADR 0013](../../../../docs/adr/0013-keeping-recordings-needs-a-free-account.md)). The routes, the
webhook and the owner's Stripe setup are in [Payments](../../../../docs/agents/payments.md). The
rest of [Song Creator](song-creator.md) is the same everywhere.

## Where saving is paid

- Production takes payment through Stripe Checkout in live mode, with a live key only. With a test
  key or none, payments are off there, and nothing stands in for Checkout
  (`src/server/stripe.test.ts`, "takes only a live key, in live mode"; "turns payments off with a
  test key or none, and never stands in for Checkout";
  `src/app/api/payments-environments.workers.test.ts`, "pays through Stripe in live mode, with no
  dev checkout, and saves once paid"; "marks a Toot paid from a signed live event, never from a test
  one"; "takes no payment without a live key, and never stands in for Checkout").
- A Production build run locally pays too, through the dev checkout, and never with a live key
  (`src/server/stripe.test.ts`, "pays on a local run of a Production build, as its Save does, never
  with a live key"; `e2e/production-save.spec.ts`, "a signed-in save pays $0.99 first, and two taps
  pay for and save one Toot"). That journey runs only on a Production build (`pnpm
  build:production`, then `E2E_SERVER=preview E2E_SITE_ENV=production`); CI's journeys build
  Staging, where it skips.
- Staging takes payment through Stripe Checkout in test mode, once the owner has set its keys
  (`src/server/stripe.test.ts`, "uses Stripe in test mode on Staging, with the webhook secret once
  it is set"; "takes a restricted test key too"; `src/app/api/payments-environments.workers.test.ts`,
  "pays through Stripe in test mode, with no dev checkout").
- A local run on a local host with no Stripe key uses the dev checkout, `/dev/checkout/`: "Dev
  checkout", the Song, Pay $0.99 and Cancel, and nothing is charged (`src/server/stripe.test.ts`,
  "stands in for Checkout on a local run on a local host with no key"; `e2e/account-pay.spec.ts`, "a
  guest who signs in at Save pays $0.99, and the Toot is saved to the account").
- With no key, a live key or a misconfigured environment, payments are off, and Save says "Payments
  aren't available right now." (`src/server/stripe.test.ts`, "turns payments off with no key, a live
  key or a misconfigured environment"; `src/lib/toot-payment.test.ts`, "says why it failed";
  `src/components/farty/song-creator.interaction.test.tsx`, "says payments aren’t available when the
  server has none (payments_unavailable)").
- Save says "Save to Toots · $0.99" (`e2e/account-pay.spec.ts`, "a guest's Toot plays free, and
  Save asks for an account first"; `e2e/production-save.spec.ts`, "a signed-in save pays $0.99
  first, and two taps pay for and save one Toot").

## Where saving is made free again

`FREE_SAVING` in `src/lib/pricing.ts` lists the environments where saving is free. It's empty, and
adding one makes saving free there, on the browser's side and the server's.

- Save says "Save to Toots" and saves at once, with no checkout
  (`src/components/farty/song-creator.interaction.test.tsx`, "saves at once where saving is free,
  with no checkout"; `src/app/api/payments-environments.workers.test.ts`, "answers paid to checkout
  and payment, with no checkout and no Stripe").
- While the account can't be read, offline for one, Save saves in a browser whose library is an
  account's, and the Toot uploads later. In a guest's browser it reads the account again, says
  "Couldn't reach your account. Tap Save to try again." and saves nothing
  (`src/components/farty/song-creator.interaction.test.tsx`, "saves in a browser whose library is an
  account’s, as offline before #237"; "reads the account again in a guest’s browser, and saves
  nothing").

## A guest

- A guest's Toot plays free. Save opens the account step, "Keep your farts", paid or free, and
  neither pays nor saves. Not now leaves the Toot unsaved and Save ready to tap again; nothing is
  kept on Toots (`e2e/account-pay.spec.ts`, "a guest's Toot plays free, and Save asks for an account
  first"; `src/components/farty/song-creator.interaction.test.tsx`, "asks for an account before
  saving or paying, where saving is %s"; "saves nothing when the step closes with Not now").
- Signing in from that step goes straight on to the checkout, or to saving where saving is free.
  Paid, the Toot is saved here and on the account (`e2e/account-pay.spec.ts`, "a guest who signs in
  at Save pays $0.99, and the Toot is saved to the account";
  `src/components/farty/song-creator.interaction.test.tsx`, "asks for an account before saving or
  paying, where saving is %s").

## Signed in

- Save waits, disabled, until Farty knows whether the person is signed in
  (`src/components/farty/song-creator.interaction.test.tsx`, "keeps Save disabled while the account
  is still read, then lets it be tapped, where saving is %s").
- Save goes to the checkout for that one Toot. Paid, the person comes back to Song Creator with the
  same Toot, which saves, and Save turns into "Saved to Toots" (`e2e/song-creator.spec.ts`, "plays
  each Song with your farts, plays a tapped note, and saves it as a Toot";
  `src/app/api/payments-stripe.workers.test.ts`, "starts a Checkout Session for the Toot, back to its
  Song Creator").
- Cancel at the checkout comes back to Song Creator with the same Toot, still unsaved, and Save pays
  for that same Toot (`e2e/account-pay.spec.ts`, "cancelled at the checkout, the Toot is still
  unsaved, and Save pays for that same Toot").
- Back from the checkout, paid or not, Song Creator waits for a tap instead of playing the Toot
  (`src/components/farty/song-creator.interaction.test.tsx`, "plays the Toot once made, but waits
  for a tap on the return from the checkout").
- Coming back paid, Song Creator saves once the server says the Toot is paid, which it asks Stripe
  itself rather than wait for the webhook. Save says "Confirming payment…" meanwhile. It asks again
  every 2 seconds, 15 times, before saying "Your payment hasn't come through yet. Tap Save to check
  again.", and Save then asks once more (`src/lib/toot-payment.test.ts`, "asks again until the
  payment comes through"; "gives up after its tries"; `src/app/api/payments-stripe.workers.test.ts`,
  "saves once Stripe says it’s paid, on the return, before the webhook";
  `src/components/farty/song-creator.interaction.test.tsx`, "says Confirming payment… while the
  return is checked, then that the payment hasn’t come through"; "says the payment hasn’t come
  through yet, back from Checkout, and checks again on Save").
- While the account is still being read on the return, Save waits, disabled, and then confirms the
  payment (`src/components/farty/song-creator.interaction.test.tsx`, "keeps Save waiting, disabled,
  while the account is still read on the return").
- When the account can't be read, Save says "Couldn't reach your account. Tap Save to try again."
  A tap reads it again, and once it reads, a paid return confirms by itself
  (`src/components/farty/song-creator.interaction.test.tsx`, "offers a retry when the account can’t
  be read after a paid return"; "reads the account again when Save is tapped while it can’t be
  read").
- Coming back with the browser's Back from the checkout page, restored as it was left, makes Save
  tappable again (`src/components/farty/song-creator.interaction.test.tsx`, "makes Save tappable
  again when the browser comes back from the checkout page").
- A Toot already paid for saves with no second checkout, and two taps never pay twice
  (`src/lib/toot-payment.test.ts`, "has nothing to pay for a paid Toot";
  `src/app/api/payments-stripe.workers.test.ts`, "reuses an open session, so two taps can’t pay
  twice"; `src/app/api/payments.workers.test.ts`, "pays for one Toot at a time";
  `e2e/production-save.spec.ts`, "a signed-in save pays $0.99 first, and two taps pay for and save
  one Toot").
- A paid Toot saves once: deleted, it can't be saved again
  (`src/app/api/payments.workers.test.ts`, "saves a paid Toot once: deleted, it can’t be saved
  again, even once its tombstone is purged"; "saves a paid Toot once when two saves cross").
- A Toot of the same Song paid for and never saved is saved in place of a second payment: Save
  opens that Toot's return from the checkout, which saves it, and this one stays unpaid
  (`src/lib/toot-payment.test.ts`, "names another Toot of the Song that is paid for and was never
  saved"; `src/app/api/payments.workers.test.ts`, "offers a paid Toot of the Song that was never
  saved, rather than a second payment"; "never offers another user’s paid Toot, or one saved and
  deleted"; `src/app/api/payments-stripe.workers.test.ts`, "offers a paid Toot of the Song never
  saved, without asking Stripe again"; `src/components/farty/song-creator.interaction.test.tsx`,
  "saves a paid Toot of the Song never saved, instead of paying again").
- Save goes nowhere but Stripe's page or this site's dev checkout (`src/lib/toot-payment.test.ts`,
  "goes nowhere but Stripe’s page or this site’s dev checkout").

## When it can't

- A checkout that can't start says why under Save: "Payments aren't available right now.", "You've
  kept as many Toots as an account can. Delete one to save this one." (300), or "Couldn't start the
  payment." (`src/lib/toot-payment.test.ts`, "says why it failed";
  `src/app/api/payments.workers.test.ts`, "refuses a deleted Toot, and one past the Toot limit,
  before anything is paid"; `src/components/farty/song-creator.interaction.test.tsx`, "says why a
  checkout couldn't start (%s)").
- Past the checkouts one user may start, Save says "You've started a lot of payments. Try again
  later." (`src/app/api/payments.workers.test.ts`, "limits how many checkouts one user starts";
  `src/components/farty/song-creator.interaction.test.tsx`, "says to try later past the checkout
  limit").
- A Checkout that charged anything but the Toot's price never counts as paid, and Save says "You
  were charged, but this Toot couldn't be saved. Contact support for a refund.", linking Support
  (`src/server/stripe.test.ts`, "is false for a session that charged anything but the Toot’s
  price"; `src/app/api/payments-stripe.workers.test.ts`, "never takes a session that charged
  anything but the Toot’s price as paid"; "never starts a second payment for a Toot whose last
  session is paid at another price"; `src/components/farty/song-creator.interaction.test.tsx`,
  "says the user was charged and links Support when the paid session doesn’t match
  (payment_mismatch)").
- A Checkout paid in the buyer's own currency, or at the price it started at before the price
  changed, counts as paid (`src/app/api/payments-stripe.workers.test.ts`, "takes a payment in the
  buyer’s own currency (Adaptive Pricing): the session keeps 99 usd"; "takes a session paid at the
  price its checkout started at, after the price changed"; `src/server/stripe.test.ts`, "judges by
  the price the Toot’s checkout started at, not today’s").
- The account won't keep a new Toot that isn't paid for, and one user can't pay for or save
  another's (`src/app/api/payments.workers.test.ts`, "saves a Toot once it is paid for, and not
  before"; "never lets one user pay for, or save, another’s Toot").

## Not checked

- That a real browser restores Song Creator from its back/forward cache on Back from the checkout
  page: only a real browser has that cache. The interaction test above sends the `pageshow` event
  such a restore fires.

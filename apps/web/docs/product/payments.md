# Paying to save a Toot

Making and playing a Toot is free. Saving one to Toots costs $0.99 where saving is paid, through
Stripe Checkout, and is free on Production until that changes
([ADR 0010](../../../../docs/adr/0010-pay-to-save-a-toot.md)). The routes, the webhook and the owner's
Stripe setup are in [Payments](../../../../docs/agents/payments.md). The rest of
[Song Creator](song-creator.md) is the same everywhere.

## Where saving is paid

- Production saves a Toot free, with no checkout (`src/server/stripe.test.ts`, "leaves saving free
  on Production"; `src/app/api/payments.workers.test.ts`, "saves a Toot free, with no checkout").
- Staging takes payment through Stripe Checkout in test mode, once the owner has set its keys
  (`src/server/stripe.test.ts`, "uses Stripe in test mode on Staging, with the webhook secret once
  it is set"; "takes a restricted test key too").
- A local run on a local host with no Stripe key uses the dev checkout, `/dev/checkout/`: "Dev
  checkout", the Song, Pay $0.99 and Cancel, and nothing is charged (`src/server/stripe.test.ts`,
  "stands in for Checkout on a local run on a local host with no key"; `e2e/account-pay.spec.ts`, "a
  guest who signs in at Save pays $0.99, and the Toot is saved to the account").
- With no key, a live key or a misconfigured environment, payments are off, and Save says "Payments
  aren't available right now." (`src/server/stripe.test.ts`, "turns payments off with no key, a live
  key or a misconfigured environment"; `src/lib/toot-payment.test.ts`, "says why it failed").
- Where saving is paid, Save says "Save to Toots · $0.99" (`e2e/account-pay.spec.ts`, "a guest's
  Toot plays free, and Save asks for an account first").

## A guest

- A guest's Toot plays free. Save opens the account step, "Keep your farts". Not now leaves the Toot
  unsaved and Save ready to tap again; nothing is kept on Toots (`e2e/account-pay.spec.ts`, "a
  guest's Toot plays free, and Save asks for an account first").
- Signing in from that step goes straight on to the checkout. Paid, the Toot is saved here and on
  the account (`e2e/account-pay.spec.ts`, "a guest who signs in at Save pays $0.99, and the Toot is
  saved to the account").

## Signed in

- Save goes to the checkout for that one Toot. Paid, the person comes back to Song Creator with the
  same Toot, which saves, and Save turns into "Saved to Toots" (`e2e/song-creator.spec.ts`, "plays
  each Song with your farts, plays a tapped note, and saves it as a Toot"; `src/app/api/payments.workers.test.ts`,
  "starts a Checkout Session for the Toot, back to its Song Creator").
- Cancel at the checkout comes back to Song Creator with the same Toot, still unsaved, and Save pays
  for that same Toot (`e2e/account-pay.spec.ts`, "cancelled at the checkout, the Toot is still
  unsaved, and Save pays for that same Toot").
- Coming back paid, Song Creator saves once the server says the Toot is paid, which it asks Stripe
  itself rather than wait for the webhook. It asks again every 2 seconds, 15 times, before saying
  "Your payment hasn't come through yet. Tap Save to check again." (`src/lib/toot-payment.test.ts`,
  "asks again until the payment comes through"; "gives up after its tries";
  `src/app/api/payments.workers.test.ts`, "saves once Stripe says it’s paid, on the return, before
  the webhook").
- A Toot already paid for saves with no second checkout, and two taps never pay twice
  (`src/lib/toot-payment.test.ts`, "has nothing to pay for a paid Toot"; `src/app/api/payments.workers.test.ts`,
  "reuses an open session, so two taps can’t pay twice"; "pays for one Toot at a time").
- Save goes nowhere but Stripe's page or this site's dev checkout (`src/lib/toot-payment.test.ts`,
  "goes nowhere but Stripe’s page or this site’s dev checkout").

## When it can't

- A checkout that can't start says why: payments aren't available, the account already keeps as
  many Toots as it can (300), or the payment couldn't start (`src/lib/toot-payment.test.ts`, "says
  why it failed"; `src/app/api/payments.workers.test.ts`, "refuses a deleted Toot, and one past the
  Toot limit, before anything is paid").
- The account won't keep a new Toot that isn't paid for, and one user can't pay for or save
  another's (`src/app/api/payments.workers.test.ts`, "saves a Toot once it is paid for, and not
  before"; "never lets one user pay for, or save, another’s Toot").

## Not checked

- The words of each problem under Save, "Confirming payment…" while the return is checked, and
  "Your payment hasn't come through yet."
- Coming back from the checkout, Song Creator waits for a tap instead of playing the Toot.
- While the account is still being read on the return, Save waits, disabled.
- The browser's Back from the checkout page makes Save tappable again.
- Save where saving is free: no journey runs on Production.

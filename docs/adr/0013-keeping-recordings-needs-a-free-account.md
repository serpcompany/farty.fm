# Keeping Recordings needs a free account

Until #237 a guest kept their Recordings across visits (owner, 2026-10-25, #203), and only their Toots lasted the visit. Where saving was free, a guest could also save a Toot without an account. On 2026-10-28 the product owner replaced the "first Toot free" plan #237 first held:

> "saving your recordings requires a free account.. minting songs requires 99c"

> "keeping Recordings needs a free account, every Toot costs $0.99 with no free one, guests can record and hear Songs during the visit, a guest's existing farts upload when they sign up, and Turnstile stays on sign-up."

1. **A guest's farts last the visit.** A guest can record, collect notes, unlock Songs and hear them. Their new Recordings, with their audio, and their Toots survive a reload in the same tab, also when the clear at the visit's open failed. The next open clears them before anything shows (`clearVisit` in `recording-store.ts`, from `startVisit` in `visit.ts`). An open while another tab of Farty is open is the same visit, as before. So is an open within 10 minutes of a sign-in code going out from the browser (`pedos.codeSent`), while the code works: a home-screen app that iOS ends while the guest reads their code may open again as a new visit.
2. **Farts a guest kept before this stay.** The first open with this change notes the Recordings the browser already holds (`pedos.keptRecordings` in `localStorage`), and a new visit never clears those. They upload when the guest makes an account or signs in (`claimLibrary`), with the rest of the library. If the list can't be read, every Recording stays and only the Toots are cleared.
3. **A free account keeps them.** Signed in, nothing is cleared: the account's library syncs and is kept (#156). A guest's farts from this visit upload when they sign in, as they did before. Only a signed-in browser asks to keep Farty's storage (`keepRecordings()`).
4. **Every saved Toot is $0.99, with no free one** (ADR 0010). Saving a Toot needs an account everywhere, since a payment belongs to an account: a guest's Save opens the account step, then Checkout, or saves straight away where saving is free. Production saves free, signed in, until Stripe's live keys are set; offline, a browser whose library is an account's still saves a free Toot, which uploads later. A guest can still make and hear a Toot in Song Creator.
5. **The account step says what's at stake.** It offers itself once, after the first Result: "Make a free account to keep your farts." A guest whose Recordings are kept from before this (2.) is offered it once more, at their next Result, since #203 told them Recordings stay. The line above its Not now, Profile and the lander say a guest's farts are gone when Farty closes.
6. **Turnstile guards sign-up.** Sending a sign-in code needs a Cloudflare Turnstile token (Better Auth's `captcha` plugin, on `/email-otp/send-verification-otp` only). Signing in with the code needs nothing more. The rate limits are unchanged.

## Why

A guest still tries everything during a visit, and making an account is how they keep what they recorded. With every Toot paid, nothing is free to farm, so the spam worry that came with a free Toot goes away. Turnstile on the code request still keeps scripts from making accounts in bulk.

## Options considered

| Option | Why not, or why |
| --- | --- |
| **Keeping needs a free account, every Toot $0.99, Turnstile on sign-up (chosen)** | The owner's words. A guest still tries everything during a visit. |
| The first Toot free, for a guest or an account | What #237 first held. Dropped by the owner with the free Toot: it needed an inbox record, disposable-domain blocking or a device ID to stop farming. |
| Phone-number sign-up | Kept in reserve if abuse gets past Turnstile. |
| Clear every guest Recording, the ones from before this too | Breaks #203's promise to guests who already kept farts. They stay until the guest signs in. |

## Consequences

- A guest who closes Farty loses what they recorded. The step after the first Result, Not now, Profile, the lander and the privacy page say so.
- Every environment needs Turnstile's keys to send codes: the site key in `wrangler.jsonc`'s `vars` and `TURNSTILE_SECRET_KEY` as a Worker secret. Without them sign-in still reads sessions, but no code is sent. Local runs use Cloudflare's test keys. The setup is in `docs/agents/web.md`.
- The account step loads Turnstile's script from `challenges.cloudflare.com` when it shows the email field.

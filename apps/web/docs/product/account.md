# Accounts

Signing in is optional. A guest's Recordings stay in their browser and their Toots last the visit;
an account keeps both, and every browser signed in to it shares them. This page covers the account
step, signing in, a session that ends, signing out, deleting an account, and sync. How sign-in
works is in [Accounts and sign-in](../../../../docs/agents/accounts.md), how the library syncs in
[ARCHITECTURE.md](../../../../ARCHITECTURE.md#how-data-moves-in-the-web-app), and why in
[ADR 0014](../../../../docs/adr/0014-accounts-and-cloud-save.md).

## Guest

- A guest's Recordings stay in this browser from visit to visit. Their Toots stay through a reload
  and while Farty is open in another tab, and are gone the next time Farty opens
  (`e2e/guest-visit.spec.ts`, "a guest's Recording outlasts closing Farty and still plays, while
  their Toot lasts the visit"; `src/lib/visit.test.ts`, "keeps a guest's Recordings as a new visit
  opens, and clears their Toots").
- A browser's farts from before Toots lasted the visit keep their Recordings and lose their Toots
  after that visit (`e2e/guest-visit.spec.ts`, "a browser's farts from before a guest's Toots lasted
  the visit: the Recording stays, the Toot goes after this visit").
- A library that an older Farty left behind after its account signed out is cleared as a guest's
  visit opens (`src/lib/visit.test.ts`, "clears a library an account left as a guest's,
  from before #203, as a guest's visit opens").
- The account step and Profile each say that without an account the Recordings stay only in this
  browser and the Toots are gone when Farty closes (`e2e/account-step.spec.ts`, "a guest's first
  Result offers the account step, and Not now goes where they tapped"; "Profile's Save to an
  account opens the step, which stays while they read their email").

## The account step

### When the step opens

- A guest's first Result, before going where they tapped. Not now then goes there
  (`e2e/account-step.spec.ts`, "a guest's first Result offers the account step, and Not now goes
  where they tapped").
- Once more after a guest saves their first Toot where saving is free (Production), then never
  (`src/lib/account.test.ts`, "offers at the first Result, then once after a saved Toot, then
  never"; "offers after a saved Toot when no Result has offered it yet"; "never offers once done").
- Profile's Save to an account, the lander's Sign up free and Sign in, and Save to Toots where
  saving is paid ([Paying to save a Toot](payments.md)) (`e2e/account-step.spec.ts`, "Profile's Save
  to an account opens the step, which stays while they read their email"; `e2e/lander.spec.ts`,
  "Sign up free opens the account step under the top bar, whose tabs wait for it";
  `src/components/farty/lander.interaction.test.tsx`, "opens the app with the account step on it
  (%s)"; `e2e/account-pay.spec.ts`, "a guest's Toot plays free, and Save asks for an account
  first").
- A session that ended asks to sign in again, once a visit ([A session that
  ends](#a-session-that-ends)).
- It never offers itself after signing in, or where storage is blocked, since it couldn't remember
  it had (`src/lib/account.test.ts`, "never offers after signing in"; "never offers with storage
  blocked, since it could not remember").

### What it shows

- "Keep your farts", "Make a free account to keep your Recordings and Toots, even on a new phone.",
  an Email field and Send code, a line saying Farty news comes too and can be turned off on Profile,
  with a link to Privacy, the guest line, and Not now. Focus starts on the heading
  (`e2e/account-step.spec.ts`, "a guest's first Result offers the account step, and Not now goes
  where they tapped").
- On a phone it covers the screen; from 768px it is a card under the top bar, whose tabs wait for it
  (`e2e/lander.spec.ts`, "Sign up free opens the account step under the top bar, whose tabs wait for
  it").
- Send code moves to the code: "We sent a 6-digit code to …", a Code field with focus, Sign in and
  Change email (`e2e/account-step.spec.ts`, "signing up from the first Result keeps the Recording,
  and goes where they tapped").
- Not now closes it and gives focus back to what opened it (`e2e/account-step.spec.ts`, "Profile's
  Save to an account opens the step, which stays while they read their email").
- It stays open while they leave to read their email, and a reload comes back to the code, which
  still signs in (`e2e/account-step.spec.ts`, "Profile's Save to an account opens the step, which
  stays while they read their email"; "a reload while they read their email comes back to the code,
  which still signs in"; `src/lib/account.test.ts`, "keeps the phase and email for this tab until
  the step closes").

### Codes and problems

- A code has 6 digits, lasts 10 minutes and allows 3 guesses, and signs in when typed with spaces
  or a dash (`src/server/auth-hooks.test.ts`, "are 6 digits, live 10 minutes and allow 3 guesses,
  defined once"; "sign in when typed with spaces or a dash").
- A wrong code says "That code isn't right. Check it and try again." (`e2e/account-step.spec.ts`,
  "signing up from the first Result keeps the Recording, and goes where they tapped").
- An expired or used-up code says "That code no longer works. Send a new one." and goes back to the
  Email field, with focus on it. A bad email says "Enter a valid email address.", too many requests
  "Too many tries. Wait a few minutes, then try again.", sign-in that isn't set up "Accounts aren't
  available right now." and a failed request "Couldn't reach Farty. Check your connection and try
  again." (`src/lib/account.test.ts`, "reads %i %s as %s";
  `src/components/farty/account-step.interaction.test.tsx`, "says what went wrong in words (%s)";
  "goes back to the Email field when the code no longer works").
- Too many code requests or guesses from one client say to wait a few minutes. Past an email's, a
  network's or the site's codes for the hour, a request answers like a sent code, so nothing says
  whether an account exists (`src/server/rate-limits.test.ts`, "hold code requests at 10 per 10
  minutes per client"; "send an email 20 codes an hour from every client together"; "send one IPv4
  address 30 codes an hour"; "send 300 code emails an hour across the site, and log each request
  that holds";
  `src/server/auth-hooks.test.ts`, "a code request past a per-email limit, or off Staging’s
  allowlist").

## Signing in

- Signing in keeps the guest's Recordings, now the account's, closes the step and goes where they
  tapped. Farty asks the browser to keep its storage, and the step offers itself no more
  (`e2e/account-step.spec.ts`, "signing up from the first Result keeps the Recording, and goes where
  they tapped"; `src/lib/visit.test.ts`, "makes a guest's kept Recordings the account's as a
  signed-in visit opens, and uploads them").
- A guest's Recordings join the account numbered after the account's own, in every browser
  (`e2e/sync.spec.ts`, "a guest's Recording joins the account numbered after the account's, in both
  browsers"; `src/lib/library-sync.test.ts`, "numbers the guest's Recordings after the account's,
  here and on the account").
- Signing in to another account than the one this browser's farts belong to clears them first.
  When some haven't reached that account, the step says how many it removes, with Go back and Sign
  in anyway; with none waiting it asks nothing. The same email, in any case, is the same account
  (`e2e/session-ended.spec.ts`, "signing in to another account says first how many farts here it
  removes, and Go back keeps them"; "signing in to another account mid-visit asks nothing with
  nothing unsaved, and the first account's farts leave the screen"; `src/lib/library-sync.test.ts`,
  "counts the farts not uploaded that signing in to another account would clear").

## A session that ends

- A session lasts 7 days, renewed when read a day or more later (`src/server/auth-session.test.ts`,
  "keeps a session 7 days, moved on when read a day or more after").
- When it ends, the account's farts stay on this device. Farty opens "Sign in again", which says so,
  once a visit, with no guest line. Profile offers Sign in again and Clear this device
  (`e2e/session-ended.spec.ts`, "an account's farts stay when its session ends: Farty asks to sign
  in again, or clears them"; `src/lib/account.test.ts`, "asks once a visit, and never with storage
  blocked").
- Clear this device asks first, then deletes the Recordings and Toots here and leaves those on the
  account (`e2e/session-ended.spec.ts`, "an account's farts stay when its session ends: Farty asks
  to sign in again, or clears them").
- A session that can't be read, offline or refused, counts as unreachable, not signed out, and
  Profile retries it ([Profile](profile.md#account); `src/lib/account.test.ts`, "reads a refused or
  failed request as unreachable, not signed out"; "gives up after 5 seconds and reads
  unreachable").

## Signed in, on Profile

- Profile shows the email and Farty news, on by default. Turning it off is kept on the account
  (`e2e/account-profile.spec.ts`, "Profile's account: the email, Farty news, and Sign out, which
  leaves nothing here").
- Sign out first uploads what hasn't reached the account. While it can't, "Not uploaded yet" offers
  Wait, which keeps the account, and Sign out anyway, which leaves those farts behind
  (`e2e/account-profile.spec.ts`, "Sign out uploads the farts not uploaded yet, and while it can't,
  Wait keeps the account"; "Sign out anyway signs out and leaves behind the farts not uploaded").
- Signing out leaves nothing here and opens Profile as a guest, and Farty's other tabs clear too,
  without a reload (`e2e/account-profile.spec.ts`, "Profile's account: the email, Farty news, and
  Sign out, which leaves nothing here"; "Sign out clears Farty's other tabs too, without a reload").
- Delete account asks "Delete your account?": it deletes the email, Recordings and Toots on every
  device and can't be undone. Then it leaves nothing here (`e2e/account-profile.spec.ts`, "Delete
  account asks first, then deletes the account and leaves nothing here";
  `src/app/api/account/route.workers.test.ts`, "deletes the user’s audio, then their row with their
  sessions, Recordings, Toots and payments").
- When its request fails, Profile says "Couldn't sign out. Check your connection and try again.",
  "Couldn't delete your account. Check your connection and try again." or "Couldn't change Farty
  news. Try again." (`src/components/farty/profile-screen.interaction.test.tsx`, "says it couldn't
  %s when the request fails").
- A Profile left open on one account never changes or deletes another account that a later tab
  signed in to; it shows the account signed in (`e2e/account-profile.spec.ts`, "Profile left open on
  one account never changes or deletes the account another tab signed in to").

## Sync

- Every browser signed in to an account plays the others' Recordings and Toots, and sees their
  deletes and renames once it comes back to Farty, without a reload (`e2e/sync.spec.ts`, "two
  browsers signed in to one account play each other's farts, and see each other's deletes").
- Each save, rename and delete waits on the device until it reaches the account. A Recording waits
  for its analysis, and a refused upload stays waiting while the rest go (`src/lib/library-outbox.test.ts`,
  "queues each save, rename and delete with the change itself"; `src/lib/outbox-send.test.ts`,
  "waits for a Recording's analysis"; "keeps a refused upload queued, and sends the rest").
- An account keeps at most 300 Recordings and 300 Toots
  (`src/app/api/library-uploads.workers.test.ts`, "keeps 300 %s per account, and only 300 when
  uploads race (409)"). A Recording past the account's 300 stays only on this device, waiting to
  upload (`src/lib/outbox-send.test.ts`, "keeps a Recording the account has no room for on this
  device, waiting to upload").

## Staging and local runs

- Staging sends codes only to the emails on its list and creates no other account. A code request
  for another email looks sent, and no email comes (`src/server/auth-session.test.ts`, "sends codes
  from the support address, to its allowlist only"; "creates no account off the allowlist, should it
  change after the code was sent").
- A local run sends no email: each code is at `/dev/mail/` (`e2e/sign-in.spec.ts`, "a code from the
  dev mailbox signs in to the library, and signing out ends the session").

## Not checked

- Nothing on screen says a Recording past the account's 300 hasn't reached it, and Sign out's "Not
  uploaded yet" counts it as waiting for a connection. A test would only hold that gap in place.

# Accounts

Keeping farts needs a free account. A guest's farts last the visit; an account keeps them, and every
browser signed in to it shares them. This page covers the account step, signing in, a session that
ends, signing out, deleting an account, and sync. How sign-in works is in [Accounts and
sign-in](../../../../docs/agents/accounts.md), how the library syncs in
[ARCHITECTURE.md](../../../../ARCHITECTURE.md#how-data-moves-in-the-web-app), and why in
[ADR 0017](../../../../docs/adr/0017-accounts-and-cloud-save.md) and
[ADR 0013](../../../../docs/adr/0013-keeping-recordings-needs-a-free-account.md).

## Guest

- A guest can record, unlock Songs and hear them. Their Recordings, with their audio, and their
  Toots stay through a reload and while Farty is open in another tab, and are gone the next time
  Farty opens (`e2e/guest-visit.spec.ts`, "a guest's farts last the visit: they record and hear a
  Song, and Farty opens again with none"; `src/lib/visit.test.ts`, "clears a guest's farts when a
  new visit opens"; "clears a guest's Recordings, their audio and their Toots as a new visit opens";
  "keeps them while Farty is open in another tab"; "clears nothing on a reload"; "clears nothing on a
  reload after the clear at open failed, so this visit's Recordings stay").
- While a sign-in code sent from this browser still works, 10 minutes, a new visit keeps a guest's
  farts, so a Home Screen app that closed while they read the code opens with them
  (`src/lib/visit.test.ts`, "keeps them while the sign-in code sent from this browser still works";
  "keeps a guest's farts on a new visit while the code they were sent still works";
  `src/lib/account.test.ts`, "remembers a code went out for as long as the code works").
- A visit that can't read the session, offline for one, clears nothing (`src/lib/visit.test.ts`,
  "keeps them unless the session reads as signed out ($status)"; "keeps the first open for the next
  readable one when get-session %s").
- The Recordings a guest kept before keeping them needed an account stay. Their Toots, and the
  Recordings they make since, go after the visit. If the kept ones can't be read, every Recording
  stays (`e2e/guest-visit.spec.ts`, "a guest's Recordings from before #237 stay, while their Toot
  and their new Recordings go after this visit"; `src/lib/visit.test.ts`, "keeps what a browser held
  from before a guest's Toots lasted the visit, for this visit"; "keeps the Recordings a browser held
  from before #237, and clears those made since"; "keeps every Recording when the kept ones can’t be
  read").
- A library that an older Farty left behind after its account signed out is cleared as a guest's
  visit opens (`src/lib/visit.test.ts`, "clears a library an account left as a guest's,
  from before #203, as a guest's visit opens").
- The account step says "Without an account, your farts are gone when you close Farty.", and
  Profile "Your farts are gone when you close Farty, unless you make a free account."
  (`e2e/account-step.spec.ts`, "a guest's first Result offers the account step, and Not now goes
  where they tapped"; "Profile's Save to an account opens the step, which stays while they read
  their email").

## The account step

### When the step opens

- A guest's first Result, before going where they tapped. Not now then goes there
  (`e2e/account-step.spec.ts`, "a guest's first Result offers the account step, and Not now goes
  where they tapped"; `src/lib/account.test.ts`, "offers at the first Result only, remembering it in
  localStorage").
- Once more, at the next Result, for a guest whose Recordings were kept before keeping them needed
  an account (`src/lib/account.test.ts`, "offers the step once more, at the next Result";
  `src/lib/visit.test.ts`, "%s, as it first opens since #237").
- Profile's Save to an account, the lander's Sign up free and Sign in, and a guest's Save to Toots
  ([Paying to save a Toot](payments.md#a-guest)) (`e2e/account-step.spec.ts`, "Profile's Save to an
  account opens the step, which stays while they read their email"; `e2e/lander.spec.ts`, "Sign up
  free opens the account step under the top bar, whose tabs wait for it";
  `src/components/farty/lander.interaction.test.tsx`, "opens the app with the account step on it
  (%s)"; `e2e/account-pay.spec.ts`, "a guest's Toot plays free, and Save asks for an account
  first"; `src/components/farty/song-creator.interaction.test.tsx`, "asks for an account before
  saving or paying, where saving is %s").
- A session that ended asks to sign in again, once a visit ([A session that
  ends](#a-session-that-ends)).
- It never offers itself after signing in, or where storage is blocked, since it couldn't remember
  it had (`src/lib/account.test.ts`, "never offers after signing in, or where it was offered twice
  before #237"; "never offers with storage blocked, since it could not remember").

### What it shows

- "Keep your farts", "Make a free account to keep your farts.", an Email field, Turnstile's check
  and Send code, a line saying Farty news comes too and can be turned off on Profile, with a link to
  Privacy, the guest line, and Not now. Focus starts on the heading (`e2e/account-step.spec.ts`, "a
  guest's first Result offers the account step, and Not now goes where they tapped").
- On a phone it covers the screen; from 768px it is a card under the top bar, whose tabs wait for it
  (`e2e/lander.spec.ts`, "Sign up free opens the account step under the top bar, whose tabs wait for
  it").
- Send code moves to the code: "We sent a 6-digit code to …", a Code field with focus, Sign in and
  Change email (`e2e/account-step.spec.ts`, "signing up from the first Result goes where they
  tapped, and Farty opens again with their Recording").
- Not now closes it and gives focus back to what opened it (`e2e/account-step.spec.ts`, "Profile's
  Save to an account opens the step, which stays while they read their email").
- It stays open while they leave to read their email, and a reload comes back to the code, which
  still signs in (`e2e/account-step.spec.ts`, "Profile's Save to an account opens the step, which
  stays while they read their email"; "a reload while they read their email comes back to the code,
  which still signs in"; `src/lib/account.test.ts`, "keeps the phase and email for this tab until
  the step closes").

### Turnstile

- Sending a code needs Cloudflare Turnstile's check that a person asks. The step reads the site key
  when it shows the email, renders the widget under it, and Send code waits, disabled, for its
  token. A token works once: each send renders a new widget for the next
  (`src/components/farty/account-step.interaction.test.tsx`, "waits for the widget's token, then
  sends the code with it"; `e2e/account-step.spec.ts`, "a guest's first Result offers the account
  step, and Not now goes where they tapped").
- When the site key can't be read, Turnstile can't load, or it fails after giving a token, the step
  says "Couldn't reach Farty. Check your connection and try again." and Send code stays tappable: a
  tap reads the key again or renders a new widget, and so does coming back online. No code goes out
  without a new token (`src/components/farty/account-step.interaction.test.tsx`, "reads the site key
  again on a tap when it couldn't be read"; "renders a new widget on a tap when Turnstile couldn't
  load"; "drops the token and renders a new widget on a tap when Turnstile fails after giving one";
  "tries again when the browser comes back online"; `e2e/account-step.spec.ts`, "when Turnstile's
  check can't start, Send code tries again and sends the code").
- A token Turnstile refuses says "Couldn't check that you're a person. Try again."
  (`src/components/farty/account-step.interaction.test.tsx`, "says what went wrong in words (%s)").
- The server sends a code only with a token Turnstile accepts, asked with the client's address, and
  refuses one when Turnstile can't be reached. Signing in with the code needs no token
  (`src/server/auth-hooks.test.ts`, "refuses a code request without a token, having spent only the
  client’s limit"; "refuses a code request with a token Turnstile rejects"; "sends a code once
  Turnstile accepts the token, asking with the secret and the client"; "refuses a code request when
  siteverify can’t be reached"; "checks only code requests";
  `src/app/api/auth/turnstile.workers.test.ts`, "is refused without a Turnstile token, and sends
  nothing"; "is refused with a token Turnstile rejects"; `e2e/sign-in.spec.ts`, "a code is sent only
  with a Turnstile token, and the page reads the site key").
- Staging and Production each have their own site key, and a local run uses Cloudflare's test keys,
  whose widget always passes (`src/db/deploy-config.test.ts`, "has its own Turnstile site key, and
  the top level Cloudflare’s test key"; `src/server/auth-session.test.ts`, "take Turnstile’s keys
  from the environment, or locally Cloudflare’s test keys"; `src/server/auth-request.test.ts`,
  "answers the Turnstile site key, never cached: the var, or locally Cloudflare’s test key";
  `src/app/api/auth/turnstile.workers.test.ts`, "answers wrangler.jsonc’s local site key, never
  cached").

### Codes and problems

- A code has 6 digits, lasts 10 minutes and allows 3 guesses, and signs in when typed with spaces
  or a dash (`src/server/auth-hooks.test.ts`, "are 6 digits, live 10 minutes and allow 3 guesses,
  defined once"; "sign in when typed with spaces or a dash").
- A wrong code says "That code isn't right. Check it and try again." (`e2e/account-step.spec.ts`,
  "signing up from the first Result goes where they tapped, and Farty opens again with their
  Recording").
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

- Signing in keeps the guest's Recordings, now the account's, those kept from before included,
  closes the step and goes where they tapped. Farty asks the browser to keep its storage, opens again
  with the Recording, and the step offers itself no more (`e2e/account-step.spec.ts`, "signing up
  from the first Result goes where they tapped, and Farty opens again with their Recording";
  `src/lib/visit.test.ts`, "uploads a guest's Recordings as they sign in, those kept from before
  #237 included").
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
- A Recording placed on a note by ear, moved or taken off reaches the account, in its upload when
  that hasn't gone yet, and once however often it changed. A placement the account refuses is
  dropped, and one on a Recording the account deleted deletes it here too
  (`src/lib/outbox-send.test.ts`, "places a Recording on the account, in its upload or after it (ADR
  0015)"; "places a Recording on the account that was placed while it uploaded"; "sends the Placed
  Pitch of a Recording the account already had, from an upload cut off before it was placed";
  "forgets a place the account refuses, and deletes here what it deleted";
  `src/app/api/recording-placement.workers.test.ts`, "places a Recording on a note, moves it and
  takes it off, keeping its analysis"; "refuses a note that is not a MIDI note (400), a deleted
  Recording (410), an unknown one (404) and another library (409)";
  `src/app/api/library-uploads.workers.test.ts`, "keep the Placed Pitch (ADR 0015), and none when a
  browser before #268 sends none").
- Another browser's placement shows here once it comes back to Farty, keeping this browser's own
  analysis, unless this browser is still sending its own (`src/lib/library-pull.test.ts`, "applies
  another browser's Placed Pitch, keeping this browser's own analysis (ADR 0015)"; "shows another
  browser's placement on the screen's Recordings, with this browser's analysis"; "keeps a Placed
  Pitch this browser is sending, and reads none from a Worker before #268 as no change";
  `src/components/farty/place-by-ear.interaction.test.tsx`, "shows another browser's placement
  while it's open, read live from the Recordings").
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

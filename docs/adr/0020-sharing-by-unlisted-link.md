# Sharing by unlisted link

Until #316 nothing a user made could leave their account. On 2026-11-03 the product owner asked for it (#315):

> "as a user i want to be able to 'share' my fart raw recordings with other people (which should be some kind of link to the recording on my profile and if they dont have the app it goes through prompting them to get it…"

#315 split the work into five slices (#316 to #320). Its design log and the orchestrator's decisions for epic #311 settled the following, which #316 builds for Recordings. #317 (Toots), #318 (Get Farty with the friend offer), #319 (Friends and profile pages) and #320 (Share from the review screen) build on it.

1. **Only a user with an account shares.**
   - A guest who taps Share gets the account step, reworded: "Make a free account. You need one to share. It keeps your farts too." Signed in, they carry on to share.
   - A Recording is shared from the account, so it must have reached it. One still in this browser's outbox answers 404 and Share says to wait for it to upload.
2. **A Handle, picked once, at the first share.**
   - "Pick a handle" suggests one from the email's local part when it's free, and checks each change as the user types: free, taken, not allowed or too short (`GET /api/handle/?check=`).
   - A Handle is 3 to 20 of `a-z`, `0-9` and `_`, lowercased (`src/lib/handle.ts`). It is refused when it's reserved (Farty's own words, its routes, staff-sounding names) or contains a slur, digits swapped for letters included.
   - `PUT /api/handle/` claims it in one statement, so two people can't both get one. A Handle can't be changed yet; links carry it, so a change would break them.
   - Profile shows it, under Email.
3. **A link is a random id, not the Recording's.**
   - `/u/<handle>/r/<share id>/`, where the share id is 12 random characters of lowercase Crockford base 32 (60 bits, `newShareId()`). It can't be guessed from another link and says nothing of the Recording's own id.
   - Stop sharing deletes the share, and sharing again makes a new id, so a link that was stopped never works again.
4. **Unlisted: anyone with the link, and nothing else.**
   - The page, its image and its audio need no account. Nothing lists a link: there's no profile page until #319 (which lists a user's shares on it, ADR 0021), every shared page is `noindex, nofollow` with no canonical, and the sitemaps leave `/u/` out.
   - It shows the Handle, the Recording's name, its note (a Placed Pitch counts), its length and the waveform of the part it plays, which is what its row plays: its Trim (ADR 0019), or else the whole take. Nothing else of the account: no email, no other Recordings.
   - Nothing is public until the user shares. A Recording that was never shared, or whose share stopped, answers the same 404 as one that never existed.
5. **Each request checks D1.**
   - The page, `opengraph-image` and `audio/` each look up the share, its owner's Handle and the live Recording (`sharedRecording()` in `src/db/sharing.ts`). A share stopped or taken down, a Recording deleted (its tombstone) and an account deleted (`on delete cascade`) all fail the lookup, at once and alike.
   - So nothing that could outlive the link is kept anywhere between: the page and its image are `private, no-cache`, and the service worker never handles `/u/` (`public/sw.js`).
6. **Audio through the Worker, never a public bucket.**
   - `GET /u/<handle>/r/<id>/audio/` checks the share, then serves only the part the page plays, its Trim or else the whole take, as a WAV of its own: a plain cut of its frames, read from R2 as a byte range under a fresh header. Audio trimmed off is never served. The cut comes from this data center's Workers cache, keyed by its R2 key and the Trim, or from R2 into it. R2 keys are written once (`media.ts`), and a changed Trim is a new key, so the copy is never stale.
   - The browser gets `private, no-cache` with an ETag, so each play revalidates against D1 (a 304 when nothing changed), and a link stopped or taken down never plays again.
   - The page fetches it only on Play and plays it with the app's player, from where its row would start, at its own pitch and speed (ADR 0004, ADR 0012).
7. **Link previews: a title and an image drawn per request.**
   - `og:title` is "Recording 3 by @maya", `og:description` "A G3 fart on Farty. Tap to play.", with `summary_large_image` for X.
   - `opengraph-image.tsx` draws a 1200 by 630 PNG with `next/og`: Farty's pink and icon, the note, the name, "A fart by @maya" and the waveform's bars. It reads D1 like the page, so a stopped link's image is gone too, and Next's default (`public, max-age=0, must-revalidate` in Next 16.3) is replaced by `private, no-cache`. The bundled font has no ♯, and a missing glyph makes `next/og` fetch one from Google Fonts on the request, so the image spells a sharp `#`.
8. **Share, then the share sheet.**
   - On a Recording's row, Share puts the link on the phone's share sheet (`navigator.share`), or copies it where there's none. A row that is shared says "Shared", and its button opens Share link and Stop sharing.
   - The record flow offers the same Share at the top of Result, the step after its review's Save, once the take is saved (#320). The review before Save has none: the take isn't a Recording yet.
   - When the browser has spent the tap's activation on the requests before the sheet (a `NotAllowedError`), a "Your link is ready" dialog offers the sheet on a fresh tap.
   - Stop sharing asks first: "The link stops working for everyone who has it. Sharing it again makes a new link." Deleting a shared Recording, or the account, says its links stop working too.
9. **Report, on every shared page, reaches Farty in D1.**
   - Report asks first, then `POST /u/<handle>/r/<id>/report/`, from Farty's own origin only. Each report is a `share_reports` row (the share, its owner, the item, when) and a `share_reported` log line. Nothing about the person who reported is kept.
   - A reporter keeps at most 10 an hour, a Recording 5 a day whichever link it's shared under, and the site 300 an hour (`REPORT_LIMITS`, counted in `rate_limit`), so one client can't spend the site's and a script can't fill D1. The reporter's row is keyed by an HMAC of their `cf-connecting-ip`, never the address. A report spends a slot of each only when all three have one, and past any of them it answers 429, which the page says.
   - The owner takes a link down by setting its share's `taken_down_at` in the D1 console (`docs/agents/web.md`, Reports and take-downs). A share taken down stays: Stop sharing and deleting the Recording leave it, and sharing that Recording again answers 403 `taken_down`.
10. **The shared page is option A, the Player.**
    - The fart comes first: "@maya shared a Recording", the name, the note, a big waveform that plays from a tap, and Play. The app's tab bar isn't on it; its own top bar has Farty and Get Farty.
    - Signed out, Get Farty sits under the player with "Record your own farts and turn them into songs. Free, no app store." Signed in, the top bar says Open Farty and the block isn't there. Both open `/` until #318.
    - A link that doesn't work says "This link doesn't work any more. It was taken down or deleted." with Get Farty, and answers 404.

## Toots (#317)

A saved Toot shares the same way, through the same Handle, `shares` rows (`kind` `toots`), checks and Report. Only what differs:

- **Saved Toots only.** A Toot shares once it is in the account, which it reaches only once paid for (ADR 0010). Song Creator's unpaid preview has no Share, and a Toot that was never saved, or is still in the outbox, answers 404 like a Recording. Share sits in a saved Toot's header and in each Toots row's ⋯ menu, not on the row itself.
- **The link is `/u/<handle>/t/<share id>/`.** A Recording's id under `t/`, or a Toot's under `r/`, answers 404.
- **The page shows the Toot's title, the Song it plays, its length and the waveform of its saved audio.** A Sound Pad Toot's Song line says "Sound Pad". The catalog names no composer, so the page doesn't either.
- **The audio is the saved WAV as stored**, the whole file, from the Workers cache by its R2 key or from R2 into it, with the same `private, no-cache` and ETag. Nothing is rendered for the link.
- **The waveform is drawn on the server** from that WAV (60 bars, `sharedTootLevels`), after the D1 check, and cached by its R2 key, since a Toot's row keeps no bars of its own.
- **Link preview:** `og:title` is "Mary Had a Little Lamb by @maya", `og:description` "Mary Had a Little Lamb, played on farts. Tap to play." (a Sound Pad Toot's "A fart song on Farty. Tap to play."), and the image says "A fart song by @maya", with no note.
- **Report limits are shared with Recordings:** the same 10 an hour per reporter and 300 an hour for the site count both, and a Toot gets 5 a day like a Recording.
- Deleting a shared Toot says its link stops working too.
- **A Toot that plays a taken-down Recording is down too.** Its page, image, audio and Report answer 404 while any Recording in its Arrangement or Sound Pad Performance is taken down, and sharing it answers 403 `taken_down`, so a Toot never makes that Recording's audio public again (`sharedToot`, `tootPlaysTakenDown` in `src/db/sharing.ts`).

## Tables

Migration `0008_sharing`:

- `handles`: `user_id` (primary key, on delete cascade), `handle` (unique), `created_at`.
- `shares`: `id` (the share id), `user_id` (on delete cascade), `kind` (`recordings`, and `toots` from #317), `item_id`, `created_at`, `taken_down_at`. One per user, kind and item.
- `share_reports`: `id`, `share_id`, `user_id` (the owner's, on delete cascade), `kind`, `item_id`, `created_at`.

## Considered

- **The Recording's id in the link.** Simpler, but sharing again after Stop sharing would bring the old link back, and the id would be exposed.
- **A public R2 bucket, or a signed R2 URL.** A bucket URL outlives Stop sharing and take-downs in every cache it reaches, and #315 rules it out. A signed URL would still play until it expired.
- **Caching the page or image at the edge.** It would serve a stopped link until the cache expired. The D1 lookup is one indexed join.
- **Emailing Farty for each report.** Left for later: the log line and the table are enough while reports are rare, and Staging's email goes only to its allowlist.

## Consequences

- The Worker carries `next/og`'s renderer (`resvg.wasm`, 1.4 MB, and `yoga.wasm`) for the link image.
- Shared pages are behind the Staging gate on Staging, so link previews can be checked only on Production.
- A Handle can't be changed or released yet. Deleting the account frees it.
- Taking down needs the owner in the D1 console. A moderation screen comes when reports need one.

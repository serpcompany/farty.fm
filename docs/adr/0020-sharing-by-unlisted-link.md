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
3. **A link is named for what it shares, never by the item's own id.**
   - `/@<handle>/r/<slug>/`, where the slug is the Recording's name, as in `/@maya/r/recording-3/`, lowercased with hyphens (`slugify()`, `src/lib/slug.ts`). When that user has that kind of link by that name already, the next takes `-2`, `-3` and so on. Renaming the Recording keeps its link.
   - It was the share id until #441 (2026-11-07), when the owner said "the 'urls' generated are gibbeish": 12 random characters of lowercase Crockford base 32 (60 bits, `newShareId()`). That id is still the `shares` row's key. A link sent with one keeps working: its page answers one 308 to the named link, and its image, audio and Report answer as before. A share from before #441 gets its slug the first time anything reads it (`giveSlugs()`, `slugOf()` in `src/server/sharing.ts`).
   - Links were `/u/<handle>/…` until #382 (2026-11-04), when the owner moved them under `/@<handle>/`. Each old path answers one 308 to its new one, query included (`next.config.ts`), so a link already sent keeps working. A Handle never holds `@` or `/`, so a path names one Handle only.
   - Stop sharing deletes the share, so the link stops working and its name is free. Sharing again makes a new share, which gets that name back if nothing else has taken it, so the same link works again (#441). The next thing shared by that name takes the link, so whoever holds the old link hears that instead. A share taken down keeps its row, and so its name.
   - A slug can be guessed, which an unlisted link's random id couldn't be, but a profile page already lists every share (ADR 0021), so this shows no one anything new. A Recording that isn't shared has no link by any name.
4. **Unlisted: anyone with the link, and nothing else.**
   - The page, its image and its audio need no account. Nothing lists a link: there's no profile page until #319 (which lists a user's shares on it, ADR 0021), every shared page is `noindex, nofollow` with no canonical, and the sitemaps leave `/@<handle>/` out.
   - It shows the Handle, the Recording's name, its note (a Placed Pitch counts), its length, when it was recorded (#443) and where (#444), and the waveform of the part it plays, which is what its row plays: its Trim (ADR 0019), or else the whole take. Nothing else of the account: no email, no other Recordings.
   - Nothing is public until the user shares. A Recording that was never shared, or whose share stopped, answers the same 404 as one that never existed.
5. **Each request checks D1.**
   - The page, its link image (`image/`) and `audio/` each look up the share, its owner's Handle and the live Recording (`sharedRecording()` in `src/db/sharing.ts`). A share stopped or taken down, a Recording deleted (its tombstone) and an account deleted (`on delete cascade`) all fail the lookup, at once and alike.
   - So nothing that could outlive the link is kept anywhere between: the page and its image are `private, no-cache`, and the service worker never handles `/@<handle>/…`, nor the old `/u/` paths that redirect there (`public/sw.js`).
6. **Audio through the Worker, never a public bucket.**
   - `GET /@<handle>/r/<id>/audio/` checks the share, then serves only the part the page plays, its Trim or else the whole take, as a WAV of its own: a plain cut of its frames, read from R2 as a byte range under a fresh header. Audio trimmed off is never served. The cut comes from this data center's Workers cache, keyed by its R2 key and the Trim, or from R2 into it. R2 keys are written once (`media.ts`), and a changed Trim is a new key, so the copy is never stale.
   - The browser gets `private, no-cache` with an ETag, so each play revalidates against D1 (a 304 when nothing changed), and a link stopped or taken down answers 404 from then on. A tab that has already played a sound keeps its decode until it leaves the page, so it can play that sound again. The ETag of a cut is a hash (`partEtag`), so it says nothing of where the cut sits in its take.
   - The page fetches it only on Play and plays it with the app's player, from where its row would start, at its own pitch and speed (ADR 0004, ADR 0012).
7. **Link previews: a title and an image drawn per request.**
   - `og:title` is "Recording 3 by @maya", `og:description` "A G3 fart on Farty. Tap to play.", with `summary_large_image` for X.
   - The page's `image/` route draws a 1200 by 630 PNG with `next/og`: Farty's pink and icon, the note, the name, "A fart by @maya" and the waveform's bars. It was an `opengraph-image.tsx` until #382, but Next escapes the `@` in that file's URL, so the page now names the route in its Open Graph tags itself (`src/server/link-preview.tsx`). It reads D1 like the page, so a stopped link's image is gone too, and it answers `private, no-cache`. The bundled font has no ♯, and a missing glyph makes `next/og` fetch one from Google Fonts on the request, so the image spells a sharp `#`.
8. **Share, then the share sheet.**
   - On a Recording's row, Share puts the link on the phone's share sheet (`navigator.share`), or copies it where there's none. A row that is shared says "Shared", and its button opens Share link and Stop sharing.
   - The record flow offers the same Share at the top of Result, the step after its review's Save, once the take is saved (#320). The review before Save has none: the take isn't a Recording yet.
   - When the browser has spent the tap's activation on the requests before the sheet (a `NotAllowedError`), a "Your link is ready" dialog offers the sheet on a fresh tap.
   - Stop sharing asks first: "The link stops working for everyone who has it, until you share something by that name again." Deleting a shared Recording, or the account, says its links stop working too.
9. **Report, on every shared page, reaches Farty in D1.**
   - Report asks first, then `POST /@<handle>/r/<id>/report/`, from Farty's own origin only. Each report is a `share_reports` row (the share, its owner, the item, when) and a `share_reported` log line. Nothing about the person who reported is kept.
   - A reporter keeps at most 10 an hour, a Recording 5 a day whichever link it's shared under, and the site 300 an hour (`REPORT_LIMITS`, counted in `rate_limit`), so one client can't spend the site's and a script can't fill D1. The reporter's row is keyed by an HMAC of their `cf-connecting-ip`, never the address. A report spends a slot of each only when all three have one, and past any of them it answers 429, which the page says.
   - The owner takes a link down by setting its share's `taken_down_at` in the D1 console (`docs/agents/web.md`, Reports and take-downs). A share taken down stays: Stop sharing and deleting the Recording leave it, and sharing that Recording again answers 403 `taken_down`.
10. **The shared page is option A, the Player.**
    - The fart comes first: "@maya shared a Recording", the name, the note, a big waveform that plays from a tap, and Play.
    - Since #441 it sits in the site's own header and footer, as a profile page does (`site-chrome.tsx`): the lander's, with Get Farty for the lander's buttons, and the lander's section links on a computer. On a phone the app's tab bar is there too, for anyone, since a guest can record; from 768px the header stands in for it. Until then it had a top bar of its own and no tabs.
    - Signed out, Get Farty sits under the player with "Record your own farts and turn them into songs. Free, no app store." Signed in, the top bar says Open Farty and the block isn't there. Both open `/` until #318.
    - A link that doesn't work says "This link doesn't work any more. It was taken down or deleted." with Get Farty, and answers 404.

## Toots (#317)

A saved Toot shares the same way, through the same Handle, `shares` rows (`kind` `toots`), checks and Report. Only what differs:

- **Saved Toots only.** A Toot shares once it is in the account, which it reaches only once paid for (ADR 0010). Song Creator's unpaid preview has no Share, and a Toot that was never saved, or is still in the outbox, answers 404 like a Recording. Share sits in a saved Toot's header and in each Toots row's ⋯ menu, not on the row itself.
- **The link is `/@<handle>/t/<slug>/`, named for the Song it plays**, even when the Toot is renamed: `/@maya/t/i-saw-three-ships/`, then `-2` for the next Toot of it (#441). A Sound Pad Toot, or one whose Song isn't in Farty any more, is named for its title. Each kind has its own names, so a Recording and a Toot can both be `recording-1`, under `r/` and `t/`.
- **The page shows the Toot's title, the Song it plays, its length and the waveform of its saved audio.** A Sound Pad Toot's Song line says "Sound Pad". The catalog names no composer, so the page doesn't either.
- **Under the player, what it's made of (#443):** the note roll, with its playhead, a tapped note playing from the Toot's own audio as on the Toot's screen, and "Recordings used": each fart's name, the note it plays, its length, its waveform and when it was recorded, playing alone. The owner asked on 2026-11-07: "instead of just the waveform, we should include the whole midiroll, and indivdual samples under the track".
  - The roll is the score the Toot saved. A Toot from before #254 saved none, so the page fetches its Song's notes as they are now, and does without the roll when it can't, or when the Song is gone. A Sound Pad Toot's roll is its taps, one lane per fart, each as long as that fart or until the Toot ends.
  - A fart is known to the page only by its place in the Toot, `t/<slug>/farts/<place>/audio/`, so no Recording's id leaves the server. It answers as the Toot's audio does, after the same D1 check, and serves only the fart (`tootFartPart`): what its Trim found between its handles, or what analysis found, with no lead-in. The rest of a take is whatever else the microphone heard, and a Recording's own link is where its owner decides to share that. It answers 404 for a Recording since deleted, which keeps its row with its note and no Play, and for a fart analysis hasn't found, whose row has no Play. Only the Toot's owner's Recordings are ever looked up.
  - Toots already shared show all this as soon as it ships. Each fart's audio was already in the Toot's own, but its name, when it was recorded and hearing it alone are new to those links, and their owners weren't asked.
  - A Toot's fart is public while the Toot's link works, whatever that Recording's own link does: sharing the Toot shares what it's made of, and stopping the Recording's own link doesn't take it off the Toot. A take-down does, since a Toot that plays a taken-down Recording is down too.
- **The audio is the saved WAV as stored**, the whole file, from the Workers cache by its R2 key or from R2 into it, with the same `private, no-cache` and ETag. Nothing is rendered for the link.
- **The waveform is drawn on the server** from that WAV (60 bars, `sharedTootLevels`), after the D1 check, and cached by its R2 key, since a Toot's row keeps no bars of its own.
- **Link preview:** `og:title` is "Mary Had a Little Lamb by @maya", `og:description` "Mary Had a Little Lamb, played on farts. Tap to play." (a Sound Pad Toot's "A fart song on Farty. Tap to play."), and the image says "A fart song by @maya", with no note.
- **Report limits are shared with Recordings:** the same 10 an hour per reporter and 300 an hour for the site count both, and a Toot gets 5 a day like a Recording.
- Deleting a shared Toot says its link stops working too.
- **A Toot that plays a taken-down Recording is down too.** Its page, image, audio and Report answer 404 while any Recording in its Arrangement or Sound Pad Performance is taken down, and sharing it answers 403 `taken_down`, so a Toot never makes that Recording's audio public again (`sharedToot`, `tootPlaysTakenDown` in `src/db/sharing.ts`).

## Where a fart was made (#444)

On 2026-11-07 the owner asked for "the date and time of the fart, and the geolocation, etc. and including that data bc its hilarious". #443 shows the date and time. This adds the place, as far as a public page can:

- **A city, never closer.** These pages are public, and a street-level position would show where someone lives. So there's no browser prompt and no GPS. A Recording's `place` keeps the `city`, `country` and time zone of the request's Cloudflare properties, and the `region` in the US, where a page names the state (`recordedPlaceOf()`, `src/lib/fart-place.ts`), and never its IP address, coordinates, postal code or metro code. It comes from the connection, so a VPN gives the VPN's city. Tor, and a request naming no country, keep nothing.
- **From the first upload, once.** Uploading again and editing never change it, and the library API never returns or takes it, so no browser holds it or can say it. A take more than an hour old when it uploads keeps none (`placeOfUpload()`): a take uploads once it's saved, so an older one waited for a connection, maybe until its owner got home, and it would name their home as where a fart made elsewhere was made. A take that waited less than an hour can still name the wrong city. Recordings from before #444 have none, so nothing already shared gains one. Deleting a Recording clears it from its tombstone.
- **The pages say "Recorded Nov 6, 2026, 3:12 PM · Austin, Texas"**, on a shared Recording and each of a shared Toot's "Recordings used" rows: a city and state in the US, a city and country elsewhere, with the time in that place's time zone. With no place, the time is the viewer's own. Link previews never say it, since apps keep them.
- **Profile's Show where I farted**, on by default (`user.show_fart_places`). Off, the pages' data leaves out the place and the time zone, at once, since each page reads D1, links already sent included. Off also forgets every place kept: they said not to show them, and keeping them would put old cities back on every link the day they turn it on for one new fart. New Recordings keep none while it's off, and on again only new Recordings say where.
- **It says so before anything's public:** Pick a handle, the owner's own profile page (for a Handle from before this, which never saw that step) and the Privacy page.
- **What it risks:** a Handle's page lists every share, so its shared farts together give a rough timeline of where its owner has been, and a city can be a small town. It's on by default because the owner asked for it. A Handle from before this shares again with no dialog, so its owner may not know until they open their own page.

## Tables

Migration `0008_sharing`, and `slug` from `0016_share_slugs`:

- `handles`: `user_id` (primary key, on delete cascade), `handle` (unique), `created_at`.
- `shares`: `id` (the share id), `user_id` (on delete cascade), `kind` (`recordings`, and `toots` from #317), `item_id`, `slug` (null until it's read, on a share from before #441), `created_at`, `taken_down_at`. One per user, kind and item, and one per user, kind and slug.
- `share_reports`: `id`, `share_id`, `user_id` (the owner's, on delete cascade), `kind`, `item_id`, `created_at`.

## Considered

- **The Recording's id in the link.** Simpler, but the id would be exposed, and it's no nicer to read than a random one.
- **A random id in the link.** What links had until #441. It kept a stopped link from ever working again, but it says nothing about the fart, and the owner asked for the Song's name.
- **A public R2 bucket, or a signed R2 URL.** A bucket URL outlives Stop sharing and take-downs in every cache it reaches, and #315 rules it out. A signed URL would still play until it expired.
- **Caching the page or image at the edge.** It would serve a stopped link until the cache expired. The D1 lookup is one indexed join.
- **The browser's exact location.** Funnier, but a public page would show where someone lives, and it would need a permission prompt on the record screen. Refused.
- **Keeping the place with the switch off, to show if it's turned on.** It would keep what the user said not to show, and bring it back on every link at once.
- **Emailing Farty for each report.** Left for later: the log line and the table are enough while reports are rare, and Staging's email goes only to its allowlist.

## Consequences

- The Worker carries `next/og`'s renderer (`resvg.wasm`, 1.4 MB, and `yoga.wasm`) for the link image.
- Shared pages are behind the Staging gate on Staging, so link previews can be checked only on Production.
- A Handle can't be changed or released yet. Deleting the account frees it.
- A stranger can then claim that Handle, and whatever they share by the same name answers the old owner's link. Accepted for now.
- Taking down needs the owner in the D1 console. A moderation screen comes when reports need one.

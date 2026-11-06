# Friends and profile pages

#315 asked for "a 'add friends' simple social networky type of thing", and its design log settled a profile page and Friends in Profile ([#profile-page](https://claude.ai/artifact/HiXtmuCaCbkGJEWh4QLBRP#profile-page), [#friends](https://claude.ai/artifact/HiXtmuCaCbkGJEWh4QLBRP#friends)). #319 builds them on sharing (ADR 0020). The owner was away and asked not to be a blocker, so the issue and the prototype stand as approved (epic #311).

1. **A profile page, `/@<handle>/`, lists what its user shares.**
   - It was `/u/<handle>/` until #382 (2026-11-04), which still answers a 308 to it (ADR 0020).
   - Anyone can open it, signed in or not. Since #448 (2026-11-07, the owner's pick of a SoundCloud-style layout) it has a hero, then a tab for each kind:
     - **The hero:** a banner of the newest shared Toot's note roll, drawn as that Toot's own page draws it, with a Play that plays that Toot. Then a picture made from the Handle's first letter, the Handle and the friend control. With no Toot shared there's no banner. There's no photo upload and no Edit profile. Your own page is the same page, with its note in place of Add friend.
     - **Toots | Recordings,** with Toots first and open, even when only Recordings are shared (the owner's call). Each tab lists that user's live shares of its kind, newest first by when each was shared (#346).
     - **Each row is laid out as SoundCloud's track row.** A square picture: a Recording's note, big, or a Toot's note roll. Then Play, with a grey line over its name: the farts a Toot plays, or the Handle. At the right, the date, with a tag under it: a Recording's note, or a Toot's Song when that isn't its name. A Toot's key isn't stored, so it has none. Then its waveform across the row, with its length at the bottom right and, while it plays, where it is at the bottom left. Under it, Copy link, a plain link that copies its link. No counts and no ⋯ menu.
     - **Each row plays in place,** as the shared page does, and only its own link's audio. Its waveform fills in Farty's pink as it plays, and plays from where it's tapped. Its name opens its shared page, with a Toot's whole roll and each fart under it (#445, #446).
     - **A Recording's row is its fart.** Its length is the fart's (`formattedFartLength`), the figure its own page and the Recordings tab print (ADR 0011, ADR 0019). Its waveform, Play and running time cover only that fart inside what its link serves (`tootFartPart`, as a shared Toot's fart rows play), so a take's lead-in silence never shows a longer time than its length. That's a trim of its own audio (ADR 0004). Its own page still plays all its link serves.
     - **A Toot's bars and roll** come from its saved WAV and notes. Its row fetches them from `/@<handle>/t/<link>/row/` once it's on screen, so the page never reads every Toot's audio or notes. The list reads only a Sound Pad Toot's Recordings, never its taps (`profileShares()` in `src/db/profiles.ts`).
     - **No row says where a fart was made.** Only each item's own page does (#444).
   - It lists only a live share of a live Recording or Toot of a live account, read from D1 on every request (`findProfile()` in `src/server/profiles.ts`). A share that was stopped or taken down drops off at once. So does a deleted Recording, Toot or account, and a Toot that plays a taken-down Recording, as its link does (ADR 0020, `takenDownRecordings` and `playsAny` in `src/db/sharing.ts`).
   - So ADR 0020's links are no longer listed nowhere: a user's page lists them. Search engines are still asked not to index the page (`noindex, nofollow`, no canonical, not in the sitemaps), it's `private, no-cache`, and the service worker leaves `/@<handle>/` alone.
   - No counts, no feed, no likes, comments or messages (#315). The tabs list only the page's own user's shares, never anyone else's (#448).
   - A Handle no one has answers the shared page's 404, "This link doesn't work any more."
   - It has the site's header and footer, and the tab bar on a phone, as other social sites do (#441, ADR 0020 item 10). A Toot's row doesn't repeat its Song when that's its name.
2. **The friend control has five states.** Add friend; Requested, which can be cancelled; their request, with Accept and Decline; Friends, which can be removed; and on your own page, a note that it lists only what you've shared. Signed out, Add friend opens `/` until #318 makes it Get Farty with the friend offer.
3. **Friends in Profile, under Stats.** "Friend requests" shows only when someone asked, with Accept and Decline. "Friends" lists friends, each opening their page, and the requests you've sent; ⋯ removes a friend or cancels a request, and removing asks first ("@maya isn't told"). "Add friend" takes a Handle. Account's Handle row becomes "Your page".
4. **A request needs the sender's Handle.** The first request asks for one, with the dialog the first share uses, because the person asked sees only a Handle. `POST /api/friends/` answers 409 `no_handle` without one, so #318's sign-up picks a Handle before it sends its request.
5. **Every route acts only for the signed-in user.** `/api/friends/` (the lists; send a request by Handle) and `/api/friends/<handle>/` (the state; accept, decline, cancel or remove) are `userRoute`s, and each names only the other user: accept and decline act on that user's request to you, cancel on yours to them, remove on your friendship. So no one can act on a request or friendship that isn't theirs. A request to a Handle no one has (404), to yourself (400), or a second one (409) is refused. Asking someone who already asked you accepts their request. `requestFriend()` in `src/server/friends.ts` is the one way to send a request, for #318 too.
6. **Rate limits in D1's `rate_limit`.** A sender gets 20 requests an hour, and 3 in 30 days to the same person, so asking again after each decline can't become a stream (`FRIEND_REQUEST_LIMITS`). Keys are HMACs of the user ids under the auth secret (`keyedHash`), never an email or address. A request spends a slot of each only when both have one; past either it answers 429.
7. **Report on a profile page.** `POST /@<handle>/report/`, from Farty's own origin, keeps a `profile_reports` row (the user and when, nothing about who reported) and a `profile_reported` log line, for a Handle or a page that needs looking at. It spends the same reporter and site slots as a shared Recording's Report (`REPORT_LIMITS`), and a page gets 5 a day. Your own page has no Report.
8. **Deleting an account deletes its requests, friendships and reports** (`on delete cascade`).

## Tables

Migration `0010_friends`:

- `friend_requests`: `from_user_id`, `to_user_id` (the primary key, each on delete cascade), `created_at`. One per pair and direction, never to yourself.
- `friends`: `user_id`, `friend_id` (the primary key, each on delete cascade), `created_at`. Two rows per friendship, one each way, written and removed together in one batch.
- `profile_reports`: `id`, `user_id` (on delete cascade, indexed for it), `created_at`.

## Considered

- **One row per friendship, the pair in order.** Every read would need `OR` or a `UNION`. Two rows keep each list one indexed lookup.
- **Profile reports in `share_reports`.** Its `share_id` and `item_id` are required: a report of a page names neither.
- **Friends-only profile pages.** #315 has the page public, listing only what was shared, like the links on it.
- **A request without the sender's Handle.** The person asked would see no one.

## Consequences

- Sharing a Recording or a Toot puts it on your page. The privacy page says so.
- A page can be emptied, not taken down: the owner takes down each of its shares (`docs/agents/web.md`, Reports and take-downs), and the page then lists nothing. Taking away a Handle waits for a moderation screen, with changing one (ADR 0020).

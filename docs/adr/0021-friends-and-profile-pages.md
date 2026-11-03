# Friends and profile pages

#315 asked for "a 'add friends' simple social networky type of thing", and its design log settled a profile page and Friends in Profile ([#profile-page](https://claude.ai/artifact/HiXtmuCaCbkGJEWh4QLBRP#profile-page), [#friends](https://claude.ai/artifact/HiXtmuCaCbkGJEWh4QLBRP#friends)). #319 builds them on sharing (ADR 0020). The owner was away and asked not to be a blocker, so the issue and the prototype stand as approved (epic #311).

1. **A profile page, `/u/<handle>/`, lists what its user shares.**
   - Anyone can open it, signed in or not: the Handle, the friend control, and each Recording shared now, newest first by when it was shared. Each row plays in place, as the shared page does, and opens that shared page.
   - It lists only a live share of a live Recording of a live account, read from D1 on every request (`findProfile()` in `src/server/profiles.ts`): a share stopped or taken down, a deleted Recording and a deleted account drop off at once. Shared Toots join it with #317.
   - So ADR 0020's links are no longer listed nowhere: a user's page lists them. Search engines are still asked not to index the page (`noindex, nofollow`, no canonical, not in the sitemaps), it's `private, no-cache`, and the service worker leaves `/u/` alone.
   - No counts, no feed, no likes, comments or messages (#315).
   - A Handle no one has answers the shared page's 404, "This link doesn't work any more."
2. **The friend control has five states.** Add friend; Requested, which can be cancelled; their request, with Accept and Decline; Friends, which can be removed; and on your own page, a note that it lists only what you've shared. Signed out, Add friend opens `/` until #318 makes it Get Farty with the friend offer.
3. **Friends in Profile, under Stats.** "Friend requests" shows only when someone asked, with Accept and Decline. "Friends" lists friends, each opening their page, and the requests you've sent; ⋯ removes a friend or cancels a request, and removing asks first ("@maya isn't told"). "Add friend" takes a Handle. Account's Handle row becomes "Your page".
4. **A request needs the sender's Handle.** The first request asks for one, with the dialog the first share uses, because the person asked sees only a Handle. `POST /api/friends/` answers 409 `no_handle` without one, so #318's sign-up picks a Handle before it sends its request.
5. **Every route acts only for the signed-in user.** `/api/friends/` (the lists; send a request by Handle) and `/api/friends/<handle>/` (the state; accept, decline, cancel or remove) are `userRoute`s, and each names only the other user: accept and decline act on that user's request to you, cancel on yours to them, remove on your friendship. So no one can act on a request or friendship that isn't theirs. A request to a Handle no one has (404), to yourself (400), or a second one (409) is refused. Asking someone who already asked you accepts their request. `requestFriend()` in `src/server/friends.ts` is the one way to send a request, for #318 too.
6. **Rate limits in D1's `rate_limit`.** A sender gets 20 requests an hour, and 3 in 30 days to the same person, so asking again after each decline can't become a stream (`FRIEND_REQUEST_LIMITS`). Keys are HMACs of the user ids under the auth secret (`keyedHash`), never an email or address. A request spends a slot of each only when both have one; past either it answers 429.
7. **Report on a profile page.** `POST /u/<handle>/report/`, from Farty's own origin, keeps a `profile_reports` row (the user and when, nothing about who reported) and a `profile_reported` log line, for a Handle or a page that needs looking at. It spends the same reporter and site slots as a shared Recording's Report (`REPORT_LIMITS`), and a page gets 5 a day. Your own page has no Report.
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

- Sharing a Recording puts it on your page. The privacy page says so.
- A page can be emptied, not taken down: the owner takes down each of its shares (`docs/agents/web.md`, Reports and take-downs), and the page then lists nothing. Taking away a Handle waits for a moderation screen, with changing one (ADR 0020).

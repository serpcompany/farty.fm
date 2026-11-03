# Friends and profile pages

A Profile Page, `/u/<handle>/`, shows what one person shares, to anyone. Friends ask each other by
Handle, and Profile lists them. Not Profile, the tab, which is the person's own account; that is in
[Profile](profile.md). Why it works this way is in
[ADR 0021](../../../../docs/adr/0021-friends-and-profile-pages.md); sharing is in
[Sharing](sharing.md).

## A profile page

- Anyone can open it, signed in or not: the Handle as its heading, the friend control, and
  everything its user shares now, Recordings and Toots together, newest shared first. With nothing
  shared it says "Nothing shared yet." (`e2e/friends.spec.ts`, "a friend request sent from a
  profile page is accepted in Profile, then removed"; `e2e/share-toot.spec.ts`, "a signed-in user
  shares a saved Toot, someone signed out plays it, and Stop sharing takes the link down";
  `src/app/u/profiles.workers.test.ts`, "lists the Recordings its user shares, newest first, with
  nothing private"; "lists the Toots its user shares with the Recordings, newest first, with nothing
  private (#346)").
- Each row has the item's name, then what it is: "Recording · E3 · Today", or "Toot · " and its Song
  ("Sound Pad" for a Sound Pad Toot), with the day in the viewer's own time. A row opens the item's
  shared page, and its play button plays it in place from that link's audio
  (`src/components/farty/profile-page.interaction.test.tsx`, "says it's a Toot and its Song, opens
  its own page and plays its own audio"; `e2e/share-toot.spec.ts`, "a signed-in user shares a saved
  Toot, someone signed out plays it, and Stop sharing takes the link down").
- It lists only what still works as a link: a share stopped or taken down, a deleted Recording or
  Toot, and a Toot that plays a taken-down Recording drop off at once, and the Toot comes back with
  the Recording (`e2e/share-toot.spec.ts`, "a signed-in user shares a saved Toot, someone signed out
  plays it, and Stop sharing takes the link down"; `src/app/u/profiles.workers.test.ts`, "leaves out
  what was stopped, taken down or deleted, and what others share"; "leaves out the Toots others share
  (#346)"; "leaves out a Toot that was never shared, stopped, deleted or taken down (#346)"; "leaves
  out a Toot that plays a taken-down Recording, until it is back (#346)").
- The Handle in the address reads in any case. A Handle no one has, or a deleted account's, is not
  found, like a link that stopped working (`src/app/u/profiles.workers.test.ts`, "is found by its
  Handle in any case, and is there with nothing shared"; "is not found for a Handle no one has, one
  that could be no one's, or a deleted account").
- It is unlisted like a shared page: search engines are asked not to index it, and nothing keeps a
  copy (`e2e/friends.spec.ts`, "a friend request sent from a profile page is accepted in Profile,
  then removed").
- Someone else's page has Report. A report names the person reported, never who reported, is taken
  only from Farty's own pages, and spends the same reporter's and site's allowance as a shared
  link's; a page takes a few a day. Reports go with the account (`src/app/u/profiles.workers.test.ts`,
  "keeps a row naming the user, not the reporter"; "is refused from another site, or with no origin,
  and for a Handle no one has"; "keeps a few a day per page, and answers 429 past them"; "spends the
  same reporter and site slots as a shared Recording's Report"; "goes with the account").

## The friend control

- Signed out, Add friend is Get Farty, with that person offered as a friend
  ([Get Farty](get-farty.md#on-a-phone); `e2e/get-farty.spec.ts`, "signed out, a profile page's Add
  friend is Get Farty, and the request reaches the server").
- Signed in, Add friend sends a request and then says Requested. Someone with no Handle picks one
  first, with Add friend as the dialog's button, since the person asked sees them only by it
  (`e2e/friends.spec.ts`, "a friend request sent from a profile page is accepted in Profile, then
  removed"; `src/app/api/friends/friends.workers.test.ts`, "asks the user with that Handle, who sees
  who asked"; "needs a Handle of your own first, since whoever you ask sees you by it").
- Once the request is accepted it says Friends, and once they're removed, Add friend again
  (`e2e/friends.spec.ts`, "a friend request sent from a profile page is accepted in Profile, then
  removed").
- Asking someone who already asked you accepts their request, and two people asking each other at
  once end as friends (`src/app/api/friends/friends.workers.test.ts`, "accepts their request when
  they asked first"; "end as friends when they ask at once"; "can't leave a request each way: the
  second insert sees the first").
- A request is refused to a Handle no one has, to one's own Handle, twice to the same person, and
  to a friend (`src/app/api/friends/friends.workers.test.ts`, "refuses a Handle no one has, and one
  that could be no one's"; "refuses your own Handle"; "refuses asking twice, and asking a friend").
- When the friend state can't be read, or the server refuses the session, it says "Can't reach your
  friends right now." with Retry, which reads it again
  (`src/components/farty/profile-page.interaction.test.tsx`, "says so with Retry, and Retry reads
  it again"; "says so when the server refuses the session").

## Friends in Profile

- Signed in, Profile has Friend requests, only while someone has asked, each with Accept and
  Decline, and Friends, each opening their page. Accepting makes them friends both ways, and the
  request goes (`e2e/friends.spec.ts`, "a friend request sent from a profile page is accepted in
  Profile, then removed"; `src/app/api/friends/friends.workers.test.ts`, "makes friends both ways
  when accepted, and clears the request").
- Declining tells no one, and they can ask again. A request can be cancelled by the one who sent it
  (`src/app/api/friends/friends.workers.test.ts`, "tells no one when declined: the request is gone,
  and they can ask again"; "can be cancelled by its sender").
- A friend's ⋯ menu has Remove friend, which asks first, "Remove @sam?". It ends the friendship for
  both, and they aren't told. With none left, Friends says "No friends yet. Add one by their handle,
  or from their page." (`e2e/friends.spec.ts`, "a friend request sent from a profile page is
  accepted in Profile, then removed"; `src/app/api/friends/friends.workers.test.ts`, "ends the
  friendship for both, and tells no one").
- With a Handle, Account links to the person's own page, "Your page" (`e2e/friends.spec.ts`, "a
  friend request sent from a profile page is accepted in Profile, then removed";
  `src/components/farty/profile-screen.interaction.test.tsx`, "links to the account's own page once
  it has a handle").
- Add friend in Profile takes a Handle as typed: with the @, in capitals, with spaces
  (`src/app/api/friends/friends.workers.test.ts`, "takes the Handle as typed: an @, capitals and
  spaces").
- The lists put the newest first, and leave out anyone whose account is gone
  (`src/app/api/friends/friends.workers.test.ts`, "put the newest first"; "leave out anyone in them
  whose account is gone").

## Limits and privacy

- A person sends a few requests an hour, and a few in 30 days to the same person, so asking again
  after a decline can't become a stream. A refused request spends nothing
  (`src/app/api/friends/friends.workers.test.ts`, "keeps a few to the same person, so a decline
  can't start a stream"; "keeps a few an hour per sender, keyed by an HMAC, and a refused one
  spends nothing"; "keeps the same-person limit for 30 days, not one").
- Every action is between the signed-in person and the Handle they name: no one accepts, declines,
  cancels or removes a request or friendship between two others, and another account's library
  reads none of it (`src/app/api/friends/friends.workers.test.ts`, "can't be accepted, declined,
  cancelled or removed by anyone else"; "isn't read by another account's library"; "is refused from
  another site, or as another account's library").
- Deleting an account deletes its requests, both ways, and its friendships
  (`src/app/api/friends/friends.workers.test.ts`, "deletes its requests either way and its
  friendships").

## Not checked

- A profile page has no counts and no feed, and, like a shared page, its own top bar with Get Farty
  and no tabs. On a person's own page the friend control says "This is
  your page. It lists only what you've shared.", and there is no Report.
- On a profile page: Requested's menu cancels the request, their request shows "@maya wants to be
  friends." with Accept and Decline, Friends' menu removes them after asking, and while it reads the
  control keeps its height.
- What a refused request says: "No one on Farty has the handle @carol.", "That's your own
  handle.", "You already asked @bob.", "You're already friends with @bob.", "Too many friend
  requests right now. Try again later."
- Profile's Add friend dialog ("Add a friend", "Their handle", Send request), Decline and cancelling
  a sent request from Profile, and Report on a profile page in the browser.

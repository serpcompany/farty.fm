# Sharing

A signed-in person shares a Recording or a saved Toot by an unlisted link: anyone with the link
opens it and plays it, signed in or not. Nothing lists the link but its owner's
[profile page](friends.md#a-profile-page). Why it works this way is in
[ADR 0020](../../../../docs/adr/0020-sharing-by-unlisted-link.md). A shared page's Get Farty is in
[Get Farty](get-farty.md).

## Share

- Share is on a Recording's row, at the top of Result once the take is saved (not on the review
  before Save, since the take isn't a Recording yet), in a saved Toot's header and in its row's ⋯
  menu (`e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed out
  plays it, and Stop sharing takes the link down"; "a guest records, reviews and saves, then shares
  from Result once they've made an account, and someone signed out plays it (#320)";
  `e2e/share-toot.spec.ts`, "a signed-in user shares a saved Toot, someone signed out plays it, and
  Stop sharing takes the link down"; `src/components/farty/take-review.interaction.test.tsx`,
  "offers Share once the take is saved, and a guest makes an account first (#320)").
- Only what has reached the account shares: a Recording once uploaded, a Toot once saved, and only
  the person's own. Anything else is refused (`src/app/u/recording-sharing.workers.test.ts`, "needs
  a Handle and an uploaded Recording of your own"; `src/app/u/toot-sharing.workers.test.ts`, "needs
  a Handle and a saved Toot of your own"). A Sound Pad Toot shares like a Song's
  (`src/app/u/toot-sharing.workers.test.ts`, "shares a Sound Pad Toot too").
- The link goes to the phone's share sheet, titled "Recording 1 by @maya" or the Toot's title by
  its Handle (`e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed
  out plays it, and Stop sharing takes the link down"; `e2e/share-toot.spec.ts`, "a signed-in user
  shares a saved Toot, someone signed out plays it, and Stop sharing takes the link down").
- A shared Recording's row says "Shared", and a shared Toot's screen says it under the title, after
  its Song. Their Share then offers Share link, which gives the same link again, and Stop sharing
  (`e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed out plays
  it, and Stop sharing takes the link down"; `e2e/share-toot.spec.ts`, "a signed-in user shares a
  saved Toot, someone signed out plays it, and Stop sharing takes the link down";
  `src/app/u/sharing.workers.test.ts`, "makes a link anyone can play, whole and as stored, and the
  same link again").
- A Toot that can't play in this browser has nothing to share, but once shared (from another
  device, say) its link plays from the account, so Share link and Stop sharing stay in its row's
  menu and its screen's header (`src/components/farty/toot-share.interaction.test.tsx`, "keeps
  Share link and Stop sharing in its row's menu once shared, and no Share before"; "keeps Share in
  its header once shared, and none before").

## Pick a handle

- The first share asks for a Handle: "Pick a handle", filled in from the email when that Handle is
  free, and checked as it's typed: "@maya is free", "@gus is taken. Try another.", "@farty isn't
  allowed. Try another." or "Use at least 3 characters.". Share waits, disabled, for one that can be
  used (`e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed out
  plays it, and Stop sharing takes the link down"; `src/app/u/sharing.workers.test.ts`, "suggests
  one from the email, and checks each as it is typed"; `src/lib/handle.test.ts`, "are suggested
  from the email, padded or cut to fit"; "say what is wrong, as the prototype does").
- A Handle is 3 to 20 letters, digits or `_`, typed with or without the @, in any case. It can't
  pass for Farty or one of its pages, hold Farty's own name or a staff word, or hold a slur, digits
  for letters included (`src/lib/handle.test.ts`, "are typed with or without the @, in any case";
  "are 3 to 20 letters, digits or _"; "can't pass for Farty or one of its pages"; "can't hold
  Farty's own name anywhere, or a staff word as a word of its own"; "can't hold a slur, even with
  digits for letters, but fart words and lookalikes are fine").
- It is picked once, and no one else can have it; it can't be changed (`src/app/u/sharing.workers.test.ts`,
  "is picked once, unique, and never one on the block list"; "is refused from another site, and to
  someone signed out"). Profile shows it ([Friends](friends.md#friends-in-profile);
  `e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed out plays
  it, and Stop sharing takes the link down").
- Adding a friend without a Handle asks for one the same way ([Friends](friends.md)).

## A guest

- A guest who taps Share gets the account step, reworded: "Make a free account", "You need one to
  share. It keeps your farts too." Not now closes it and shares nothing
  (`e2e/share-recording.spec.ts`, "a guest who taps Share is asked to make a free account first";
  `src/components/farty/account-step.interaction.test.tsx`, "asks a guest who shares for a free
  account, which keeps their farts too").
- Once they sign in there, Share carries on: Pick a handle, then the share sheet
  (`e2e/share-recording.spec.ts`, "a guest records, reviews and saves, then shares from Result once
  they've made an account, and someone signed out plays it (#320)").

## Stop sharing, and deleting

- Stop sharing asks first, "Stop sharing Recording 1?": the link stops working for everyone who has
  it, and sharing again makes a new link, while the old one stays gone (`e2e/share-recording.spec.ts`,
  "a signed-in user shares a Recording, someone signed out plays it, and Stop sharing takes the
  link down"; `e2e/share-toot.spec.ts`, "a signed-in user shares a saved Toot, someone signed out
  plays it, and Stop sharing takes the link down"; `src/app/u/sharing.workers.test.ts`, "stops
  working when its owner stops sharing it, and a new share is a new link").
- Deleting a shared Toot says "Its link stops working too. This can't be undone.", and its link
  stops working, as a deleted Recording's does (`e2e/share-toot.spec.ts`, "a signed-in user shares a
  saved Toot, someone signed out plays it, and Stop sharing takes the link down";
  `e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed out plays it,
  and Stop sharing takes the link down"; `src/app/u/sharing.workers.test.ts`, "stops working when
  it is deleted").
- Deleting the account stops every link it shared ([Accounts](account.md#signed-in-on-profile);
  `src/app/u/sharing.workers.test.ts`, "stops working when the account is deleted").
- Only the owner shares or stops sharing an item (`src/app/u/sharing.workers.test.ts`, "can't be
  shared or stopped by anyone but its owner").

## The shared page

- A Recording's link is `/u/<handle>/r/<id>/` and a Toot's `/u/<handle>/t/<id>/`. The id is 12
  random characters, never the item's own, and a link opens only under its own kind
  (`src/app/u/sharing.workers.test.ts`, "makes a link anyone can play, whole and as stored, and the
  same link again"; `src/app/u/toot-sharing.workers.test.ts`, "lists Recordings and Toots, each
  opening only under its own kind of link"). The Handle in it reads in any case
  (`src/app/u/recording-sharing.workers.test.ts`, "shows the page only the Recording, with the link
  as its id").
- A Recording's page: "@maya shared a Recording", its name, its note, a big waveform and Play. A
  Toot's: "@maya shared a Toot", its title, its Song ("Sound Pad" for a Sound Pad Toot) and its
  length (`e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed out
  plays it, and Stop sharing takes the link down"; `e2e/share-toot.spec.ts`, "a signed-in user
  shares a saved Toot, someone signed out plays it, and Stop sharing takes the link down";
  `src/app/u/toot-sharing.workers.test.ts`, "shows the page only the Toot's title, Song and length,
  under its owner's Handle"; "shares a Sound Pad Toot too").
- Nothing private reaches it, in the page or its data: not the item's id, the account's id or the
  owner's email (`e2e/share-toot.spec.ts`, "a signed-in user shares a saved Toot, someone signed out
  plays it, and Stop sharing takes the link down"; `src/app/u/recording-sharing.workers.test.ts`,
  "shows the page only the Recording, with the link as its id";
  `src/app/u/toot-sharing.workers.test.ts`, "shows the page only the Toot's title, Song and length,
  under its owner's Handle").
- It has no tabs: its own top bar has Farty and Get Farty, and signed out Get Farty sits under the
  player too. Signed in, the top bar says Open Farty ([Get Farty](get-farty.md);
  `e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed out plays it,
  and Stop sharing takes the link down"; `e2e/get-farty.spec.ts`, "Get Farty on a shared page makes
  an account, asks the sharer to be friends, then shows the Home Screen steps").
- A Recording plays what its row plays: its Trim, or else the whole take. The audio trimmed off is
  never served, before analysis or after it finds a pitch, and a changed Trim serves the new cut
  (`src/app/u/recording-sharing.workers.test.ts`, "serves only the Trim, never the audio trimmed
  off"; "serves the new cut once the Trim changes, not the cached one"; "serves only a stored Trim,
  even before analysis or once analysis finds a pitch"; "serves the whole take of a Recording with
  no stored Trim"). A Toot plays its saved audio, byte for byte, with bars drawn from it
  (`e2e/share-toot.spec.ts`, "a signed-in user shares a saved Toot, someone signed out plays it, and
  Stop sharing takes the link down"; `src/app/u/toot-sharing.workers.test.ts`, "draws its bars from
  the saved WAV, kept in the cache by its R2 key").
- Nothing keeps a copy: the page and its audio are `private, no-cache`, so each play asks Farty
  again, and a browser that has the audio gets a 304 (`e2e/share-recording.spec.ts`, "a signed-in
  user shares a Recording, someone signed out plays it, and Stop sharing takes the link down";
  `src/app/u/sharing.workers.test.ts`, "serves the audio from the cache, and answers 304 to a
  browser that has it"). The service worker never handles a shared page, and the page loads no
  Song Catalog (`src/lib/service-worker.test.ts`, "leaves the Fixture Library, audio, data, other
  sites and writes to the network"; `src/components/farty/song-catalog-provider.interaction.test.tsx`,
  "doesn't fetch the Song Catalog on a shared Recording's public page").
- It is unlisted: search engines are asked not to index it (`e2e/share-recording.spec.ts`, "a
  signed-in user shares a Recording, someone signed out plays it, and Stop sharing takes the link
  down").

## Link previews

- Messages, WhatsApp and the like show the link's title, "Recording 1 by @maya", and a large image
  drawn for it, a 1200×630 PNG kept nowhere (`private, no-cache`). A Toot's description is "<Song>,
  played on farts. Tap to play." (`e2e/share-recording.spec.ts`, "a signed-in user shares a
  Recording, someone signed out plays it, and Stop sharing takes the link down";
  `e2e/share-toot.spec.ts`, "a signed-in user shares a saved Toot, someone signed out plays it, and
  Stop sharing takes the link down").
- A link that stops working takes its image with it (`e2e/share-recording.spec.ts`, "a signed-in
  user shares a Recording, someone signed out plays it, and Stop sharing takes the link down").

## Report

- Every shared page has Report, which asks "Report this Recording?" or "Report this Toot?", then
  says "Reported. Thanks." (`e2e/share-recording.spec.ts`, "a signed-in user shares a Recording,
  someone signed out plays it, and Stop sharing takes the link down"; `e2e/share-toot.spec.ts`, "a
  signed-in user shares a saved Toot, someone signed out plays it, and Stop sharing takes the link
  down").
- A report names the link and the item, never who reported it, and is taken only from Farty's own
  pages (`src/app/u/share-reports.workers.test.ts`, "keeps a row naming the share and the item, not
  the reporter"; "is refused from another site, or with no origin").
- A Recording or Toot takes a few reports a day, which sharing it again under a new link doesn't
  start over; a reporter a few an hour, so one can't spend the site's; and the site a cap of its
  own, Recordings and Toots counted together. Past any of them a report is refused
  (`src/app/u/share-reports.workers.test.ts`, "keeps a few reports a day per item, and answers 429
  past them"; "doesn't start an item's reports over when it's shared again under a new link";
  "keeps a few reports an hour per reporter, so one client cannot spend the site"; "answers 429
  when the site has had too many, and spends no link's or reporter's slot"; "spends the same
  reporter's and site's slots as a Recording's report"). Reports go with the owner's account
  (`src/app/u/share-reports.workers.test.ts`, "goes with the account").

## A link that stops working

How Farty takes a reported link down is in
[Sharing, friends and reports](../../../../docs/agents/sharing.md#reports-and-take-downs).

- Stopped, deleted, its account deleted, taken down after a report, or never shared: each answers
  404 at once, alike, with "This link doesn't work any more" and Get Farty. Its image, its audio and
  its Report go too (`e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone
  signed out plays it, and Stop sharing takes the link down"; `e2e/share-toot.spec.ts`, "a signed-in
  user shares a saved Toot, someone signed out plays it, and Stop sharing takes the link down";
  `src/app/u/sharing.workers.test.ts`, "stops working when it is deleted"; "stops working when the
  account is deleted"; "never opens a link nobody shared").
- A link Farty took down stays down: its owner can't share that Recording or Toot again
  (`src/app/u/sharing.workers.test.ts`, "stays down once Farty takes it down, even if its owner
  shares it again").
- A Toot that plays a taken-down Recording, in its Arrangement or its Sound Pad Performance, is down
  too and can't be shared, so its audio never carries that Recording back out. A Toot whose own
  Recordings are up still shares (`src/app/u/toot-sharing.workers.test.ts`, "stays down while a
  Recording it plays is taken down, and never shares again"; "shares a Toot whose Recordings are
  up, though another Recording is down").

## Not checked

- Where there's no share sheet, Share copies the link and says "Link copied". When the browser
  won't open the share sheet without a fresh tap, "Your link is ready" offers Share link from that
  tap.
- What Share says when it can't: "This Recording hasn't reached your account yet. Try again in a
  moment.", "This Recording was taken down after a report, so it can't be shared.", or "Couldn't
  share. Check your connection and try again."
- A shared Recording's Delete says "Its link stops working too." as a Toot's does.
- A Recording's link description ("A G3 fart on Farty. Tap to play.") and a Sound Pad Toot's ("A fart
  song on Farty. Tap to play."), and what the link image draws: Farty, the note, the name, who
  shared it and the bars.
- The shared page's More from @handle, which opens the owner's profile page; leaving the page stops
  what plays; it has no canonical and no sitemap lists it; "Too many reports right now. Try again
  later." past the limits.

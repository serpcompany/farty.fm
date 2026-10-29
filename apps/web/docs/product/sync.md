# Sync

How a signed-in browser's Recordings and Toots reach the account and every other browser signed in
to it, and what happens when the account is full. Signing in and out is in [Accounts](account.md),
and how the sync works in [ARCHITECTURE.md](../../../../ARCHITECTURE.md#how-data-moves-in-the-web-app).

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
  uploads race (409)"). One past them stays only on this device, waiting for room, and Recordings
  and Toots say so ([Recordings](recordings.md#a-full-account), [Toots](toots.md#a-full-account);
  `src/lib/outbox-send.test.ts`, "keeps a Recording the account has no room for on this device,
  waiting to upload"; "remembers on the upload that the account is full, for that kind only").
- With no room for a kind, none of it uploads again until there may be room: a delete of that kind
  sent from here, which uploads what waits in the same sync; a read showing another browser's
  delete; or a new session or Farty opening, which tries one first. The other kind still uploads
  (`src/lib/outbox-send.test.ts`, "uploads none of that kind again until there may be room, and
  still uploads the other kind"; "uploads what waits for room once a delete sent from here makes
  room, in the same sync"; "uploads what waits for room once a read shows another browser's
  delete"; "tries once more in a new session or when Farty opens again, with one upload while still
  full"; `e2e/account-full.spec.ts`, "a full account keeps a new Recording on this device and
  says so, without uploading it again, then uploads it once a delete makes room").

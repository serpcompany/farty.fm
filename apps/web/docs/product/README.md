# Product

What a person sees and can do in Farty's web app, area by area, with each state and the check that
proves each behavior. Terms are as [CONTEXT.md](../../../../CONTEXT.md) defines them, and how the
parts work is in [ARCHITECTURE.md](../../../../ARCHITECTURE.md).

A check is an e2e journey (`e2e/<file>.spec.ts` and the test's title) or a unit or interaction test
(`src/.../<file>.test.ts` and its title), with paths relative to `apps/web/`. A parameterized title
is quoted as the code writes it. A behavior nothing checks is under its page's Not checked heading.
The journeys run at phone, touch tablet and computer size (`playwright.config.ts`).

- [App shell](app-shell.md): the tabs, coming back to Farty, other tabs, a library that won't open,
  a broken screen, a new deploy, the pages outside the tabs, and where Staging differs.
- [First visit](first-visit.md): Welcome on a phone, the lander on a touch tablet, and the product
  page on a computer.
- [Record](record.md): the microphone, getting it ready, the red Recording screen and its live
  waveform, quiet takes, a take that fails, finding the note, and the Result.
- [Review](review.md): one review for every take, after Stop or from a Recording's pencil: its Trim,
  its note on the piano keys or No note, its name, and saving.
- [Recordings](recordings.md): the list, the note each plays in Songs, playing, the playhead and
  scrubbing, analysis, Retry and Re-scan, deleting, and sync.
- [Compose](compose.md): every Song in the catalog, Unlocked and Locked Songs, what a locked Song
  needs, Favorite Songs, search and sort, and a catalog that didn't load.
- [Song Creator](song-creator.md): making a Toot, playing it note by note, and saving it.
- [Sound Pad](sound-pad.md): twelve Pads that play your Recordings at a tap, Edit and the chooser,
  recording a take, its Toot, saving it, and a take kept across Checkout and the next open.
- [Toots](toots.md): the list, a Toot's screen, a Sound Pad Toot, renaming, deleting, and how long a
  guest's Toots last.
- [Sharing](sharing.md): sharing a Recording or a saved Toot by link, Pick a handle, Stop sharing,
  the shared page, its link preview, Report, and links that stop working.
- [Friends and profile pages](friends.md): a profile page at `/u/<handle>/`, the friend control,
  Friends in Profile, and the limits on requests.
- [Get Farty](get-farty.md): a shared or profile page's way in: on a phone, the account step with
  the friend offer, then the Home Screen steps; on a computer, the QR code.
- [Profile](profile.md): stats, the account section, Friends, the Fixture Library on Staging, the
  install guide, the error-report switch, and About.
- [Accounts](account.md): what a guest keeps, the account step and its Turnstile check, signing in,
  a session that ends, signing out, and deleting an account.
- [Sync](sync.md): every signed-in browser sharing the farts, their notes, Trims and names, the
  Favorite Songs, and a full account.
- [Paying to save a Toot](payments.md): where saving is paid, a guest's Save, the checkout and the
  return, for a Song's Toot and a Sound Pad Toot.
- [Installing and offline](install.md): the install offer, Profile's guide, the manifest, what
  works offline, and keeping the browser's storage.

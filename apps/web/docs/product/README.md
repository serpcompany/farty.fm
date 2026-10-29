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
- [Record](record.md): the microphone, a take, Review, finding the note, and the Result.
- [Recordings](recordings.md): the list, playing, analysis and Retry, deleting, and sync.
- [Compose](compose.md): Unlocked and Locked Songs, what a locked Song needs, search and sort.
- [Song Creator](song-creator.md): making a Toot, playing it note by note, and saving it.
- [Toots](toots.md): the list, a Toot's screen, renaming, deleting, and how long a guest's Toots
  last.
- [Profile](profile.md): stats, the account section, the Fixture Library on Staging, the install
  guide, the error-report switch, and About.
- [Accounts](account.md): what a guest keeps, the account step and its Turnstile check, signing in,
  a session that ends, signing out, and deleting an account.
- [Sync](sync.md): every signed-in browser sharing the farts, placements by ear, and a full account.
- [Paying to save a Toot](payments.md): where saving is paid, a guest's Save, the checkout and the
  return.
- [Installing and offline](install.md): the install offer, Profile's guide, the manifest, what
  works offline, and keeping the browser's storage.

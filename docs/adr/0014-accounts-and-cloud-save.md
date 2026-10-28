# Accounts and cloud save

ADRs 0001 and 0007 kept Recordings and Toots in one browser, with no accounts and no cloud library. Once Farty became a web app, a person's library living only in one browser's storage became the bigger risk: clearing site data or changing phones lost everything. On 2026-10-21 the product owner chose an account step after the first save (#150): "i think this is a good place for a 'create an account' (collect emails etc) gate --- so people can create a profile, save their stuff, etc."

1. **Trying Farty needs no account.** A person records and reaches the song matching screen first; the account step comes after their first save (#155). A guest keeps their Recordings in the browser, and their Toots last only the visit (#203).
2. **An account is an email and a code.** Better Auth email codes on the site's own D1, through Drizzle, with no password and no age check. How sign-in works and its limits are in [Accounts and sign-in](../agents/accounts.md).
3. **A signed-in library lives in the cloud.** Recordings and Toots are kept in D1, and their audio in R2, per environment. The browser's IndexedDB stays the working copy, and an outbox syncs it with the account (#156). Deleting the account deletes all of it.
4. **Email** to an account includes Farty news by default (#150, the owner's call); the privacy page says so, and Profile turns it off.

This supersedes ADR 0001's "no accounts" and ADR 0007's "no accounts, no cloud libraries, no sync". The rest of both stands. Paying to save a Toot (ADR 0010) builds on these accounts.

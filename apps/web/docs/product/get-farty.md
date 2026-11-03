# Get Farty

Get Farty, on a shared link's page and a profile page, is how someone who was sent a link gets
Farty: on a phone, a free account that asks the sharer to be friends, then the Home Screen steps;
on a computer, the QR code. Shared pages are in [Sharing](sharing.md), profile pages in
[Friends](friends.md).

## On a phone

- Signed out, Get Farty sits in the page's top bar and under the player. Either opens the account
  step: "Make a free account", "It keeps your farts. Then add Farty to your Home Screen.", with "Add
  @maya as a friend" ticked for whoever's page it is, a full-size tap target
  (`e2e/get-farty.spec.ts`, "Get Farty on a shared page makes an account, asks the sharer to be
  friends, then shows the Home Screen steps"; `src/components/farty/get-farty.interaction.test.tsx`,
  "offers whoever shared the page, ticked, and asks them once signed in").
- A shared page has no app top bar, so the step covers the whole page, its own top bar too
  (`src/components/farty/account-step.interaction.test.tsx`, "covers all of a shared page, which
  has no app top bar to leave room for"; `e2e/get-farty.spec.ts`, "signed out, a profile page's Add
  friend is Get Farty, and the request reaches the server").
- Signed in there with it ticked, someone with no Handle picks one first, then the request goes,
  and "Get the app" says "You asked @maya to be friends." above the Home Screen steps, with focus on
  its heading. Done closes it, and the top bar says Open Farty (`e2e/get-farty.spec.ts`, "Get Farty
  on a shared page makes an account, asks the sharer to be friends, then shows the Home Screen
  steps"; `src/components/farty/get-farty.interaction.test.tsx`, "offers whoever shared the page,
  ticked, and asks them once signed in").
- Unticked, no request goes and no Handle is asked for, and the Home Screen steps still show. Not
  now goes on to them too, asking no one (`e2e/get-farty.spec.ts`, "Get Farty on a shared page
  makes an account, asks the sharer to be friends, then shows the Home Screen steps";
  `src/components/farty/get-farty.interaction.test.tsx`, "unticked, asks no one, and still shows
  the Home Screen steps"; "goes on to the Home Screen steps after Not now, asking no one").
- A profile page's Add friend, signed out, is the same flow, at phone and tablet size; once the
  request goes the page says Requested (`e2e/get-farty.spec.ts`, "signed out, a profile page's Add
  friend is Get Farty, and the request reaches the server").
- It belongs to the page that started it: on any other page it ends, so a request never goes to
  someone from an earlier page, and a later page's Get Farty offers its own person
  (`src/components/farty/get-farty.interaction.test.tsx`, "ends on another page, so the request
  never goes to an earlier friend"; "offers the person whose page started it, not an earlier
  one's").
- A reload carries on, as when a phone drops the tab while the person reads the code in Mail: a
  request still to go is sent once the session is read, and offline it waits until the browser is
  back online (`src/components/farty/get-farty.interaction.test.tsx`, "sends a request still to go
  after a reload, once the session is read"; "keeps a request still to go after a reload offline,
  and sends it once back online").
- A tap made before the session was read, which then reads signed in, has no account to make: the
  flow ends and nothing is sent (`src/components/farty/get-farty.interaction.test.tsx`, "sends
  nothing for a tap before the session is read, when it reads signed in").
- When the request can't reach Farty, "Get the app" says "Couldn't send the request." with Try
  again, which sends it again (`src/components/farty/get-farty.interaction.test.tsx`, "offers Try
  again when the request fails, which sends it again").
- The request goes only as the person who just signed up, once they have a Handle, and only once
  however often a reload sends it. It is refused for a sharer whose account has gone, and for the
  person's own Handle (`src/app/api/friends/friends.workers.test.ts`, "asks once the new account has
  picked a Handle"; "is sent only as the signed-in user: a sender in the body is ignored"; "sends
  nothing signed out"; "is refused for a sharer who has since gone, and for the new account's own
  Handle"; "is harmless sent twice, as after a reload: still one request").

## On a computer

- Get Farty, in the top bar or under the player, shows the QR code, "Scan to open Farty on your
  phone", and no account step, even on a link that no longer works. Escape closes it and gives
  focus back ([First visit](first-visit.md#the-product-page-on-a-computer); `e2e/desktop.spec.ts`,
  "a shared page's Get Farty shows the QR code, not the account step (#318)";
  `src/components/farty/get-farty.interaction.test.tsx`, "shows the QR code, and no account
  step").

## Not checked

- On the person's own page, or for a Handle they didn't pick, the Home Screen step says nothing
  about a friend request. A reload that finds the session gone sends nothing.

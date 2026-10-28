# First visit

What a person sees the first time they open Farty, by device: Welcome on a phone, the lander on a
touch tablet, and the product page on a computer. A phone is narrower than 768px. From 768px, a
device with a mouse or trackpad is a computer and one without is a touch tablet
(`src/lib/desktop.test.ts`, "globals.css's desktop variant is the same query the scripts match").

## Welcome, on a phone

- A browser that has never opened Farty gets Welcome over whichever tab it opens: "Farty",
  "Record your farts. Turn them into songs.", three lines (one fart per Recording, each fart has a
  note, collect notes to unlock Songs), Allow microphone and Not now
  (`src/components/farty/welcome-provider.interaction.test.tsx`, "shows Welcome in a browser that
  has never opened Farty"; `e2e/lander.spec.ts`, "a phone gets Welcome, not the lander, and
  downloads none of its images").
- Allow microphone asks for the microphone, then closes Welcome. The microphone stays open, so the
  first tap on Record captures at once (`e2e/record-first-tap.spec.ts`, "allowing the microphone on
  Welcome leaves it open for the first tap").
- Not now closes Welcome without asking. Either way the browser remembers, and Welcome doesn't come
  back (`src/components/farty/welcome-provider.interaction.test.tsx`, "remembers Welcome is done,
  in storage and on the page"; "shows no Welcome once Farty has been opened here").
- Where storage is blocked, Welcome shows on each load and closes for that load
  (`src/components/farty/welcome-provider.interaction.test.tsx`, "shows Welcome, without crashing,
  where storage can’t be read"; "finishes Welcome for this page load where storage is blocked").
- Welcome never covers the privacy, support or 404 page (`e2e/pages.spec.ts`, "Welcome, or from
  768px the lander, shows on a first visit but never covers the privacy, support or 404 page").

## The lander, on a touch tablet

- A first visit to Record (`/`) shows the lander: a hero, Features, How it works, FAQ and a footer,
  with Open Farty and Sign up free, no tabs and no Download App (`e2e/lander.spec.ts`, "a first
  visit shows the lander; Open Farty shows the app, and a reload goes straight to it").
- Open Farty shows the app, with focus on it, and from then on the browser goes straight to the app
  (`e2e/lander.spec.ts`, "a first visit shows the lander; Open Farty shows the app, and a reload
  goes straight to it").
- Sign up free, and Sign in in its top bar, show the app with the account step open on it, even
  where storage is blocked (`e2e/lander.spec.ts`, "Sign up free opens the account step under the top
  bar, whose tabs wait for it"; "Sign up free opens the account step where storage is blocked";
  `src/components/farty/lander.interaction.test.tsx`, "opens the app with the account step on it
  (%s)").
- A first visit to any other tab's address shows the app and counts as opened, so Record won't show
  the lander later (`e2e/lander.spec.ts`, "another tab's URL opens the app and counts as opened").

## The product page, on a computer

- Every tab shows the product page instead of the app, however often the browser has opened Farty
  before: the same sections, with Download App in place of Open Farty and Sign up free
  (`e2e/desktop.spec.ts`, "Record shows the product page"; "Compose shows the product page"; "a
  Song's link shows the product page"; "Profile shows the product page"; "a browser that opened
  Farty before still gets the product page, and the microphone stays shut").
- The microphone stays shut, and widening a narrow window into the product page shuts it
  (`e2e/desktop.spec.ts`, "a browser that opened Farty before still gets the product page, and the
  microphone stays shut"; "widening a narrow window into the product page shuts the microphone").
- Download App shows a QR code for the environment's own address, "Scan to open Farty on your
  phone", and how to add it to the Home Screen. Escape closes it and gives focus back
  (`e2e/desktop.spec.ts`, "Download App shows a QR code for a phone; Escape closes it and gives
  focus back"; `src/lib/download-qr.test.ts`, "opens the build's own origin (SITE_ENV=%s)"; "draws
  exactly the encoded dark modules, inside an empty quiet zone").
- Coming back to the page leaves it where it was (`e2e/desktop.spec.ts`, "coming back to the page
  leaves the product page where it was").
- The privacy, support and 404 pages stay plain pages (`e2e/desktop.spec.ts`, "the privacy, support
  and 404 pages stay pages, with no tabs").

## Images

- A phone, or a lander hidden once Farty is open, downloads none of the lander's screenshots, and
  the service worker never keeps them (`e2e/lander.spec.ts`, "a phone gets Welcome, not the lander,
  and downloads none of its images"; `src/lib/service-worker.test.ts`, "keeps the start page, the
  tabs it links to, and the files they load when it installs, but not the lander's images").

## Staging and Production

- The FAQ's "Is Farty free?" says saving a Toot costs $0.99 where saving is paid (Staging and a
  local run), and that Farty is free on Production ([Paying to save a Toot](payments.md);
  `src/components/farty/lander.interaction.test.tsx`, "answers whether Farty is free as its
  environment does (%s)").
- Download App's QR code opens `staging.farty.fm` on Staging and `farty.fm` on Production
  (`src/lib/download-qr.test.ts`, "opens the build's own origin (SITE_ENV=%s)").

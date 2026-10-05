# App Store drafts

Draft materials for submitting Pedos to the App Store (#75). **Nothing here has been submitted or
entered in App Store Connect, and nothing is hosted.** The owner reviews these, decides what's
marked "Owner decides" or "Owner provides", and presses Submit for Review.

| File | What it is |
| --- | --- |
| [`metadata.md`](metadata.md) | Name options, subtitle, promotional text, description, keywords, What's New, categories, copyright, price, and review notes for Apple, with character counts |
| [`app-privacy.md`](app-privacy.md) | Suggested App Privacy answers ("Data Not Collected"), what the code does with data, age rating answers (9+), and content rights |
| [`privacy-policy.md`](privacy-policy.md) | A short privacy policy to host at a public URL |
| [`support.md`](support.md) | A short support page to host at a public URL |
| [`screenshots/`](screenshots/) | Six 6.9-inch iPhone screenshots |
| [`promo/`](promo/) | Five ad-style promo screenshots (headline over a colored background) and the editor's project file |

## Before submitting

These drafts describe the app as it must be at submission, not today's Release build:

- **Real Toots in the Release build** (#16, #17). Today's Release build can't make Toots, so the
  listing and screenshots don't match it yet (guidelines 2.1, 2.3 and 4.2).
- **Toots that survive a relaunch.** Today they're kept in memory only; the description says
  "Keep the ones you like as Toots".
- **A privacy manifest** (`PrivacyInfo.xcprivacy`) for the app's use of `UserDefaults`; see
  `app-privacy.md`.
- **The first App Store version number.** The build is `0.1.0` (managed by release-please); the
  owner picks the number to upload, and "What's New" isn't used for a first version.
- **Hosted pages:** `privacy-policy.md` and `support.md` are published to
  https://serpcompany.github.io/pedos-app/ by `.github/workflows/pages.yml` on every change to `main`.

## Screenshots

Apple requires the 6.9-inch iPhone size (1320 × 2868 portrait) and scales it for smaller iPhones.
Upload them in this order:

| File | Screen |
| --- | --- |
| `screenshots/01-record.png` | Record: one big red button |
| `screenshots/02-result.png` | Result: the fart's note (G♯3) and "You unlocked Mary Had a Little Lamb" |
| `screenshots/03-recordings.png` | Recordings: each fart with its note and waveform |
| `screenshots/04-compose.png` | Compose: six Songs unlocked, the rest with Pitch Coverage progress |
| `screenshots/05-toot.png` | A Toot of Mary Had a Little Lamb: the notes, which fart plays each, and one note selected |
| `screenshots/06-toots.png` | Toots: four saved Toots |

**These come from the Debug build with sample data** (the Fixture Library's 23 Recordings and
the design prototype's stand-in Song audio), because it's the only build that can make Toots
today. **Retake them from the final Release build before submission**, with real Recordings, so
they show exactly what a user gets.

How they were taken: an iPhone 17 Pro Max simulator on iOS 27.0 in light appearance, with the
status bar overridden to 9:41, full battery and full signal (`xcrun simctl status_bar … override
--time 9:41 --batteryState discharging --batteryLevel 100 --cellularBars 4 --wifiBars 3`;
`discharging` hides the charging bolt, and the simulator's 24-hour clock was turned off). A
throwaway UI test launched the app with `-PedosSampleStart 7` (then recorded and saved the 8th
take) or `-PedosSampleStart all -PedosSampleToots mary,twinkle,ode,jingle`, with
`-PedosMicrophone granted -welcomeSeen YES`, and saved `XCUIScreen.main.screenshot()`.

The fifth screenshot is a saved Toot's screen rather than Song Creator itself: in Debug builds
Song Creator shows a "Simulated Toot" footnote, and a Toot's screen is the same layout without it.
From the Release build, Song Creator (with its "Save to Toots" button) can be used instead.

Checked: every image is exactly 1320 × 2868, RGB with no alpha, and shows no clipped text, debug
text or "Simulated" notes.

## Promo screenshots

`promo/` holds the ad-style set (6.9-inch, 1320×2868): a headline over a colored background, with the real screen in an iPhone frame. It was made with the [app-store-screenshots](https://www.skills.sh/parthjadhav/app-store-screenshots/app-store-screenshots) skill (installed in `.claude/skills/`, not committed). `promo/app-store-screenshots.json` is the editor's project file.

To re-export, for example from the final Release build:

1. Copy the skill's `template/` into a scratch folder and run `bun install`.
2. Copy `promo/app-store-screenshots.json` there.
3. Copy the plain screenshots into `public/screenshots/apple/iphone/en/` as `01.png` to `06.png`, in this folder's order (`01-record` … `06-toots`). Only `02.png` to `06.png` are used by the project file; `01.png` isn't. Copy the app icon from `ios/Pedos/Assets.xcassets/AppIcon.appiconset/AppIcon.png` to `public/app-icon.png`.
4. Run `bun dev`, open http://localhost:3000, and click **Export bundle**. It downloads a zip of every iPhone size Apple accepts.
5. Unzip it and copy the 6.9-inch (1320×2868) PNGs from `ios/iphone/1320x2868/en/` back into `promo/`, under the existing names (`01-hero`, `02-two-devices`, `03-device-top`, `04-device-bottom`, `05-no-device`). Check each with `magick identify` (1320×2868, RGB). The editor auto-saves edits to its own `app-store-screenshots.json`; copy that back to `promo/` too if anything changed.

The promo set shows Toots, which only QA builds can make until #16 and #17, so retake it from the Release build before submitting.

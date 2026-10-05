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

## Before submitting

These drafts describe the app as it must be at submission, not today's Release build:

- **Real Toots in the Release build** (#16, #17). Today's Release build can't make Toots, so the
  listing and screenshots don't match it yet (guidelines 2.1, 2.3 and 4.2).
- **Toots that survive a relaunch.** Today they're kept in memory only; the description says
  "Keep the ones you like as Toots".
- **A privacy manifest** (`PrivacyInfo.xcprivacy`) for the app's use of `UserDefaults`; see
  `app-privacy.md`.
- **Placeholders to fill:** `<support email>`, `<privacy policy URL>` and `<date published>` in the
  hosted pages, and `<copyright holder>` in `metadata.md`.

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

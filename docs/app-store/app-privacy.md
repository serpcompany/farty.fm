# App Privacy, age rating and content rights (draft answers)

Suggested answers for App Store Connect (#75), checked against the code on `main` at 1295526.
**Nothing has been entered in App Store Connect.** The owner confirms each answer; the legal
declarations (these, and EU trader status) are the owner's.

## What the code does with data

Searched `ios/Pedos/` and `RecordingAnalysisKit/Sources/` for networking, storage, analytics,
tracking and other personal-data APIs (`URLSession`, `URLRequest`, `Network`, `NWConnection`,
`WKWebView`, `SafariServices`, `CloudKit`, iCloud, Firebase, Sentry, Crashlytics, analytics,
`AppTrackingTransparency`, `advertisingIdentifier`, `identifierForVendor`, `StoreKit`, location,
contacts, photos, HealthKit, pasteboard, `ShareLink`, `UIActivityViewController`, Keychain).

| Finding | Where |
| --- | --- |
| **No network code at all.** No `URLSession`, `URLRequest`, `Network` framework or web views. The only URL the app opens is `UIApplication.openSettingsURLString`, the system Settings app, from the "Pedos needs the microphone" alert. | `Record/RecordTab.swift` |
| **No third-party code.** The only package is the local `RecordingAnalysisKit` (`ios/project.yml`); it imports Foundation, AVFAudio and Accelerate only. The app imports Foundation, SwiftUI, AVFAudio, Accelerate, Observation and UIKit. | `ios/project.yml`, `RecordingAnalysisKit/Package.swift` |
| **No accounts, analytics, ads, tracking or identifiers.** None of the APIs above appear. | |
| **Microphone audio is recorded and kept on the device.** `AVAudioRecorder` writes mono 44.1 kHz AAC to a draft in the app's temporary folder; Save moves it to `Application Support/Recordings/<id>.m4a`, with `<id>.json` (number, length, save date) and `<id>.analysis.json` (Recording Analysis: the fart's span and pitch) beside it. Discard deletes the draft; Delete removes the files. | `Model/LiveRecordingSource.swift`, `Model/RecordingStore.swift` (ADR 0002) |
| **Recording Analysis runs on the phone**, in Swift, with no server. | `RecordingAnalysisKit/` |
| **One preference:** `welcomeSeen` in `UserDefaults`, so Welcome shows once. | `Sample/SampleAppModel.swift` |
| **Toots are kept in memory only** today and aren't written anywhere. | `Sample/SampleAppModel.swift` |
| The microphone purpose string is "Pedos records your farts so it can turn them into songs." `ITSAppUsesNonExemptEncryption` is `false`. | `Pedos/Info.plist` |

Application Support is included in the user's own iCloud or computer backup by default (the app
doesn't exclude it). That's Apple's backup, under the user's account, and isn't collection by the
developer.

**Gap found: no privacy manifest.** The app uses `UserDefaults`, one of Apple's "required reason"
APIs, but has no `PrivacyInfo.xcprivacy`. Apple asks for one declaring
`NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1` (the app's own preferences),
`NSPrivacyTracking` false, and no collected data types. App Store Connect flags uploads that are
missing it (ITMS-91053). It's a small code change, separate from these drafts; it belongs with the
release work (#23).

## App Privacy answers

**Data collection:** "No, we do not collect data from this app."

Why: Apple counts data as "collected" only when it's transmitted off the device and kept longer
than needed to answer a request in real time. Pedos records audio, but the recordings, their
analysis and the Toots never leave the phone, and the app has no network code. So no data type is
declared, and the App Store shows **"Data Not Collected"**.

If App Store Connect walks through data types anyway, the answer for **Audio Data** (under User
Content) is "not collected", for the reason above; every other type is not collected either.

- **Tracking:** No. There's no tracking, no third-party SDK and no advertising identifier, so the
  App Tracking Transparency prompt isn't needed.
- **Privacy policy URL:** required even with no data collected. The draft is
  [`privacy-policy.md`](privacy-policy.md); the owner hosts it and enters the URL.
- **Privacy choices URL:** optional; leave it empty (there's nothing to opt out of).

Re-check these answers if any of these arrive: sharing or exporting Toots, crash reporting or
analytics SDKs, accounts or sync (ADR 0001 rules these out for the MVP), or AI Song Creator if it
sends anything to a server.

## Age rating questionnaire

Apple's questionnaire (updated in 2025 with the 13+, 16+ and 18+ ratings) asks the questions below;
the exact wording in App Store Connect may differ slightly.

| Question | Suggested answer | Why |
| --- | --- | --- |
| Parental controls | No | None in the app. |
| Age assurance | No | None. |
| Unrestricted web access | No | No web views or browser. |
| User-generated content | No | Recordings are made by the user but stay on their phone; nobody else can see or hear them. |
| Messaging and chat | No | None. |
| Advertising | No | None. |
| **Profanity or crude humor** | **Infrequent or Mild** | Fart humor is the whole premise, but it's mild toilet humor: no words of profanity anywhere, no insults, nothing sexual. |
| Horror or fear themes | None | |
| Alcohol, tobacco or drug use or references | None | |
| Mature or suggestive themes | None | |
| Medical or treatment information | None | The "fart health analyzer" (#24) is out of scope; re-answer if it ships. |
| Health or wellness topics | None | Same. |
| Sexual content or nudity / graphic sexual content | None | |
| Cartoon or fantasy violence / realistic violence / prolonged graphic violence / guns or other weapons | None | |
| Simulated gambling / gambling / contests / loot boxes | None / No | Unlocking Songs is collecting notes, with no chance, purchases or prizes. |

**Suggested rating: 9+**, the result of "Infrequent or Mild" crude humor with everything else
"None". The conservative alternative is "Frequent or Intense" (13+), if the owner would rather not
argue that a fart app's humor is mild; it costs younger users, the audience most likely to enjoy
the app.

**Made for Kids:** No. Don't put Pedos in the Kids category; it has its own rules (guideline 1.3)
and the humor is better rated than targeted.

## Content rights

App Store Connect asks: "Does your app contain, show, or access third-party content?"

**Suggested answer: Yes, and yes, we have the necessary rights.**

- **The Songs are third-party melodies, all public domain.** Every Song comes from a cited score
  in PDMX (Long et al., ICASSP 2025, doi:10.5281/zenodo.15571083), checked per score as public
  domain (Public Domain Mark 1.0), or from the Mutopia Project (public domain). Each entry in
  `catalog/catalog.json` records the source ID, URL, license, file hash and retrieval date
  (ADR 0003). The app credits them on the Profile tab and on each Song ("Public domain score ·
  PDMX").
- **Happy Birthday** is in the catalog, and the score used is marked public domain in PDMX. Its
  copyright was long disputed: a 2015 US ruling (Marya v. Warner/Chappell) and the 2016 settlement
  put it in the public domain in the US. It's the one Song worth a second look by the owner for
  other countries.
- **No third-party audio ships.** Every sound comes from the user's own recordings (ADR 0004). The
  Fixture Library (`fixtures/recordings/`) and the design prototype's audio are excluded from
  Release builds, and `ios/scripts/check-release-build.sh` fails the build if any audio or loader
  code gets in.
- **No third-party code or fonts:** stock SwiftUI and SF Symbols only.

## Other declarations (owner)

- **Export compliance:** `ITSAppUsesNonExemptEncryption` is already `false` in `Info.plist`, so App
  Store Connect shouldn't ask.
- **EU Digital Services Act trader status:** the owner's legal declaration; not drafted here.

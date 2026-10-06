# Native, local-first iPhone app with no accounts for the MVP

The first attempt was an Expo/React Native app with a backend and accounts, and it never reached a good-sounding melody. The MVP is a native SwiftUI iPhone app for iOS 26 and later, distributed through TestFlight. It uses stock SwiftUI components from the latest iOS with no custom component library; iOS 26 is the minimum so the newest components need no availability workarounds. The owner decided this on 2026-09-29. Recordings, their analysis, and Created Melodies live only on the device. There are no accounts, cloud libraries, or sync. Native audio APIs (AVFoundation, Accelerate) do all the recording and rendering on the phone.

Out of scope for the MVP: Android, iPad layouts, accounts, sharing, and a starter library of Recordings for regular users.

Update 2026-09-30: Created Melodies are now called Toots (`CONTEXT.md`, #52).

Update 2026-10-06: Apple rejected the App Store submission as a fart app, so Pedos is now a web app (ADR 0007). The platform choice above is replaced; local-first and no accounts still hold.

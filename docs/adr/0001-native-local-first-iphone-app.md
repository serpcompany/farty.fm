# Native, local-first iPhone app with no accounts for the MVP

The first attempt was an Expo/React Native app with a backend and accounts, and it never reached a good-sounding melody. The MVP is a native SwiftUI iPhone app (iOS 26+) distributed through TestFlight. The owner raised the minimum from iOS 17 to iOS 26 on 2026-09-29 so the app can use the newest native SwiftUI components without fallbacks. Recordings, their analysis, and Created Melodies live only on the device. There are no accounts, cloud libraries, or sync. Native audio APIs (AVFoundation, Accelerate) do all the recording and rendering on the phone.

Out of scope for the MVP: Android, iPad layouts, accounts, sharing, and a starter library of Recordings for regular users.

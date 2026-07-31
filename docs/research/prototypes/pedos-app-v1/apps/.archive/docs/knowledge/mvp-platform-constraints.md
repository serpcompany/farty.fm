# MVP Platform Constraints

Last reviewed: 2026-03-19

## Summary

The original product idea assumes passive background listening, possible lookback recording, and voice-style wake-up behavior across multiple device ecosystems.

That should not be treated as an MVP assumption.

## What we know so far

- Android allows microphone work tied to foreground services, and newer Android versions require declaring the correct foreground service type for long-running microphone access.
- Apple supports Siri authorization and shortcut-style interactions, but this does not read like a green light for a third-party custom always-listening wake word flow.
- Alexa documentation centers around Alexa wake word, push-to-talk, and tap-to-talk, which makes custom wake word assumptions a poor fit for an MVP plan.

## Planning implication

The safest product plan is:

1. build an iPhone manual recording flow first
2. prove users enjoy capture, playback, and stats
3. research passive detection later as a dedicated follow-up project

## Official references

- Android foreground services and permissions:
  https://developer.android.com/develop/background-work/services/fgs/declare
- Android long-running work with microphone service types:
  https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running
- Apple Siri authorization:
  https://developer.apple.com/documentation/sirikit/requesting-authorization-to-use-siri
- Alexa invocation guidance:
  https://developer.amazon.com/en-US/docs/alexa/alexa-auto/invoking-alexa.html

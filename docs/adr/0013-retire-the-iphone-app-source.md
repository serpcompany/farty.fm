# Retire the iPhone app's source

The iPhone app stopped being built or released on 2026-10-06 (#103), after Apple rejected it (ADR 0007). Its source stayed in the repository as the web app's design authority and to hold golden format 2. The web app now does everything it did, and more: accounts, sync and paid saves. On 2026-10-27 the product owner retired it from the repository:

1. **Removed:** the Swift app (`ios/`), Recording Analysis in Swift (`RecordingAnalysisKit/`, with golden format 2), their workflow (`ios.yml`), the App Store submission (`docs/app-store/`), the per-PR screen evidence (`docs/evidence/`), the HTML design prototype (`docs/design/prototype/`), the iPhone app's `CHANGELOG.md` and `version.txt`, and fixture 021, which only golden format 2 read.
2. **Kept in history** behind the annotated tag `archive-2026-10-27`, the last commit that has them. Read a file with `git show archive-2026-10-27:<path>`. The `v1.0.0` tag keeps the iPhone app's last release.
3. **The design authority** is the web app as built, with its product docs and these ADRs. Where an older ADR or design doc describes iPhone behavior, the web app wins unless an ADR says otherwise.
4. **Nothing changes for users.** The web app never read these files: its Recording Analysis and engine are matched to the Python reference (`tools/melody-lab/`) through `fixtures/golden/`, not to the Swift code.

## Why

- Every check, audit and agent searched the Swift code as if it were current, and four PRs in the week before had to keep it compiling (#117, #210, #220, #231).
- It held 69% of the repository's tracked bytes, and `ios.yml` started macOS jobs for an app that ships nowhere.
- SERP's standard is to retire material behind an archive tag rather than keep it in the tree.

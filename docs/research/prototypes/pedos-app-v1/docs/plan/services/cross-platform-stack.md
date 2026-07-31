# Cross-Platform Stack

This doc maps out the recommended tech stack to support:

- iPhone-first MVP
- later Android / Google Play expansion without rebuilding the backend strategy from scratch

## Recommendation

Use a shared, platform-neutral backend from day one.

Recommended stack:

- client app for MVP: native iPhone app
- auth: Better Auth on Cloudflare Workers + D1
- ORM and migrations: Drizzle
- database: Cloudflare D1
- file storage: Cloudflare R2
- backend glue: Cloudflare Workers
- async jobs for `Pedos AI`: Cloudflare Queues, and Workflows only if the AI flow grows more complex
- iPhone-native integrations: Apple App Intents, Apple audio frameworks, Sign in with Apple
- Android-native integrations later: Google Sign-In and Android platform-specific recording integrations

## Why This Is The Best Call

If Android is a likely V1 or near-term expansion, the backend should not be Apple-only.

That means:

- do not use CloudKit as the system of record
- keep app data, auth, and files in a backend both iPhone and Android can use
- keep Apple capabilities limited to Apple-specific UX features

This keeps the product portable while still letting the MVP feel like a proper iPhone app.

## Product-Level Decision

### For MVP

- build the app as an iPhone-native product
- use Apple-native device capabilities where they improve the experience
- keep the backend shared and platform-neutral

### For V1 Android

- reuse the same auth system
- reuse the same metadata database
- reuse the same storage buckets
- add Android-native client work without migrating core user data

## Recommended Split

### Apple-only capabilities

Use Apple services where they are clearly device-specific:

- App Intents / Siri / Shortcuts
- Apple audio frameworks
- Sign in with Apple as one sign-in method
- Apple Developer Program / TestFlight / App Store Connect

### Shared backend capabilities

Keep these out of Apple-only systems:

- user accounts
- recording metadata
- generated-song metadata
- audio file storage
- song share links
- generation jobs

## Backend Recommendation

### Auth: Better Auth On Cloudflare Workers + D1

Why:

- keeps auth inside the Cloudflare-first stack direction
- works with Apple and Google as identity providers
- runs cleanly with Hono / Workers style backend setups
- stores users, accounts, and sessions in the same D1-backed system
- matches the team's existing auth stack in other products

Recommended provider rollout:

- MVP iPhone: Sign in with Apple
- V1 Android: Google Sign-In
- later: email / magic link only if product needs it

Important note:

- use Better Auth with the Drizzle adapter against D1
- create the auth and database instances from the Worker request context
- keep auth tables and app tables in the same managed migration flow

### ORM And Migrations: Drizzle

Why:

- the team already uses it
- it is the correct schema and migration layer for Better Auth on D1
- it keeps auth tables and app tables in one typed model
- it gives a safer migration path than ad hoc SQL changes

Best fit for:

- auth tables
- recording tables
- generated-song tables
- job tables
- share tables

### Database: Cloudflare D1

Why:

- better fit than Apple-only storage if Android is planned
- relational model fits recordings, generated songs, jobs, and shares well
- SQL model is easier to evolve than document-only storage for this product shape
- integrates directly with Workers
- works cleanly with Drizzle as the main ORM and migration layer

Best fit for:

- users
- recordings
- generated songs
- generation jobs
- song share records

### File Storage: Cloudflare R2

Why:

- works cleanly with Workers and D1
- fits private recordings and generated-song storage
- can support signed URLs and later sharing flows
- avoids egress-fee surprises for shared audio access patterns

Best fit for:

- recorded fart clips
- generated songs
- shareable song assets or link targets

### Backend Glue: Cloudflare Workers

Use a thin server-side layer for:

- signed URL creation
- job submission
- moderation / validation
- third-party AI service calls
- share-link generation

This should stay thin in MVP and grow only where needed.

### Async Jobs: Add When `Pedos AI` Ships

Do not overbuild this for the base recording MVP.

When `Pedos AI` ships, add:

- Cloudflare Queues for generation job queueing
- retry handling
- job status updates
- failure tracking

Add Workflows only if the generation pipeline becomes multi-step enough to justify it.

## Rejected Default

### CloudKit As System Of Record

This is not the recommended main backend if Android is planned.

Why:

- it is too Apple-shaped for a product expected to expand to Android
- it increases future migration risk
- it ties core product data too tightly to the Apple ecosystem

CloudKit can still be useful for Apple-only experiments, but it should not be the main product data layer here.

## Recommended MVP Build Order

1. Lock shared backend choice first
2. Set up Workers, D1, Drizzle, and R2
3. Set up Better Auth on top of that backend
4. Ship iPhone MVP against that shared backend
5. Add Android client later without changing the core backend model

## Open Decisions

- whether accounts are required on day one or guest mode ships first
- whether the Android app later is native Android or a cross-platform client
- whether analytics should be PostHog, Firebase Analytics, or both
- what job system should power `Pedos AI` when generation ships

## Related Docs

- [Services](../../../apps/.archive/docs/plan/services/README.md)
- [Auth And Account](../../../apps/.archive/docs/plan/services/auth-and-account.md)
- [Data And Storage](../../../apps/.archive/docs/plan/services/data-and-storage.md)
- [Quick Record](../../../apps/.archive/docs/plan/features/quick-record.md)
- [Musical Fruit](../../../apps/.archive/docs/plan/features/musical-fruit/README.md)

## Sources

- Apple Sign in with Apple:
  https://developer.apple.com/documentation/xcode/configuring-sign-in-with-apple
- Cloudflare Workers:
  https://developers.cloudflare.com/workers/
- Cloudflare D1:
  https://developers.cloudflare.com/d1/
- Cloudflare R2:
  https://developers.cloudflare.com/r2/
- Cloudflare Queues:
  https://developers.cloudflare.com/queues/
- Better Auth database docs:
  https://www.better-auth.com/docs/concepts/database
- Better Auth SQLite adapter:
  https://better-auth.com/docs/adapters/sqlite
- Better Auth Hono integration:
  https://www.better-auth.com/docs/integrations/hono
- Better Auth Apple:
  https://www.better-auth.com/docs/authentication/apple
- Better Auth Google:
  https://www.better-auth.com/docs/authentication/google

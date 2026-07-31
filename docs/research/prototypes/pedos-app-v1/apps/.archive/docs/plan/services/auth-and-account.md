# Auth And Account

This doc defines the recommended auth and account strategy for:

- iPhone MVP
- later Android expansion

## Recommendation

Use `Better Auth` as the account and session system, running on Cloudflare Workers and backed by D1 through `Drizzle`.

Recommended sign-in rollout:

- MVP iPhone: `Sign in with Apple`
- V1 Android: `Google Sign-In`
- later optional fallback: email or magic link if needed

## Why

This keeps identity portable across platforms.

The important distinction is:

- `Sign in with Apple` is a sign-in method
- `Google Sign-In` is a sign-in method
- `Better Auth` is the actual shared account and session system
- `Drizzle` is the schema and database layer that Better Auth uses with D1

That means users can still sign in with Apple on iPhone, but the product account does not become Apple-only or Apple-backed.

## Product Strategy

### MVP

- support account creation through Sign in with Apple
- create a normal backend user and session record after auth
- use that backend user ID for recordings, generated songs, jobs, and shares

### V1 Android

- add Google Sign-In
- map both Apple and Google logins into the same backend account system
- keep user data portable across platforms

## Implementation Shape

- run Better Auth inside the Cloudflare backend layer
- use the Better Auth Drizzle adapter against D1
- keep auth tables in the same D1 database as the rest of the app metadata
- manage schema changes through Drizzle migrations instead of ad hoc SQL

## Account Model

At minimum, each account should support:

- internal user ID
- auth provider identity
- created at
- last sign-in at
- display name if available

Optional later fields:

- onboarding state
- preferences
- share settings

## Guest Mode

Open decision:

- required account from day one
- or guest mode first with later account upgrade

Recommendation:

- if sync and sharing matter early, require accounts
- if speed to MVP matters most, guest mode can exist, but it should still be designed to upgrade cleanly into a real account later

## What Not To Do

- do not use Apple identity as the only account model if Android is planned
- do not make Sign in with Apple the only possible long-term sign-in path

## Cloudflare Fit

Better Auth is the recommended fit for this stack because:

- it can run on Workers
- it can store auth data in D1 through Drizzle
- it keeps auth close to the rest of the backend instead of splitting it into a separate hosted platform
- the team already uses it elsewhere, so it reduces setup and operating overhead

## Dependencies

- [Cross-Platform Stack](./cross-platform-stack.md)
- [Data And Storage](./data-and-storage.md)
- [Services](./README.md)

## Sources

- Apple Sign in with Apple:
  https://developer.apple.com/documentation/xcode/configuring-sign-in-with-apple
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

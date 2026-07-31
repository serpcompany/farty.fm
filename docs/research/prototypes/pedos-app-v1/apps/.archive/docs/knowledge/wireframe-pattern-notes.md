# Wireframe Pattern Notes

Last reviewed: 2026-03-19

## Summary

The `docs/reference/base44` project is useful as a wireframe reference even though the full app includes Base44-specific app and backend code.

The reusable part is the wireframe presentation pattern:

- one `Wireframes.jsx` page that drives screen selection and gallery mode
- one reusable `IPhoneFrame.jsx` shell
- one screen component per major screen or state
- low-fidelity grayscale styling with Tailwind

## Project usage

The current runnable Pedos wireframes live in `apps/wireframes`.

That app keeps the same broad pattern:

- separate screen components
- interactive mode for one-screen review
- gallery mode for flow review
- iPhone frame wrapper

## Why this matters

Future wireframe work should reuse the same structure instead of rebuilding a one-off preview every time.

That keeps screen reviews, flow reviews, and design changes easier to manage.

## Testing notes

For this setup, Playwright tests should scope interactions to the rendered phone shell instead of the left-hand screen list.

- add stable `data-testid` hooks on the iPhone frame and inner screen wrapper
- target buttons and text inside the phone wrapper so sidebar labels do not collide with in-screen copy
- keep a local `@playwright/test` dependency in `apps/wireframes` instead of relying on one-off CLI invocations

## Navigation notes

For persistent app-shell wireframes, the bottom nav should live in normal layout flow instead of being absolutely overlaid on top of screen content.

- absolute positioning worked for tab-only screens but broke once non-tab flows also needed the same nav
- putting the bottom nav after each screen footer keeps actions visible and makes the shell reusable across all state screens

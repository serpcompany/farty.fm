# No ads for now

The web app shows no ads. The orchestrator decided this on 2026-10-21 (#115), after the owner asked agents to settle every open issue without waiting on them. Ads can come back later, under their own issue (see Revisit when).

## Why

- **Earnings:** ad income scales with visits, and a site this new earns close to nothing from display ads. Each ad slot still costs the experience, and a script loads on every page.
- **Consent:** personalized ads for EU and UK visitors need a certified consent banner. The web app has none, because #126 chose cookieless, consent-free telemetry on purpose.
- **Audience:** the audience was rated 9+, and the web app has no age check (owner, 2026-10-20). Child-directed rules (COPPA) are therefore a real risk for personalized ads.

## Options considered

| Option | What it earns | What it costs the experience |
|---|---|---|
| **No ads for now (chosen)** | Nothing | Nothing |
| Non-personalized ads on Compose, Toots or Profile now | Little, until traffic grows | An ad slot and a script on those pages |
| Personalized ads with a consent banner | The most per visit | A consent banner for every visitor, an ad script everywhere, and COPPA risk for a 9+ audience |

## Revisit when

Cloudflare Web Analytics (#126) shows steady traffic. The default then is non-personalized ads only, on Compose, Toots or Profile, and never during Record, Review or Result or while a Toot plays. Building that gets its own issue.

## Consequences

- No ad script, slot or consent banner is added to the web app.
- #126's cookieless telemetry stays as it is.

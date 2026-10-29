# Domain docs

How engineering skills should consume this repository’s domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root (the glossary).
- `docs/adr/` (decisions already made, and why).
- `tools/melody-lab/README.md` for the reference melody engine.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── apps/web/               # the app: Farty on the web (Next.js on Cloudflare Workers)
├── catalog/                # Song Catalog: cited MIDI scores and provenance
├── fixtures/recordings/    # Fixture Library (internal only)
├── fixtures/golden/        # the reference engine's answers, which the app must match
├── tools/melody-lab/       # Python reference engine and listening page
├── tools/catalog/          # batch import of Songs from PDMX, with its gates and reports
└── docs/
    ├── adr/
    ├── agents/
    └── research/
```

## Historical reference

Earlier work is preserved as git tags, not on the branches:

- `archive-2026-10-27`: the retired iPhone app, its Swift Recording Analysis and its App Store submission (ADR 0016). Read a file with `git show archive-2026-10-27:<path>`.
- `archive/pedos-app-v1`: `main` before the restart, with its research prototypes.
- `archive/prototype/*`, `archive/research/*`, `archive/codex/*`: the old prototype branches.

Treat them as evidence, not specification. Pull forward what’s useful, revalidate old assumptions, and record anything newly accepted in `CONTEXT.md` or an ADR. Do not silently restore archived architecture or code.

## Use the glossary’s vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Don’t drift to synonyms the glossary explicitly avoids.

If the needed concept isn’t present, reconsider whether the term belongs or note the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface that conflict explicitly rather than silently overriding it.

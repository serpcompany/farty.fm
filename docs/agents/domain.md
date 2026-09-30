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
├── catalog/                # Song Catalog: cited MIDI scores and provenance
├── fixtures/recordings/    # Fixture Library (internal only)
├── tools/melody-lab/       # Python reference engine and listening page
├── docs/
│   ├── adr/
│   ├── agents/
│   └── research/
└── ios/                    # the app (created by the first build issue)
```

## Historical reference

The first attempt and the pre-restart prototypes are preserved as git tags, not on `main`:

- `archive/pedos-app-v1`: `main` before the restart, including `docs/research/prototypes/pedos-app-v1`.
- `archive/prototype/*`, `archive/research/*`, `archive/codex/*`: the old prototype branches.

Treat them as evidence, not specification. Pull forward what’s useful, revalidate old assumptions, and record anything newly accepted in `CONTEXT.md` or an ADR. Do not silently restore archived architecture or code.

## Use the glossary’s vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Don’t drift to synonyms the glossary explicitly avoids.

If the needed concept isn’t present, reconsider whether the term belongs or note the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface that conflict explicitly rather than silently overriding it.

# Domain docs

How engineering skills should consume this repository’s domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- Relevant ADRs under `docs/adr/`.
- For wayfinding, grilling, and product discovery, consult the preserved first attempt at `docs/research/prototypes/pedos-app-v1/`.

If `CONTEXT.md` or `docs/adr/` doesn’t exist, proceed silently. Domain-modeling workflows create them lazily when terms or decisions are resolved.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   ├── agents/
│   └── research/
└── src/
```

## Historical reference

`docs/research/prototypes/pedos-app-v1/` preserves the first attempt.

Treat it as evidence and reference material—not as the current specification or implementation. During wayfinder and grilling sessions:

- Pull forward useful research, constraints, experiments, terminology, and lessons.
- Revalidate prior assumptions before making them current decisions.
- Record accepted decisions in the active context docs, ADRs, or issue map.
- Do not silently restore archived architecture or code.

## Use the glossary’s vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Don’t drift to synonyms the glossary explicitly avoids.

If the needed concept isn’t present, reconsider whether the term belongs or note the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface that conflict explicitly rather than silently overriding it.

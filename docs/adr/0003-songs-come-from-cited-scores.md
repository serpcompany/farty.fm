# Songs come only from cited public-domain scores

Earlier melody plans were typed from an agent's memory, and some were wrong. Every Song now comes from a machine-readable score with a named source and license. The preferred source is PDMX, a published dataset of MuseScore scores with per-score license checks (Long et al., ICASSP 2025, doi:10.5281/zenodo.15571083); the Mutopia Project is also acceptable. Each entry in `catalog/catalog.json` records the source ID, URL, license, file hash, retrieval date, and which excerpt and tempo are used.

The importer never edits notes. It keeps the top line of the chosen track, only starting a new note where a new top note begins, so a held melody note isn't chopped by moving lower voices. It reports every chord tone, inner-voice onset and tempo change it drops. A Song whose import looks wrong is replaced with a better score, not hand-corrected.

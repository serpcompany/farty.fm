# Golden data from the reference engine

The answers of the approved Python reference engine ([`tools/melody-lab/`](../../tools/melody-lab/)) for the Fixture Library and the Song Catalog. The web app's port (`apps/web/src/lib/analysis/` and `src/lib/engine/`) checks itself against these files. Everything except this README is generated; don't edit it by hand.

Regenerate after any change to the lab, the Fixture Library or the catalog, and commit the result:

```sh
cd tools/melody-lab && uv run export_golden.py
```

The script deletes and rewrites `index.json`, `recordings/`, `songs/`, `arrangements/` and `coverage.json`. It uses the same calls as `run_all.py` (`load_library`, `load_catalog`, `melody_fit`, `plan`, `render`, `evaluate`) and prints the same summary line per Song and library. Running it twice gives byte-identical files (keys sorted, floats rounded or written exactly). Other library versions may change low-order digits, which is why the [port tests](port-tests.md) use tolerances. `tools/uv.lock` pins them, including soxr, which decides the decoded samples of the 48 kHz MP3s. `index.json` records the versions used.

Rendered audio is not exported (too large). The web app's renders are judged by running the same checks on their own output (`apps/web/scripts/render-songs.ts`, then `evaluate_renders.py`).

- [The golden files](files.md): each file's fields, and the conventions they share (exact and rounded values, decoding, pYIN's pitch grid).
- [Testing a port](port-tests.md): how a port is tested against these files, and how close it must come.
- [The reference planner](planner.md): how the reference engine chooses each Arrangement, which Auto-map follows term by term.

## Layout

| Path | Contents |
| --- | --- |
| `index.json` | Libraries, Recording and Song ids, the Melodic Recordings, the tie groups, each Song's transposition and unlock state per library, and the library versions used |
| `recordings/<id>.json` | Recording Analysis of each of the 32 Fixture Library Recordings |
| `songs/<id>.json` | The imported melody of each catalog Song (`melody.py`) |
| `arrangements/full/<song>.json` | Pitch Coverage, transposition, Arrangement and `evaluate.py` metrics using the whole Fixture Library (32 Recordings). 9 of the 13 Songs unlock. Four are locked, each short of a fart as long as its longest note on some pitch (ADR 0011), now that a fart plays at its own length (ADR 0012): `jingle` (4 of 5 notes covered, needs F♯2, 2.0 s), `row` (5 of 6, D♯2, 1.5 s), `auld` (6 of 7, G3, 1.8 s) and `amazing` (4 of 6, D3 1.2 s and F3 3.0 s). |
| `arrangements/small/<song>.json` | The same using only `002 009 016 022 069 090` (`build.py`'s `SMALL_LIBRARY`, a plausible new user's first six). All but `009` are Melodic, and `016` and `022` are a tie group. No Song unlocks: all 13 are locked at 3 to 5 notes covered, with Pitch Coverage, the partial Arrangement and `missing`, but nothing to render. Most of the six are short: `016` lasts 0.31 s and `069` 1.08 s. |
| `coverage.json` | Pitch Coverage and Arrangement of every Song on 50 fixed random subsets of the Fixture Library: 10 each of 3, 6 and 9 Recordings, and of 4 and 6 Melodic Recordings |

Songs: the 13 that `export_golden.py`'s `golden_catalog()` picks, every Song the web app ships (its ship list, [`apps/web/src/lib/catalog/ship-list.json`](../../apps/web/src/lib/catalog/ship-list.json), which `generate.ts` reads too) and every hand-entered catalog entry (the ones without `import`). Since #225 `birthday` and `merryxmas` are PDMX imports that ship. The other PDMX imports are checked by [`tools/catalog/import_pdmx.py`](../../tools/catalog/import_pdmx.py)'s gates instead, though `run_all.py` renders them too. This includes `ode-mutopia`, an SATB score of Ode to Joy that exercises the skyline importer. `build.py` skips it, and so does the ship list, so the app lists 12 Songs.

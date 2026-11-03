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
| `recordings/<id>.json` | Recording Analysis of each of the 38 Fixture Library Recordings, 6 of them the owner's own Noise-like farts (`105` to `110`, #295) |
| `songs/<id>.json` | The imported melody of each catalog Song (`melody.py`) |
| `arrangements/full/<song>.json` | Pitch Coverage, transposition, Arrangement and `evaluate.py` metrics using the whole Fixture Library (38 Recordings, 26 of them Melodic). 124 of the 129 Songs unlock. `silent-night`, `joy-to-the-world`, `away-in-a-manger` and `daisy-bell` each need one fart of 2 to 3.5 s, and `taps` two of 5 s. All 13 Songs before #229 unlock since Songs play every burst of a fart (ADR 0016). Before, 9 did: `jingle`, `row`, `auld` and `amazing` were each short of a fart as long as its longest note on some pitch (ADR 0011). |
| `arrangements/small/<song>.json` | The same using only `002 009 016 022 069 090` (`build.py`'s `SMALL_LIBRARY`, a plausible new user's first six). All six are Melodic since the second pitch window found `009` (#282), and `016` and `022` are a tie group. 28 Songs unlock, of 3 to 6 notes, 23 of them with `009`, `mary` and `saints` among them. The other 101 are locked at 1 to 6 notes covered, with Pitch Coverage, the partial Arrangement and `missing`, but nothing to render. Most of the six are short: `016` lasts 0.31 s and `069` 1.08 s. |
| `coverage.json` | Pitch Coverage and Arrangement of every Song on 50 fixed random subsets of the Fixture Library: 10 each of 3, 6 and 9 Recordings, and of 4 and 6 Melodic Recordings. They are drawn from the Fixture Library without the owner's farts, so adding those changed none (#295). |

Songs: the 129 that `export_golden.py`'s `golden_catalog()` picks, every Song the web app ships (its ship list, [`apps/web/src/lib/catalog/ship-list.json`](../../apps/web/src/lib/catalog/ship-list.json), which `generate.ts` reads too) and every hand-entered catalog entry (the ones without `import`). Since #229 that is every catalog Song: a PDMX import added to `catalog/` later is checked by [`tools/catalog/import_pdmx.py`](../../tools/catalog/import_pdmx.py)'s gates until it's on the ship list, though `run_all.py` renders it too. This includes `ode-mutopia`, an SATB score of Ode to Joy that exercises the skyline importer. `build.py` skips it, and so does the ship list, so the app lists 128 Songs.

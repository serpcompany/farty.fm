"""Move the catalog's Songs to the end of a strain, keeping their scores (#402).

    tools/melody-lab/.venv/bin/python -I tools/catalog/recut.py [--only id,id]

Each Song goes through import_pdmx.strain_options, the importer's own rule and gates, and only its
`render.max_beats` changes. Importing a batch again would apply the rule too, but picks other scores
for some of its Songs (#344). A cut must leave the Song's notes as they were up to where one of the
two readings stops: if one doesn't, the run stops with the catalog as it was. Running it again
changes nothing.

Afterwards run tools/melody-lab/export_golden.py and the app's catalog generator, as after a batch
(README, After a batch).
"""
import argparse
import json
import multiprocessing
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script's folder off sys.path

import import_pdmx  # noqa: E402
from engine import load_library  # noqa: E402
from melody import load_midi  # noqa: E402

CATALOG = import_pdmx.CATALOG
_library = None


def only_the_end_moves(old, new):
    """Whether two readings of a Song are the same notes up to where the shorter one stops. Only that
    note's length may differ, since a note's slot runs to the next onset."""
    same = min(len(old), len(new))
    return (all((a.start, a.pitch) == (b.start, b.pitch) for a, b in zip(old[:same], new[:same]))
            and all(a.dur == b.dur for a, b in zip(old[:same - 1], new[:same - 1])))


def recut(entry, catalog_dir, library):
    """A Song's entry with its excerpt moved to the end of a strain, or as it is."""
    midi, options = Path(catalog_dir) / entry["file"], entry["render"]
    cut = import_pdmx.strain_options(midi, entry["title"], options, library)
    if cut == options:
        return entry
    if not only_the_end_moves(load_midi(midi, **options).notes, load_midi(midi, **cut).notes):
        raise ValueError(f"{entry['id']}: {options} and {cut} aren't the same notes")
    return {**entry, "render": cut}


def _start_worker():
    global _library
    _library = load_library()


def _recut(entry):
    return recut(entry, CATALOG.parent, _library)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", help="comma-separated Song ids; the others stay as they are")
    args = parser.parse_args()
    catalog = json.loads(CATALOG.read_text())
    only = set(args.only.split(",")) if args.only else {e["id"] for e in catalog}
    unknown = only - {e["id"] for e in catalog}
    if unknown:
        parser.error(f"not in the catalog: {', '.join(sorted(unknown))}")
    with multiprocessing.Pool(max(2, os.cpu_count() - 2), initializer=_start_worker) as pool:
        cut = {e["id"]: e for e in pool.imap_unordered(_recut, [e for e in catalog if e["id"] in only], chunksize=4)}
    merged = [cut.get(e["id"], e) for e in catalog]
    CATALOG.write_text(json.dumps(merged, indent=1, ensure_ascii=False))  # the file's own format
    moved = [e["id"] for e, m in zip(catalog, merged) if e != m]
    print(f"{len(moved)} of {len(only)} Songs moved")


if __name__ == "__main__":
    main()

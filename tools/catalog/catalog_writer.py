import json
import os
import tempfile
from pathlib import Path

import pdmx
from dataset import file_hash
from melody import load_catalog

DOI = "10.5281/zenodo.15571083"
DATASET = "PDMX: A Large-Scale Public Domain MusicXML Dataset (Long et al., ICASSP 2025)"
TOOL = "tools/catalog/import_pdmx.py"


def catalog_entry(title, r, retrieved, titles_file):
    sid = r["score_id"]
    row = r["row"]
    return {
        "id": title.id,
        "title": title.title,
        "file": f"midi/pdmx-{title.id}.mid",
        "sha256": r["sha256"],
        "source": {
            "dataset": DATASET,
            "dataset_doi": DOI,
            "dataset_path": row["mid"],
            "musescore_score_id": sid,
            "musescore_url": f"https://musescore.com/score/{sid}",
            "score_title": row["title"],
            "composer": row["composer_name"],
            "license": row["license"],
            "license_url": row["license_url"],
            "pdmx_license_conflict": row["license_conflict"],
            "rating": row["rating"],
            "n_ratings": row["n_ratings"],
            "n_views": row["n_views"],
        },
        "retrieved": retrieved,
        "render": r["render"],
        "import": {"tool": TOOL, "titles": titles_file},
    }


class ReimportMismatch(Exception):
    pass


def write_text(path, text):
    path.write_text(text, encoding="utf-8", newline="\n")


def stage_copies(staging, picks, archive, titles_file):
    kept = []
    for title, r, src in picks:
        entry = catalog_entry(title, r, archive["downloaded"], titles_file)
        copy = staging / entry["file"]
        copy.write_bytes(src.read_bytes())
        problems = pdmx.hash_problems(archive["md5"], archive["published_md5"], r["sha256"], file_hash(copy, "sha256"))
        r["gates"]["hash"] = problems or "pass"
        if problems:
            r["passed"] = False
            continue
        kept.append((title, r, entry))
    return kept


def check_reimport(staged_catalog, kept):
    imported = {c["id"]: m for c, m in load_catalog(staged_catalog)}
    for title, r, _ in kept:
        if [[n.start, n.dur, n.pitch] for n in imported[title.id].notes] != r["notes"]:
            raise ReimportMismatch(f"{title.id}: the catalog entry imports differently from what was gated; "
                                   "the catalog is unchanged")


def write_catalog(path, catalog, titles_file, picks, archive):
    with tempfile.TemporaryDirectory(prefix=".import-", dir=path.parent) as staging:
        staging = Path(staging)
        (staging / "midi").mkdir()
        kept = stage_copies(staging, picks, archive, titles_file)
        entries = [entry for _, _, entry in kept]
        write_text(staging / path.name, json.dumps(entries))
        check_reimport(staging / path.name, kept)
        merged = pdmx.merge_catalog(catalog, titles_file, entries)
        old = {e["file"] for e in catalog if pdmx.batch_of(e) == titles_file}
        write_text(staging / path.name, json.dumps(merged, indent=1, ensure_ascii=False))
        for entry in entries:
            (staging / entry["file"]).replace(path.parent / entry["file"])
        os.replace(staging / path.name, path)
        for stale in old - {e["file"] for e in merged}:
            (path.parent / stale).unlink(missing_ok=True)
    return entries

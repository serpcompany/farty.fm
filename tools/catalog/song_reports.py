"""List the Song reports (#358) per Song, worst first: how many are about the notes the catalog has now
and how many about older ones, their reasons, and each report's note.

    tools/melody-lab/.venv/bin/python -I tools/catalog/song_reports.py song-reports.json

The rows are D1's `song_reports` table, exported by the owner (docs/agents/web.md, Reports and
take-downs): wrangler's `d1 execute --json` output, a JSON list of rows, or a CSV with the table's
columns. A report's `song_version` is the 16 hex digits in the name of the notes file the reporter
heard (`apps/web/public/catalog/notes/<id>-<version>.json`). Once a Song's notes are fixed, its
earlier reports are about notes the catalog no longer has, so Songs rank by the reports on their
notes now, then by all their reports, then by the newest.

Run it with python -I: the rows are untrusted input.
"""
import argparse
import collections
import csv
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "apps/web/public/catalog"
# The reasons a report can give, as `SONG_REPORT_REASONS` in apps/web/src/lib/song-report.ts.
REASONS = ("wrong_notes", "wrong_sound", "wrong_title", "other")
NOTES_FILE = re.compile(r"-([0-9a-f]{16})\.json$")
# A note is the reporter's own text: control characters could rewrite the terminal.
CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]+")


def read_rows(path):
    """The `song_reports` rows in an export: wrangler's --json output, a JSON list, or a CSV."""
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".csv":
        return list(csv.DictReader(text.splitlines()))
    data = json.loads(text)
    if isinstance(data, dict):
        data = [data]
    # wrangler d1 execute --json: one {"results": [...], "success": ..., "meta": ...} per statement.
    if data and all(isinstance(item, dict) and "results" in item for item in data):
        return [row for statement in data for row in statement["results"]]
    return data


def catalog_songs(catalog=CATALOG):
    """Each catalog Song's id: its title and the version of the notes it has now."""
    indexes = sorted(catalog.glob("songs-*.json"))
    if len(indexes) != 1:
        sys.exit(f"Expected one songs-*.json in {catalog}, found {len(indexes)}")
    songs = {}
    for song in json.loads(indexes[0].read_text(encoding="utf-8")):
        match = NOTES_FILE.search(song["notesPath"])
        songs[song["id"]] = (song["title"], match.group(1) if match else None)
    return songs


def by_song(rows, songs):
    """One entry per Song reported, worst first, each with its reports newest first."""
    reported = collections.defaultdict(list)
    for row in rows:
        reported[str(row["song_id"])].append(row)
    entries = []
    for song_id, reports in reported.items():
        title, version = songs.get(song_id, (None, None))
        reports.sort(key=lambda row: int(float(row["created_at"])), reverse=True)
        now = [row for row in reports if row["song_version"] == version]
        entries.append({
            "song_id": song_id,
            "title": title,
            "reports": reports,
            "now": len(now),
            "older": len(reports) - len(now),
            "reasons": collections.Counter(row["reason"] for row in now),
            "newest": int(float(reports[0]["created_at"])),
            "version": version,
        })
    entries.sort(key=lambda entry: (-entry["now"], -len(entry["reports"]), -entry["newest"]))
    return entries


def when(created_at):
    moment = datetime.datetime.fromtimestamp(int(float(created_at)) / 1000, datetime.timezone.utc)
    return moment.strftime("%Y-%m-%d %H:%M")


def clean(note):
    return CONTROL.sub(" ", note).strip() if note else ""


def report(entries):
    """The list as text, one block per Song."""
    lines = []
    for rank, entry in enumerate(entries, 1):
        title = entry["title"] or "(not in the catalog)"
        lines.append(f"{rank}. {entry['song_id']} · {title}")
        reasons = ", ".join(f"{entry['reasons'][r]} {r}" for r in REASONS if entry["reasons"][r])
        now = f"{entry['now']} on its notes now" + (f" ({reasons})" if reasons else "")
        lines.append(f"   {now} · {entry['older']} on older notes")
        for row in entry["reports"]:
            which = "now  " if row["song_version"] == entry["version"] else "older"
            lines.append(f"   {when(row['created_at'])}  {which}  {row['reason']:<11}  {clean(row.get('note'))}".rstrip())
        lines.append("")
    return "\n".join(lines) if lines else "No Song reports."


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("rows", type=Path, help="the exported song_reports rows (.json or .csv)")
    parser.add_argument("--catalog", type=Path, default=CATALOG, help="the web app's public catalog")
    args = parser.parse_args()
    print(report(by_song(read_rows(args.rows), catalog_songs(args.catalog))))


if __name__ == "__main__":
    main()

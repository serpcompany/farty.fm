import csv
import datetime
import hashlib
import json
import re
import sys
import tarfile
import urllib.request

RECORD = "https://zenodo.org/api/records/15571083"
FILES = ("PDMX.csv", "mid.tar.gz")
MIDI_PATH = re.compile(r"\./mid/\d+/\d+/[A-Za-z0-9]+\.mid")


def file_hash(path, algorithm):
    h = hashlib.new(algorithm)
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def read_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def fetch_dataset(cache):
    cache.mkdir(parents=True, exist_ok=True)
    record_file = cache / "zenodo-record.json"
    if not record_file.exists():
        with urllib.request.urlopen(RECORD) as r:
            record_file.write_bytes(r.read())
    published = {f["key"]: f["checksum"].removeprefix("md5:") for f in read_json(record_file)["files"]}
    downloads_file = cache / "downloads.json"
    downloads = read_json(downloads_file, {})
    out = {}
    for name in FILES:
        path = cache / name
        if not path.exists():
            print(f"downloading {name} into {cache} ...", flush=True)
            part = path.with_suffix(path.suffix + ".part")
            urllib.request.urlretrieve(f"{RECORD}/files/{name}/content", part)
            part.rename(path)
        if name not in downloads:
            downloads[name] = {"downloaded": datetime.date.fromtimestamp(path.stat().st_mtime).isoformat()}
        md5 = file_hash(path, "md5")
        out[name] = {"path": path, "md5": md5, "published_md5": published[name], "downloaded": downloads[name]["downloaded"]}
        if md5 != published[name]:
            sys.exit(f"error: {path} has md5 {md5}, Zenodo publishes {published[name]}; delete it and run again")
    downloads_file.write_text(json.dumps(downloads, indent=1) + "\n", encoding="utf-8", newline="\n")
    return out


def read_rows(csv_path):
    with open(csv_path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def keep_member(out, name, data, sha256):
    dest = out / name
    if dest.is_file() and file_hash(dest, "sha256") == sha256:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    part.write_bytes(data)
    part.replace(dest)


def extract(archive, members, out):
    for m in members:
        if not MIDI_PATH.fullmatch(m):
            raise ValueError(f"unexpected MIDI path {m!r}")
    want, member_sha256 = set(members), {}
    if not want:
        return member_sha256
    print(f"reading {len(want)} MIDI files from {archive.name} ...", flush=True)
    with tarfile.open(archive, "r|gz") as tar:
        for info in tar:
            name = "./" + info.name.removeprefix("./")
            if name in want and info.isfile():
                data = tar.extractfile(info).read()
                member_sha256[name] = hashlib.sha256(data).hexdigest()
                keep_member(out, name, data, member_sha256[name])
                want.discard(name)
                if not want:
                    break
    return member_sha256

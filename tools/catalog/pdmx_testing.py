import contextlib
import hashlib
import io
import tempfile
from pathlib import Path

import pdmx
from analysis import ROOT

HERE = Path(__file__).resolve().parent
PD = "https://creativecommons.org/publicdomain/mark/1.0/"
SCORE = ROOT / "catalog/midi/pdmx-twinkle.mid"
ARCHIVE = {"md5": "m", "published_md5": "m", "downloaded": "2026-10-21"}
PADDED_BY_TWO_BEATS = ["the first bar is a pickup padded with silence: every track rests 2 beats after its notes"]


def row(title, sid="1", rating="0.0", views="0", ratings="0", song_name="NA", tracks="1", conflict="False",
        license="publicdomain", license_url=PD, mid=None):
    return {
        "title": title, "song_name": song_name, "metadata": f"./metadata/1/{sid}.json", "rating": rating,
        "n_views": views, "n_ratings": ratings, "n_tracks": tracks, "license_conflict": conflict,
        "license": license, "license_url": license_url, "mid": f"./mid/1/1/Qm{sid}.mid" if mid is None else mid,
    }


def titles(text):
    return pdmx.read_titles(text)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def quiet():
    return contextlib.redirect_stdout(io.StringIO())


def temp_dir(test):
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    return Path(tmp.name)

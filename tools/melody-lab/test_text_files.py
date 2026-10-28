import tempfile
import unittest
from pathlib import Path
from unittest import mock

import export_golden
from melody import load_catalog


class TextFiles(unittest.TestCase):
    def test_reads_catalog_titles_as_utf8(self):
        titles = {c["id"]: c["title"] for c, _ in load_catalog()}
        self.assertEqual((titles["frere"], titles["furelise"]), ("Frère Jacques", "Für Elise"))

    def test_writes_golden_json_as_utf8_with_unix_line_endings(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(export_golden, "GOLDEN", Path(tmp)):
            export_golden.write("x.json", {"title": "Frère Jacques"})
            data = (Path(tmp) / "x.json").read_bytes()
        self.assertEqual(data, '{\n  "title": "Frère Jacques"\n}\n'.encode())

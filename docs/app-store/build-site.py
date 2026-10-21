#!/usr/bin/env python3
"""Builds the public privacy and support pages from privacy-policy.md and support.md.

Run by .github/workflows/pages.yml, which publishes the output to
https://serpcompany.github.io/farty.fm/. Usage: build-site.py <output folder>
"""
import pathlib
import shutil
import sys

import markdown

HERE = pathlib.Path(__file__).parent
PAGES = {"privacy": "privacy-policy.md", "support": "support.md"}
TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="icon" type="image/png" href="{root}assets/icon-64.png">
<link rel="apple-touch-icon" href="{root}assets/icon-180.png">
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; }}
  a {{ color: #0a84ff; }}
  .logo {{ display: block; width: 72px; height: 72px; border-radius: 16px; }}
</style>
</head>
<body>
<a href="{root}"><img class="logo" src="{root}assets/icon-180.png" alt="Pedos"></a>
{body}
</body>
</html>
"""


def main() -> None:
    out = pathlib.Path(sys.argv[1])
    for slug, source in PAGES.items():
        text = (HERE / source).read_text()
        title = text.splitlines()[0].lstrip("# ").strip()
        page = out / slug / "index.html"
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text(TEMPLATE.format(title=title, root="../", body=markdown.markdown(text)))
    shutil.copytree(HERE / "site-assets", out / "assets", dirs_exist_ok=True)
    (out / "index.html").write_text(
        TEMPLATE.format(
            title="Pedos",
            root="",
            body='<h1>Pedos</h1><p><a href="support/">Support</a> · <a href="privacy/">Privacy Policy</a></p>',
        )
    )


if __name__ == "__main__":
    main()

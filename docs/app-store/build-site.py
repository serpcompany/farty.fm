#!/usr/bin/env python3
"""Builds the public privacy and support pages from privacy-policy.md and support.md.

Run by .github/workflows/pages.yml, which publishes the output to
https://serpcompany.github.io/pedos-app/. Usage: build-site.py <output folder>
"""
import pathlib
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
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; }}
  a {{ color: #0a84ff; }}
</style>
</head>
<body>
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
        page.write_text(TEMPLATE.format(title=title, body=markdown.markdown(text)))
    (out / "index.html").write_text(
        TEMPLATE.format(
            title="Pedos",
            body='<h1>Pedos</h1><p><a href="support/">Support</a> · <a href="privacy/">Privacy Policy</a></p>',
        )
    )


if __name__ == "__main__":
    main()

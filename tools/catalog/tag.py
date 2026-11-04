"""Every Song's kind, origin and fame (#383, from #381's research): the four fields `kind`, `origin`,
`fame` and `well_known` in catalog/catalog.json, from what Wikipedia, Wikidata, The Session and
PDMX say about the tune.

    python3 -I tools/catalog/tag.py fetch
    python3 -I tools/catalog/tag.py apply
    python3 -I tools/catalog/tag.py check
    python3 -I tools/catalog/tag.py guess --batch tools/catalog/composers-08.json

`fetch` looks every Song up and writes what it found to tag-signals.json: the tune's Wikipedia page
(its categories, its Wikidata genre and country, and 12 months of its pageviews), the composer's
page (categories and citizenship), the tune's type on The Session when the composer lookup cites
it, and the views of every PDMX score with the Song's title. It asks at most once a second, and
caches every answer in --cache, so running it again asks nothing. `apply` reads only
tag-signals.json, the catalog's composers and tag-hand.json: it gives each Song its four fields by the
rules below, a hand-set value winning, and writes tags.report.md, which gives each tag's source.
`check` fails when a Song's fields aren't apply's, its kind isn't one of KINDS, its signals were
fetched with another composer or composer_source, or a composer batch's kind or origin isn't the
Song's tag. `guess` writes the rules' kind and origin into a composer batch's records that have
neither, as the lookup's first guess: only a starting point, which never beats the rules. Only
tag-hand.json does. tools/catalog/README.md has when to run each.
"""
import argparse
import csv
import difflib
import hashlib
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE)]

import composers  # noqa: E402
import pdmx  # noqa: E402

CATALOG = ROOT / "catalog/catalog.json"
SIGNALS = HERE / "tag-signals.json"
HAND = HERE / "tag-hand.json"
REPORT = HERE / "tags.report.md"
TOOL = "tools/catalog/tag.py"

# The seven kinds, one per Song. Compose shows them as chips, in this order (#381).
KINDS = ("Christmas", "Kids", "Hymns", "Anthems", "Classical", "Songs", "Fiddle tunes")
TAG_FIELDS = ("kind", "origin", "fame", "well_known")
# Who may set a tag by hand in tag-hand.json, and why: each record says which review found it.
HAND_FIELDS = ("kind", "origin", "well_known")
# A hand-set value's `source`: the page that supports it. Needed for an origin, optional for the rest.
HAND_SOURCE_NEEDED = ("origin",)
FOUND_BY = ("known miss", "fallback kind", "signals disagree", "near miss", "hand check")

# Well known: both signals agree, or one is very strong (#381's rule).
WELL_KNOWN_BOTH = (20_000, 200)  # pageviews and PDMX views, both at least
WELL_KNOWN_PAGEVIEWS = 150_000
WELL_KNOWN_PDMX = 5_000

# ---------------------------------------------------------------- origin words

# Each word a tradition, category or citizenship gives, and the origin it means: today's
# demonym for a country, or a tradition of its own ("African American"). A region's tradition
# is its country's, so a search for "Scottish" finds Shetland tunes.
DEMONYMS = {
    "African American": "African American", "African-American": "African American",
    "American": "American", "Argentine": "Argentine", "Australian": "Australian", "Austrian": "Austrian",
    "Bahamian": "Bahamian", "Basque": "Basque", "Belgian": "Belgian", "Bohemian": "Czech", "Brazilian": "Brazilian",
    "Breton": "French", "British": "British", "Bulgarian": "Bulgarian", "Canadian": "Canadian",
    "Catalan": "Catalan", "Chilean": "Chilean", "Chinese": "Chinese", "Cornish": "English", "Croatian": "Croatian",
    "Cuban": "Cuban", "Czech": "Czech", "Danish": "Danish", "Dutch": "Dutch", "English": "English",
    "Estonian": "Estonian", "Finnish": "Finnish", "Flemish": "Belgian", "French": "French",
    "French Canadian": "French Canadian", "French-Canadian": "French Canadian", "Galician": "Spanish",
    "German": "German", "Greek": "Greek", "Hungarian": "Hungarian", "Icelandic": "Icelandic", "Irish": "Irish",
    "Israeli": "Israeli", "Italian": "Italian", "Jamaican": "Jamaican", "Japanese": "Japanese", "Jewish": "Jewish",
    "Korean": "Korean", "Latvian": "Latvian", "Lithuanian": "Lithuanian", "Manx": "Manx", "Mexican": "Mexican",
    "Neapolitan": "Italian", "New Zealand": "New Zealand", "Northumbrian": "English", "Norwegian": "Norwegian",
    "Polish": "Polish", "Portuguese": "Portuguese", "Prussian": "German", "Puerto Rican": "Puerto Rican",
    "Romanian": "Romanian", "Russian": "Russian", "Scots": "Scottish", "Scottish": "Scottish", "Serbian": "Serbian",
    "Shetland": "Scottish", "Sicilian": "Italian", "Slovak": "Slovak", "Slovenian": "Slovenian", "Spanish": "Spanish",
    "Swedish": "Swedish", "Swiss": "Swiss", "Ukrainian": "Ukrainian", "Venetian": "Italian", "Welsh": "Welsh",
    "Albanian": "Albanian", "Armenian": "Armenian", "Bavarian": "German", "Belarusian": "Belarusian",
    "Bolivian": "Bolivian", "Colombian": "Colombian", "Cuban-American": "American", "Cypriot": "Cypriot",
    "Dominican": "Dominican", "Ecuadorian": "Ecuadorian", "Egyptian": "Egyptian", "Faroese": "Faroese",
    "Filipino": "Filipino", "Georgian": "Georgian", "Ghanaian": "Ghanaian", "Haitian": "Haitian",
    "Hawaiian": "Hawaiian", "Indian": "Indian", "Indonesian": "Indonesian", "Iranian": "Iranian",
    "Lebanese": "Lebanese", "Luxembourgish": "Luxembourgish", "Macedonian": "Macedonian", "Maltese": "Maltese",
    "Moravian": "Czech", "Native American": "Native American", "Nigerian": "Nigerian", "Panamanian": "Panamanian",
    "Paraguayan": "Paraguayan", "Persian": "Iranian", "Peruvian": "Peruvian", "Silesian": "Polish",
    "South African": "South African", "Syrian": "Syrian", "Trinidadian": "Trinidadian", "Turkish": "Turkish",
    "Tyrolean": "Austrian", "Uruguayan": "Uruguayan", "Venezuelan": "Venezuelan", "Vietnamese": "Vietnamese",
}
# Wikidata's countries and old states, by English label, and the origin each means today.
COUNTRIES = {
    "Argentina": "Argentine", "Australia": "Australian", "Austria": "Austrian", "Austrian Empire": "Austrian",
    "Archduchy of Austria": "Austrian", "Habsburg monarchy": "Austrian", "Cisleithania": "Austrian",
    "Austria-Hungary": "Austrian", "Bohemia": "Czech", "Kingdom of Bohemia": "Czech", "Czech Republic": "Czech",
    "Czechoslovakia": "Czech", "Brazil": "Brazilian", "Belgium": "Belgian", "Canada": "Canadian",
    "Chile": "Chilean", "China": "Chinese", "Cuba": "Cuban", "Denmark": "Danish", "Denmark–Norway": "Danish",
    "Kingdom of Denmark": "Danish", "England": "English", "Kingdom of England": "English", "Finland": "Finnish",
    "Grand Duchy of Finland": "Finnish", "France": "French", "Kingdom of France": "French",
    "French First Republic": "French", "First French Empire": "French", "Second French Empire": "French",
    "French Second Republic": "French", "French Third Republic": "French", "July Monarchy": "French",
    "Bourbon Restoration in France": "French", "Germany": "German", "German Empire": "German",
    "Kingdom of Prussia": "German", "Prussia": "German", "Electorate of Saxony": "German",
    "Kingdom of Saxony": "German", "Kingdom of Bavaria": "German", "Electorate of Bavaria": "German",
    "Holy Roman Empire": "German", "German Confederation": "German", "North German Confederation": "German",
    "Weimar Republic": "German", "Electorate of Hanover": "German", "Kingdom of Hanover": "German",
    "Kingdom of Württemberg": "German", "Duchy of Saxe-Weimar": "German", "Greece": "Greek",
    "Hungary": "Hungarian", "Kingdom of Hungary": "Hungarian", "Iceland": "Icelandic", "Ireland": "Irish",
    "Kingdom of Ireland": "Irish", "Republic of Ireland": "Irish", "Irish Free State": "Irish",
    "Israel": "Israeli", "Italy": "Italian", "Kingdom of Italy": "Italian", "Republic of Venice": "Italian",
    "Kingdom of Naples": "Italian", "Kingdom of the Two Sicilies": "Italian", "Papal States": "Italian",
    "Grand Duchy of Tuscany": "Italian", "Kingdom of Sardinia": "Italian", "Duchy of Milan": "Italian",
    "Duchy of Modena and Reggio": "Italian", "Republic of Genoa": "Italian", "Japan": "Japanese",
    "Korea": "Korean", "South Korea": "Korean", "Mexico": "Mexican", "Netherlands": "Dutch",
    "Kingdom of the Netherlands": "Dutch", "Dutch Republic": "Dutch", "Norway": "Norwegian",
    "Union between Sweden and Norway": "Norwegian", "Poland": "Polish", "Congress Poland": "Polish",
    "Polish–Lithuanian Commonwealth": "Polish", "Kingdom of Poland": "Polish", "Duchy of Warsaw": "Polish",
    "Second Polish Republic": "Polish", "Portugal": "Portuguese", "Kingdom of Portugal": "Portuguese",
    "Romania": "Romanian", "Kingdom of Romania": "Romanian", "Russia": "Russian", "Russian Empire": "Russian",
    "Soviet Union": "Russian", "Tsardom of Russia": "Russian",
    "Russian Soviet Federative Socialist Republic": "Russian",
    "Scotland": "Scottish", "Kingdom of Scotland": "Scottish", "Spain": "Spanish", "Crown of Castile": "Spanish",
    "Crown of Aragon": "Spanish", "Kingdom of Castile": "Spanish", "Spanish Empire": "Spanish",
    "Sweden": "Swedish", "Kingdom of Sweden": "Swedish", "Swedish Empire": "Swedish", "Switzerland": "Swiss",
    "Ukraine": "Ukrainian", "United Kingdom": "British", "Kingdom of Great Britain": "British",
    "United Kingdom of Great Britain and Ireland": "British", "Great Britain": "British",
    "United States": "American", "United States of America": "American", "Confederate States of America": "American",
    "Thirteen Colonies": "American", "Wales": "Welsh", "Kingdom of Wales": "Welsh",
    "Uruguay": "Uruguayan", "Peru": "Peruvian", "Venezuela": "Venezuelan", "Colombia": "Colombian",
    "Bolivia": "Bolivian", "Ecuador": "Ecuadorian", "Paraguay": "Paraguayan", "Philippines": "Filipino",
    "India": "Indian", "British Raj": "Indian", "Turkey": "Turkish", "Ottoman Empire": "Turkish",
    "Armenia": "Armenian", "Georgia": "Georgian", "Egypt": "Egyptian", "South Africa": "South African",
    "Union of South Africa": "South African", "Belarus": "Belarusian", "Malta": "Maltese", "Cyprus": "Cypriot",
    "Luxembourg": "Luxembourgish", "Faroe Islands": "Faroese", "Iran": "Iranian", "Lebanon": "Lebanese",
    "Syria": "Syrian", "Haiti": "Haitian", "Dominican Republic": "Dominican", "Panama": "Panamanian",
    "Trinidad and Tobago": "Trinidadian", "Ghana": "Ghanaian", "Nigeria": "Nigerian", "Albania": "Albanian",
    "Vietnam": "Vietnamese", "Indonesia": "Indonesian", "Bulgaria": "Bulgarian", "Croatia": "Croatian",
    "Serbia": "Serbian", "Slovakia": "Slovak", "Slovenia": "Slovenian", "Estonia": "Estonian", "Latvia": "Latvian",
    "Lithuania": "Lithuanian", "Jamaica": "Jamaican", "Bahamas": "Bahamian", "The Bahamas": "Bahamian",
    "New Zealand": "New Zealand", "Puerto Rico": "Puerto Rican", "Isle of Man": "Manx",
    "Hawaiian Kingdom": "Hawaiian", "Kingdom of Hawaii": "Hawaiian", "Kingdom of Hawaiʻi": "Hawaiian",
    "Prince-Archbishopric of Salzburg": "Austrian", "Archbishopric of Salzburg": "Austrian", "Salzburg": "Austrian",
    "British Empire": "British", "Hamburg": "German", "Brandenburg-Prussia": "German",
    "Electorate of Cologne": "German", "Duchy of Saxe-Eisenach": "German",
    "Kingdom of Lombardy–Venetia": "Italian", "Duchy of Parma and Piacenza": "Italian",
    "Republic of Geneva": "Swiss",
    # Antwerp and Brussels, the Flemish south of the Low Countries: Susato's.
    "Habsburg Netherlands": "Belgian",
}
_DEMONYM = "|".join(sorted((re.escape(d) for d in DEMONYMS), key=len, reverse=True))
_CENTURY = r"(?:\d+(?:st|nd|rd|th)-century |Medieval |Renaissance |Baroque )?"
# A tune's category that gives where it's from: "Irish folk songs", "English Christmas carols".
# Not a language ("English-language songs") and not a subject ("Songs about Scotland").
TUNE_ORIGIN = re.compile(rf"^{_CENTURY}({_DEMONYM})(?! ?-language)\b(?:[ -][\w'’-]+)*? "
                         r"(?:songs?|folk songs|ballads|hymns|carols|anthems|nursery rhymes|rhymes|tunes|dances|"
                         r"music|compositions|marches|airs|lullabies|spirituals|shanties)\b", re.I)
# A composer's category that gives where they're from: "Scottish fiddlers", "19th-century Polish composers".
PERSON_ORIGIN = re.compile(rf"^{_CENTURY}({_DEMONYM})\b(?:[ -][\w'’-]+)*? "
                           r"(?:composers|fiddlers|violinists|pipers|bagpipe players|harpers|harpists|musicians|"
                           r"songwriters|hymnwriters|organists|pianists|harpsichordists|lutenists|singers|"
                           r"conductors|bandleaders|dancing masters|cellists|guitarists|music publishers)\b", re.I)

# ---------------------------------------------------------------- kind words

# What marks each kind in a tune's Wikipedia categories and Wikidata genres, and its points:
# 2 for a category that says what the tune is, 1 for one that only hints ("1867 songs",
# "Children's songs", sung by children but not written for them). A category counts for the
# first rule it matches only, so "Christmas songs" is Christmas, not Songs. A stub category
# counts as its subject: "Folk dance stubs" is "Folk dance".
CATEGORY_KINDS = (
    (None, 0, re.compile(r"^(?:songs|works|music|compositions) (?:about|with|based on|written|in the style of|"
                         r"published|recorded|containing)\b|^songs about|singles\b|number-one|"
                         r"christmas number|\brecordings\b|^public domain|\bstandards\b", re.I)),
    ("Christmas", 2, re.compile(r"christmas (?:songs|carols|hymns|music)|\bcarols?\b|advent (?:songs|hymns)|"
                                r"nativity (?:songs|hymns)|epiphany (?:songs|hymns)", re.I)),
    # A Christmas category that isn't about the music only hints: The Nutcracker is "Christmas onstage".
    ("Christmas", 1, re.compile(r"christmas|\badvent\b|nativity|\byule|epiphany", re.I)),
    ("Kids", 2, re.compile(r"nursery rhymes?|songs for children|singing games|lullab|playground|counting-out|"
                           r"clapping games|mother goose|children's (?:poetry|literature)", re.I)),
    ("Kids", 1, re.compile(r"children's (?:songs|music|hymns)", re.I)),
    # State songs and Civil War songs aren't anthems (#381); "Patriotic songs" counts half.
    # A march is a march, though a named composer wrote it: Sousa's are Anthems, not Classical.
    ("Anthems", 3, re.compile(r"\bmarches\b|bugle calls", re.I)),
    ("Anthems", 2, re.compile(r"\b(?!state\b)\w+ anthems?\b|patriotic hymns|military music", re.I)),
    ("Anthems", 1, re.compile(r"^anthems$|patriotic songs", re.I)),
    ("Hymns", 2, re.compile(r"\bhymns?\b|hymnody|spirituals|spiritual songs|gospel|psalms?\b|christian songs|"
                            r"religious (?:songs|music)|chorales?\b|church music|sacred harp|shaker|christian music|"
                            r"liturgical|marian antiphons|plainsong|gregorian", re.I)),
    ("Fiddle tunes", 2, re.compile(r"fiddle|\breels?\b|\bjigs?\b|hornpipes?|strathspeys?|bagpipe|"
                                   r"pipe (?:music|tunes)|dance tunes|country danc|ceilidh|morris danc|contra danc|"
                                   r"session tunes|folk danc|\bpolkas?\b", re.I)),
    ("Classical", 1, re.compile(r"^(?:\d{3,4}s?|\d+(?:st|nd|rd|th)-century) compositions$|"
                                r"^compositions in [a-g]\b", re.I)),
    ("Classical", 2, re.compile(r"compositions|\boperas?\b|\barias?\b|symphon|concert[oi]s?\b|sonatas?|"
                                r"\blieder\b|art songs|\bballets?\b|\bmass(?:es)?\b|oratorios?|cantatas?|"
                                r"chamber music|(?:piano|organ|harpsichord|lute|guitar|violin) (?:music|pieces|works)|"
                                r"[ée]tudes|nocturnes|madrigals|motets|classical music|\bsuites?\b|preludes|"
                                r"\bwaltzes\b|minuets|requiems|baroque|renaissance music|overtures|serenades", re.I)),
    ("Songs", 2, re.compile(r"folk songs?|ballads?|shant(?:y|ies)|drinking songs|music hall|minstrel|parlou?r|"
                            r"jacobite|waulking|work songs|laments|popular songs|tin pan alley|vaudeville|"
                            r"student songs|war songs|songs of the american (?:civil|revolutionary) war|"
                            r"\bairs\b|broadside|love songs|cowboy|western music", re.I)),
    ("Songs", 1, re.compile(r"\bsongs?\b", re.I)),
)
# A category that settles the kind whatever else scores: a national anthem is an anthem, and a carol
# is Christmas unless it's also a national anthem (#381).
NATIONAL_ANTHEM = re.compile(r"\bnational anthems?\b", re.I)
CAROL = re.compile(r"\bcarols?\b", re.I)
# A tie goes to the more specific kind.
TIE_ORDER = ("Christmas", "Anthems", "Kids", "Hymns", "Fiddle tunes", "Songs", "Classical")
# A category that names the tune's page as something else: a film, a book, a stage work, a building,
# a whole genre of music or a person (is_person).
NOT_A_TUNE = re.compile(r"\bfilms?\b|television|episodes|novels?\b|\bbooks?\b|\bpeople\b|\bplays\b|albums|"
                        r"\bmusicals\b|operettas|\boperas\b|video games|feast days|festivals|holidays|days of the year|"
                        r"treatises|essays|works about|"
                        r"organizations|venues|establishments|buildings|music genres|styles of music|"
                        r"musical terminology|disambiguation", re.I)
# A category that names the page as a tune or song, for a page found by the Song's title alone.
A_TUNE = re.compile(r"\bsongs?\b|tunes?\b|hymns?\b|carols?\b|compositions|anthems?\b|marches|rhymes?\b|"
                    r"ballads?\b|shant|\bairs?\b|danc|reels|jigs|hornpipes|strathspeys|waltz|\boperas?\b|\barias?\b|"
                    r"lieder|spirituals|psalms?\b|chorales?\b|lullab|singing games|madrigals?\b|\bpieces\b|"
                    r"sonatas?|symphon|concert[oi]|nocturnes|preludes|works by|music", re.I)

# Words in a Song's title, and the kind each one points to.
TITLE_KINDS = (
    ("Christmas", re.compile(r"\b(?:christmas|xmas|no[eë]l|nowell|carol|nativity|bethlehem|manger|yule|wassail|"
                             r"jingle|santa|reindeer|tannenbaum|weihnacht\w*|jul\w*sang|navidad|kings of orient|"
                             r"three kings|magi|shepherds|advent|good king|holly and the ivy|silent night|"
                             r"stille nacht|first nowell|herald angels)\b", re.I)),
    ("Kids", re.compile(r"\b(?:nursery|lullaby|lullabies|children|kids|baby|teddy|humpty|itsy|bitsy|abc|alphabet|"
                        r"ducklings|piggy|wiegenlied|berceuse)\b", re.I)),
    ("Anthems", re.compile(r"\b(?:anthem|hymne national|national|god save|star[- ]spangled|marseillaise)\b", re.I)),
    # Not "lord": a fiddle tune's Lord is a nobleman ("Lord Lovat's Lament", "My Lord Byron's Maggot").
    ("Hymns", re.compile(r"\b(?:hymn|psalm|jesus|christ|god|holy|praise|saviou?r|hallelujah|alleluia|gloria|"
                         r"kyrie|doxology|chorale|sanctus|agnus dei|ave maria|ave verum|heaven|zion|glory)\b", re.I)),
    ("Fiddle tunes", re.compile(r"\b(?:jig|reel|hornpipe|strathspey|polka|slide|polska|schottische|planxty|"
                                r"set dance|barn ?dance|fling|clog|two[- ]step|quickstep|rant)s?\b", re.I)),
    # A catalog number counts only with its number: "Hob y Deri Danno" is a Welsh song, not Haydn.
    ("Classical", re.compile(r"\b(?:(?:op|opus|bwv|kv|hwv|rv|hob)\.? ?(?:\d+|[ivxl]+\b)|"
                             r"sonata|sonatina|symphony|concerto|nocturne|prelude|"
                             r"[ée]tude|minuet|menuet|gavotte|fugue|aria|overture|rondo|serenade|polonaise|"
                             r"impromptu|invention|partita|sarabande|bourr[ée]e|allemande|courante|gigue|intermezzo|"
                             r"barcarolle|scherzo|toccata|chaconne|variations|adagio|andante|allegro|largo|"
                             r"[a-g](?: flat| sharp)? (?:major|minor)|romanza|valse|waltz in)\b", re.I)),
)
# PDMX's bulk uploads: the picked score's MuseScore artist, and the kind each list holds. "Misc
# tunes" and "Misc Traditional" are folk tunes, which with nothing else said are fiddle tunes.
PDMX_LISTS = {"Misc Christmas": "Christmas", "Misc Children": "Kids", "Misc Praise Songs": "Hymns"}
PDMX_FOLK_LISTS = ("Misc tunes", "Misc Traditional")
# A composer's Wikipedia categories. Fiddlers and pipers write folk tunes, not concert music (#381).
COMPOSER_KINDS = (
    ("Fiddle tunes", re.compile(r"fiddlers|pipers|bagpipe|harpers|dancing masters|folk musicians|traditional music|"
                                r"scottish violinists|irish violinists", re.I)),
    ("Hymns", re.compile(r"hymn ?writers|gospel|hymnal", re.I)),
    ("Songs", re.compile(r"songwriters|minstrel|tin pan alley", re.I)),
    ("Classical", re.compile(r"composers|organists|harpsichordists|lutenists|pianists", re.I)),
)
SESSION_TYPES = {"jig", "reel", "slip jig", "hornpipe", "polka", "slide", "waltz", "barndance", "strathspey",
                 "three-two", "mazurka", "march"}

# Points for each signal. A kind gets each signal's points at most once, however many of its
# categories match (the best one's). The highest total wins; a tie goes by TIE_ORDER.
POINTS = {"session": 2, "pdmx list": 2, "title": 1, "composer": 1}  # a category or genre: its rule's

# ---------------------------------------------------------------- fetching

USER_AGENT = "farty.fm-catalog-tags/1.0 (https://github.com/serpcompany/farty.fm; tools/catalog/tag.py)"
PAGEVIEW_MONTHS = ("20251101", "20261031")  # 12 whole months, the same for every Song
DEFAULT_CACHE = Path.home() / ".cache/pedos/tags"
WIKIDATA = "https://www.wikidata.org/w/api.php"
PERSON_SUFFIXES = ("", " (composer)", " (musician)", " (fiddler)", " (violinist)", " (piper)", " (songwriter)")


class Fetcher:
    """GETs JSON at most once every `interval` seconds, from the cache when it has the URL."""

    def __init__(self, cache, interval=1.0, offline=False, opener=None):
        self.cache = Path(cache)
        self.interval = interval
        self.offline = offline
        self.opener = opener or self._open
        self.requests = 0
        self._last = 0.0

    def _open(self, url):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return 200, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, None
            raise

    def get(self, url):
        """The answer's JSON, or None for a 404 (the pageviews API's answer for a page with no views)."""
        path = self.cache / (hashlib.sha256(url.encode()).hexdigest()[:32] + ".json")
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))["body"]
        if self.offline:
            raise LookupError(f"not in the cache: {url}")
        for attempt in range(5):
            wait = self._last + self.interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            self.requests += 1
            try:
                status, body = self.opener(url)
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == 4:
                    raise
                print(f"retrying {url}: {e}", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        self.cache.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"url": url, "status": status, "body": body}, ensure_ascii=False), encoding="utf-8")
        return body


def wiki_page(fetch, lang, title):
    """A Wikipedia page by title, through redirects: its title, categories and Wikidata item, or None."""
    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2", "redirects": "1", "titles": title,
        "prop": "categories|pageprops", "clshow": "!hidden", "cllimit": "max", "ppprop": "wikibase_item|disambiguation",
    })
    body = fetch.get(f"https://{lang}.wikipedia.org/w/api.php?{query}")
    pages = (body or {}).get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing") or pages[0].get("invalid") or pages[0].get("ns") != 0:
        return None
    page = pages[0]
    redirects = body["query"].get("redirects", [])
    props = page.get("pageprops", {})
    return {
        "url": f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(page["title"].replace(" ", "_")),
        "title": page["title"],
        "redirected": bool(redirects),
        "fragment": next((r.get("tofragment") for r in redirects if r.get("tofragment")), None),
        "disambiguation": "disambiguation" in props,
        "categories": [c["title"].split(":", 1)[1] for c in page.get("categories", [])],
        "item": props.get("wikibase_item"),
    }


def wiki_url_title(url):
    """(lang, title) of a Wikipedia article URL, or None for a search page or another site."""
    parts = urllib.parse.urlparse(url or "")
    m = re.fullmatch(r"([a-z-]+)\.wikipedia\.org", parts.netloc)
    if not m or not parts.path.startswith("/wiki/"):
        return None
    return m.group(1), urllib.parse.unquote(parts.path[len("/wiki/"):]).replace("_", " ")


def is_person(page):
    # "1800 deaths", "1st-century BC births", but not "Songs inspired by deaths".
    return any(re.search(r"^\d[\w-]*(?: BC)? (?:births|deaths)$|^Year of (?:birth|death)|^Living people", c)
               for c in page["categories"])


def wikidata_claims(fetch, items, props):
    """Each item's values of each property, as Wikidata ids, in 50s."""
    out = {}
    items = sorted(set(items))
    for i in range(0, len(items), 50):
        query = urllib.parse.urlencode({"action": "wbgetentities", "format": "json", "props": "claims",
                                        "ids": "|".join(items[i:i + 50])})
        for qid, entity in (fetch.get(f"{WIKIDATA}?{query}") or {}).get("entities", {}).items():
            claims = entity.get("claims", {})
            out[qid] = {p: [c["mainsnak"]["datavalue"]["value"]["id"] for c in claims.get(p, [])
                            if c.get("rank") != "deprecated" and c["mainsnak"].get("datavalue", {}).get("type") ==
                            "wikibase-entityid"] for p in props}
    return out


def wikidata_labels(fetch, items):
    out = {}
    items = sorted(set(items))
    for i in range(0, len(items), 50):
        query = urllib.parse.urlencode({"action": "wbgetentities", "format": "json", "props": "labels",
                                        "languages": "en", "ids": "|".join(items[i:i + 50])})
        for qid, entity in (fetch.get(f"{WIKIDATA}?{query}") or {}).get("entities", {}).items():
            label = entity.get("labels", {}).get("en", {}).get("value")
            if label:
                out[qid] = label
    return out


def english_sitelink(fetch, item):
    query = urllib.parse.urlencode({"action": "wbgetentities", "format": "json", "props": "sitelinks",
                                    "sitefilter": "enwiki", "ids": item})
    entity = (fetch.get(f"{WIKIDATA}?{query}") or {}).get("entities", {}).get(item, {})
    return entity.get("sitelinks", {}).get("enwiki", {}).get("title")


def pageviews(fetch, title):
    """The page's views on English Wikipedia by people (not bots) over PAGEVIEW_MONTHS."""
    article = urllib.parse.quote(title.replace(" ", "_"), safe="")
    body = fetch.get("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/"
                     f"all-access/user/{article}/monthly/{PAGEVIEW_MONTHS[0]}/{PAGEVIEW_MONTHS[1]}")
    return sum(item["views"] for item in (body or {}).get("items", []))


def session_type(fetch, urls, names):
    """The tune's type on The Session, from the first tune page or search the composer lookup cites."""
    for url in urls:
        parts = urllib.parse.urlparse(url or "")
        if parts.netloc != "thesession.org":
            continue
        m = re.fullmatch(r"/tunes/(\d+)", parts.path)
        if m:
            body = fetch.get(f"https://thesession.org/tunes/{m.group(1)}?format=json")
            if body and body.get("type"):
                return body["type"]
        elif parts.path == "/tunes/search":
            q = urllib.parse.parse_qs(parts.query).get("q", [""])[0]
            query = urllib.parse.urlencode({"q": q, "format": "json"})
            body = fetch.get("https://thesession.org/tunes/search?" + query)
            for tune in (body or {}).get("tunes", []):
                if pdmx.match_key(tune.get("name", "")) in names:
                    return tune.get("type")
    return None


def song_names(catalog):
    """Each Song's names, as pdmx.match_key compares them: its title and its titles file's aliases."""
    names = {e["id"]: {pdmx.match_key(e["title"])} for e in catalog}
    files = {e.get("import", {}).get("titles") for e in catalog} - {None}
    for f in sorted(files):
        for t in pdmx.read_titles((ROOT / f).read_text(encoding="utf-8")):
            if t.id in names:
                names[t.id] |= set(t.names)
    return {k: v - {""} for k, v in names.items()}


def pdmx_signals(csv_path, catalog, names):
    """Each Song's PDMX views over every score with one of its names, and the bulk list its own score is in."""
    by_name = {}
    for sid, ns in names.items():
        for n in ns:
            by_name.setdefault(n, set()).add(sid)
    own = {e["source"].get("dataset_path"): e["id"] for e in catalog}
    views = Counter()
    scores = Counter()
    lists = {}
    csv.field_size_limit(1 << 30)
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            hit = set()
            for _, key in pdmx.row_keys(row):
                hit |= by_name.get(key, set())
            for sid in hit:
                views[sid] += int(float(row["n_views"] or 0))
                scores[sid] += 1
            if row["mid"] in own and row.get("artist_name", "").startswith("Misc "):
                lists[own[row["mid"]]] = row["artist_name"]
    return {e["id"]: {"pdmx_views": views[e["id"]], "pdmx_scores": scores[e["id"]],
                      "pdmx_list": lists.get(e["id"])} for e in catalog}


def batch_records(directory=HERE):
    """Every composer batch's record by Song id."""
    return {r["id"]: r for records in composers.read_batches(directory).values() for r in records}


def first_person(composer):
    if not composer or composer == composers.UNKNOWN or composers.TRADITIONAL.fullmatch(composer):
        return None
    return composer.split(" and ")[0]


def fetch_signals(catalog, fetch, csv_path, log=print):
    """What every Song's tags are made from (tag-signals.json)."""
    names = song_names(catalog)
    songs = []
    items = {}  # Wikidata item -> the page records that carry it
    persons = {}
    for n, e in enumerate(catalog, 1):
        if n % 50 == 0:
            log(f"{n} of {len(catalog)} Songs, {fetch.requests} requests")
        person = first_person(e.get("composer"))
        page, came_from = None, None
        cited = wiki_url_title(e.get("composer_source"))
        if cited:
            lang, title = cited
            page = wiki_page(fetch, lang, title)
            came_from = "composer_source"
            if page and lang != "en" and page["item"]:
                english = english_sitelink(fetch, page["item"])
                if english:
                    page, came_from = wiki_page(fetch, "en", english) or page, "composer_source, its English page"
            if page and (is_person(page) or (person and page["title"] == person)):
                page = None  # the composer's own page: look the tune up by its title
        if page is None:
            page = wiki_page(fetch, "en", e["title"])
            came_from = "title"
        elif not named(page["title"], names[e["id"]]):
            # The cited page may be the tune's under another name, a page it's part of, or another
            # song's: the Song's own title says which.
            found = wiki_page(fetch, "en", e["title"])
            if found and not found["disambiguation"] and not found["fragment"] and found["title"] != page["title"] \
                    and named(found["title"], names[e["id"]]) and about_a_tune(found["categories"]):
                page, came_from = found, "title, for composer_source's page is another's"
            page["title_page"] = None if not found or found["disambiguation"] else {
                "title": found["title"], "fragment": found["fragment"]}
        if page and page["disambiguation"]:
            page = None
        if page:
            page["from"] = came_from
            page["pageviews"] = pageviews(fetch, page["title"]) if page["url"].startswith("https://en.") else None
            if page["item"]:
                items.setdefault(page["item"], []).append(page)
        if person and person not in persons:
            persons[person] = None
            for suffix in PERSON_SUFFIXES:
                found = wiki_page(fetch, "en", person + suffix)
                if found and not found["disambiguation"] and is_person(found):
                    persons[person] = found
                    break
        # Only the cited tune: the lookup's checked list holds the tunes it looked at and turned down.
        # What the signals were fetched with: check fails when the lookup has changed either since.
        songs.append({"id": e["id"], "title": e["title"], "composer": e.get("composer"),
                      "composer_source": e.get("composer_source"),
                      "session": session_type(fetch, [e.get("composer_source")], names[e["id"]]), "page": page})
    claims = wikidata_claims(fetch, list(items) + [p["item"] for p in persons.values() if p and p["item"]],
                             ("P31", "P136", "P495", "P27"))
    labels = wikidata_labels(fetch, [v for c in claims.values() for vs in c.values() for v in vs])

    def labelled(item, prop):
        return [labels.get(v, v) for v in claims.get(item, {}).get(prop, [])]

    for s in songs:
        page = s["page"]
        if page:
            s["page"] = {"url": page["url"], "title": page["title"], "from": page["from"],
                         "redirected": page["redirected"], "fragment": page["fragment"],
                         "categories": page["categories"], "instance_of": labelled(page["item"], "P31"),
                         "genre": labelled(page["item"], "P136"), "country": labelled(page["item"], "P495"),
                         "pageviews": page["pageviews"]}
            if "title_page" in page:
                s["page"]["title_page"] = page["title_page"]
    people = {name: None if p is None else {"url": p["url"], "categories": p["categories"],
                                            "citizenship": labelled(p["item"], "P27")}
              for name, p in sorted(persons.items())}
    counts = pdmx_signals(csv_path, catalog, names)
    for s in songs:
        s.update(counts[s["id"]])
    return {"pageview_months": f"{PAGEVIEW_MONTHS[0]} to {PAGEVIEW_MONTHS[1]}", "songs": songs, "composers": people}


# ---------------------------------------------------------------- the rules


def named(title, names):
    """Whether a page's title is one of the Song's names, without a bracketed disambiguation or a
    catalogue number: "Danny Boy (song)" is Danny Boy's."""
    key = pdmx.match_key(re.sub(r"\s*\([^)]*\)$", "", title))
    keys = set(names) | {_without_number(n) for n in names}
    return key in keys or _without_number(key) in keys


def about_a_tune(categories):
    """Whether a page found by the Song's title is about a tune: it has a song or tune category, and
    none that makes it something else. A song or single from 1930 on ("1990s electronic song stubs")
    is another song with the old tune's name: the catalog's songs are older."""
    return (any(A_TUNE.search(c) for c in categories) and not any(NOT_A_TUNE.search(c) for c in categories)
            and not any(re.match(r"(?:19[3-9]\d|2\d{3})s?\b.*\b(?:songs?|singles)\b", c) for c in categories)
            and not is_person({"categories": categories}))


def own_page(song, names):
    """Whether the Song's page is the tune's own, so its pageviews are the tune's, not a page it's
    part of: no redirect led to a section of a longer page, and the page has one of the Song's names,
    or one close to it, or the Song's title leads to it, or it was found by the Song's title. And it
    has a song or tune category: a page the lookup cites may be the hill a hymn is named for ("Calvary")."""
    page = tune_page(song)
    if not page or page.get("fragment"):
        return False
    if not any(A_TUNE.search(c) for c in page["categories"] + page["genre"] + page["instance_of"]):
        return False
    if named(page["title"], names) or close_name(page["title"], names) or page["from"].startswith("title"):
        return True
    lookup = page.get("title_page")
    return bool(lookup) and lookup["title"] == page["title"] and not lookup["fragment"]


def close_name(title, names):
    """Whether a page's title is one of the Song's names told a little differently: spelled another
    way ("Whiskey in the Jar", "Down by the Salley Gardens", "Oh Shenandoah"), or with words around
    it, two words or more ("Such a Parcel of Rogues in a Nation"; "Clarinet Concerto (Mozart)" for
    Clarinet Concerto in A major K.622). A set or a stage work the Song is part of isn't close:
    "Gnossiennes", "Six moments musicaux", "Babes in Toyland"."""
    key = pdmx.match_key(re.sub(r"\s*\([^)]*\)$", "", title))
    for page_key in {key, _without_number(re.sub(r"\s+op posth$", "", key))}:
        for name in names:
            if difflib.SequenceMatcher(None, page_key, name).ratio() >= 0.85:
                return True
            short, long_ = sorted((page_key.split(), name.split()), key=len)
            if len(short) >= 2 and any(long_[i:i + len(short)] == short for i in range(len(long_) - len(short) + 1)):
                return True
    return False


def _without_number(key):
    return re.sub(r"\s+(?:op|opus|bwv|kv|k|hwv|rv|d|no)\s*\d+.*$", "", key)


def tune_page(song):
    """The Song's page, when it's about a tune: a page the composer lookup cites is, and a page found
    by the title alone must be categorized as a song or tune, and not as a film, book or day."""
    page = song.get("page")
    if not page:
        return None
    if page["from"] == "title" and not about_a_tune(page["categories"] + page["genre"] + page["instance_of"]):
        return None
    return page


def kind_scores(song, entry, people):
    """Each kind's points, and what gave them: {kind: [(points, why), ...]}."""
    scores = {k: [] for k in KINDS}

    def add(kind, signal, why, points=None):
        points = POINTS[signal] if points is None else points
        old = next((i for i, (_, w) in enumerate(scores[kind]) if w.startswith(signal + ":")), None)
        if old is None:
            scores[kind].append((points, f"{signal}: {why}"))
        elif points > scores[kind][old][0]:
            scores[kind][old] = (points, f"{signal}: {why}")

    page = tune_page(song)
    if page:
        for signal, values in (("category", page["categories"]), ("genre", page["genre"] + page["instance_of"])):
            for value in values:
                rule = category_rule(value)
                if rule and rule[0]:
                    add(rule[0], signal, value, rule[1])
    for kind, pattern in TITLE_KINDS:
        m = pattern.search(entry["title"])
        if m:
            add(kind, "title", m.group(0))
    if song.get("pdmx_list") in PDMX_LISTS:
        add(PDMX_LISTS[song["pdmx_list"]], "pdmx list", song["pdmx_list"])
    if song.get("session") in SESSION_TYPES:
        add("Fiddle tunes", "session", song["session"])
    person = people.get(first_person(entry.get("composer")) or "")
    if person:
        for kind, pattern in COMPOSER_KINDS:
            hit = next((c for c in person["categories"] if pattern.search(c)), None)
            if hit:
                add(kind, "composer", hit)
                break
    return scores


def category_rule(category):
    """(kind, points) of the first CATEGORY_KINDS rule a category or genre matches, or None."""
    category = re.sub(r" stubs$", "", category)
    return next(((kind, points) for kind, points, pattern in CATEGORY_KINDS if pattern.search(category)), None)


def kind_of(song, entry, people):
    """(kind, source, fallback): the kind with the most points, or a fallback when nothing scores."""
    page = tune_page(song)
    if page:
        values = page["categories"] + page["genre"] + page["instance_of"]
        anthem = next((v for v in values if NATIONAL_ANTHEM.search(v)), None)
        if anthem:
            return "Anthems", f"settled: {anthem}", False
        carol = next((v for v in values if CAROL.search(v) and category_rule(v) == ("Christmas", 2)), None)
        if carol:
            return "Christmas", f"settled: {carol}", False
    scores = kind_scores(song, entry, people)
    totals = {k: sum(p for p, _ in v) for k, v in scores.items()}
    best = max(TIE_ORDER, key=lambda k: (totals[k], -TIE_ORDER.index(k)))
    if totals[best] > 0:
        return best, "; ".join(w for _, w in scores[best]), False
    composer = entry.get("composer") or composers.UNKNOWN
    if song.get("pdmx_list") in PDMX_FOLK_LISTS:
        return "Fiddle tunes", f"fallback: in PDMX's {song['pdmx_list']}", True
    if composers.TRADITIONAL.fullmatch(composer):
        return "Songs", "fallback: a traditional tune", True
    if composer == composers.UNKNOWN:
        return "Fiddle tunes", "fallback: an unknown composer", True
    return "Classical", f"fallback: by {composer}", True


def _most_common(found):
    """The origin found most often, or None when two tie: a tune Wikipedia calls American, English,
    Irish and Scottish folk song alike has no one origin there."""
    ranked = Counter(found).most_common(2)
    if not ranked or (len(ranked) == 2 and ranked[0][1] == ranked[1][1]):
        return None
    return ranked[0][0]


def origin_of(song, entry, people):
    """(origin or None, source): the first of #381's five sources that answers."""
    m = re.fullmatch(r"Traditional \((.+)\)", entry.get("composer") or "")
    if m:
        tradition = m.group(1)
        return DEMONYMS.get(tradition, tradition), f"composer batch: {entry['composer']}"
    page = tune_page(song)
    if page:
        countries = [COUNTRIES[c] for c in page["country"] if c in COUNTRIES]
        if countries:
            return countries[0], f"Wikidata country of origin: {page['country'][0]}"
        found = [(DEMONYMS[_demonym(m.group(1))], c) for c in page["categories"]
                 for m in [TUNE_ORIGIN.search(c)] if m]
        origin = _most_common([o for o, _ in found])
        if origin:
            return origin, "Wikipedia category: " + next(c for o, c in found if o == origin)
    person = people.get(first_person(entry.get("composer")) or "")
    if person:
        found = [(_person_origin(m), c) for c in person["categories"] for m in [PERSON_ORIGIN.search(c)] if m]
        countries = [(COUNTRIES[c], c) for c in person["citizenship"] if c in COUNTRIES]
        origin = _most_common([o for o, _ in found])
        if origin:
            return origin, "composer's category: " + next(c for o, c in found if o == origin)
        # Mozart is as often an Austrian composer as a German one: his citizenship says which.
        tied = {o for o, n in Counter(o for o, _ in found).items() if n == max(Counter(o for o, _ in found).values())}
        for origin, country in countries:
            if not tied or origin in tied:
                return origin, f"composer's citizenship: {country}"
    return None, "no source"


def _demonym(text):
    return next(d for d in DEMONYMS if d.lower() == text.lower())


def _person_origin(match):
    """A composer's origin from a PERSON_ORIGIN match: "Jewish American songwriters" and
    "African-American composers" are American, like "American composers"."""
    origin = DEMONYMS[_demonym(match.group(1))]
    rest = match.string[match.end(1):]
    return "American" if origin == "African American" or re.match(r"[ -]American\b", rest) else origin


def fame_of(song, names):
    """(fame, pageviews, PDMX views): log10 of each, summed, for sorting (#381)."""
    views = song["page"]["pageviews"] if own_page(song, names) and song["page"].get("pageviews") else 0
    pdmx_views = song.get("pdmx_views", 0)
    return round(math.log10(1 + views) + math.log10(1 + pdmx_views), 3), views, pdmx_views


def well_known(views, pdmx_views):
    return ((views >= WELL_KNOWN_BOTH[0] and pdmx_views >= WELL_KNOWN_BOTH[1]) or views >= WELL_KNOWN_PAGEVIEWS
            or pdmx_views >= WELL_KNOWN_PDMX)


def disagree(views, pdmx_views):
    """A Well known Song whose signals disagree: one is very strong and the other doesn't reach the
    both-agree bar."""
    return well_known(views, pdmx_views) and not (views >= WELL_KNOWN_BOTH[0] and pdmx_views >= WELL_KNOWN_BOTH[1])


def tag(entry, song, people, names, hand=None):
    """The Song's four fields and each one's source: the rules', or a hand-set value's. A composer
    batch's kind and origin, tag.py guess's first guess, never count (batch_problems checks them)."""
    kind, kind_source, fallback = kind_of(song, entry, people)
    origin, origin_source = origin_of(song, entry, people)
    fame, views, pdmx_views = fame_of(song, names)
    known = well_known(views, pdmx_views)
    known_source = f"{views:,} pageviews, {pdmx_views:,} PDMX views"
    out = {"kind": kind, "origin": origin, "fame": fame, "well_known": known,
           "sources": {"kind": kind_source, "origin": origin_source, "well_known": known_source},
           "fallback": fallback, "disagree": disagree(views, pdmx_views), "pageviews": views, "pdmx_views": pdmx_views}
    hand = hand or {}
    for field in HAND_FIELDS:
        if field in hand:
            cited = f", {hand['source']}" if hand.get("source") else ""
            said = "" if hand[field] == out[field] else f" (the rules said {out[field]!r})"
            out["sources"][field] = f"hand-set: {hand.get('why')}{cited}{said}"
            out[field] = hand[field]
    return out


def tags(catalog, signals, hand):
    """Every Song's tags, by id."""
    songs = {s["id"]: s for s in signals["songs"]}
    names = song_names(catalog)
    out = {}
    for e in catalog:
        song = songs.get(e["id"])
        if song is None:
            continue
        out[e["id"]] = tag(e, song, signals["composers"], names[e["id"]], hand.get(e["id"]))
    return out


def with_tags(entry, fields):
    """The entry with TAG_FIELDS set to `fields`, after its composer fields (or its title)."""
    after = next((k for k in ("composer_source", "composer_died", "composer", "title") if k in entry), None)
    out = {}
    for key, value in entry.items():
        if key in TAG_FIELDS:
            continue
        out[key] = value
        if key == after:
            out.update({k: fields[k] for k in TAG_FIELDS})
    return out


def apply(catalog, all_tags):
    return [with_tags(e, all_tags[e["id"]]) if e["id"] in all_tags else e for e in catalog]


def guess(records, all_tags):
    """A composer batch's records, each with the rules' kind and origin as the lookup's first guess,
    after its skeleton keys. A record that has either already keeps what it has."""
    out = []
    for r in records:
        if r["id"] in all_tags and "kind" not in r and "origin" not in r:
            r = {**{k: r[k] for k in composers.SKELETON_KEYS if k in r},
                 "kind": all_tags[r["id"]]["kind"], "origin": all_tags[r["id"]]["origin"],
                 **{k: v for k, v in r.items() if k not in composers.SKELETON_KEYS}}
        out.append(r)
    return out


# ---------------------------------------------------------------- checks


def hand_problems(hand, catalog_ids):
    """What's wrong with tag-hand.json: a Song not in the catalog, a field it can't set, a value outside
    the kinds, no reason, or no page for a value that needs one."""
    problems = []
    for sid, values in hand.items():
        if sid not in catalog_ids:
            problems.append(f"{sid}: in {HAND.name} but not in the catalog")
        for k in values:
            if k not in HAND_FIELDS + ("title", "why", "found_by", "source"):
                problems.append(f"{sid}: {HAND.name} can't set {k!r}")
        if not any(k in values for k in HAND_FIELDS):
            problems.append(f"{sid}: sets none of {', '.join(HAND_FIELDS)}")
        if not isinstance(values.get("why"), str) or not values["why"].strip():
            problems.append(f"{sid}: why: a one-line reason")
        if values.get("found_by") not in FOUND_BY:
            problems.append(f"{sid}: found_by: one of {', '.join(FOUND_BY)}")
        if "source" in values or any(k in values for k in HAND_SOURCE_NEEDED):
            if not re.fullmatch(r"https://\S+", str(values.get("source"))):
                problems.append(f"{sid}: source: the https:// page that supports the value"
                                + (f" (needed for {', '.join(k for k in HAND_SOURCE_NEEDED if k in values)})"
                                   if any(k in values for k in HAND_SOURCE_NEEDED) else ""))
        problems += [f"{sid}: {p}" for p in value_problems(values)]
    return problems


def value_problems(values):
    problems = []
    if "kind" in values and values["kind"] not in KINDS:
        problems.append(f"kind: one of {', '.join(KINDS)}, not {values['kind']!r}")
    if "origin" in values and not (values["origin"] is None or values["origin"] in set(DEMONYMS.values())):
        problems.append(f"origin: null or one of tag.py's DEMONYMS origins, not {values['origin']!r}")
    if "well_known" in values and not isinstance(values["well_known"], bool):
        problems.append("well_known: true or false")
    return problems


def batch_problems(batch_files, all_tags):
    """A composer batch record whose kind or origin isn't the Song's tag. The record's guess came
    before the lookup, and the lookup's composer may settle it otherwise (a Traditional (Irish)
    composer makes the tune Irish): correct the record, or, when the rules are wrong, hand-set the
    value in tag-hand.json with the page that says so."""
    problems = []
    for name, records in batch_files.items():
        for r in records:
            t = all_tags.get(r["id"])
            for field in ("kind", "origin"):
                if t and field in r and r[field] != t[field]:
                    problems.append(f"{r['id']}: {name}'s {field} {r[field]!r} isn't its tag {t[field]!r} "
                                    f"({t['sources'][field]}): correct the record, or hand-set it in {HAND.name} "
                                    "with a source")
    return problems


def signal_problems(catalog, signals):
    """A Song whose signals were fetched with another composer or composer_source than it has now:
    the lookup changed after fetch, so the tune's page, its pageviews and its Session type may be
    another's."""
    songs = {s["id"]: s for s in signals["songs"]}
    problems = []
    for e in catalog:
        s = songs.get(e["id"])
        if s and any(s.get(k) != e.get(k) for k in ("composer", "composer_source")):
            problems.append(f"{e['id']}: {SIGNALS.name} was fetched with another composer or composer_source: "
                            "run tag.py fetch, then apply")
    return problems


def catalog_problems(catalog, all_tags):
    """A Song without its four fields, a kind outside KINDS, or fields that aren't apply's."""
    problems = []
    for e in catalog:
        if e.get("kind") not in KINDS:
            problems.append(f"{e['id']}: kind {e.get('kind')!r} isn't one of {', '.join(KINDS)}")
        missing = [k for k in TAG_FIELDS if k not in e]
        if missing:
            problems.append(f"{e['id']}: no {', '.join(missing)}: run tag.py apply (and fetch for a new Song)")
        elif e["id"] not in all_tags:
            problems.append(f"{e['id']}: not in {SIGNALS.name}: run tag.py fetch, then apply")
        elif {k: e[k] for k in TAG_FIELDS} != {k: all_tags[e["id"]][k] for k in TAG_FIELDS}:
            problems.append(f"{e['id']}: its tags aren't apply's: run tag.py apply")
    return problems


# ---------------------------------------------------------------- the report


def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def report(catalog, all_tags, hand):
    """tags.report.md: the counts, the hand-set values, and every Song's tags with their sources."""
    tagged = [(e, all_tags[e["id"]]) for e in catalog if e["id"] in all_tags]
    kinds = Counter(t["kind"] for _, t in tagged)
    origins = Counter(t["origin"] for _, t in tagged if t["origin"])
    known = sum(1 for _, t in tagged if t["well_known"])
    fallback = sum(1 for _, t in tagged if t["fallback"])
    disagreeing = sum(1 for _, t in tagged if t["disagree"])
    reasons = Counter(v["found_by"] for v in hand.values())
    with_origin = sum(origins.values())
    lines = [
        "# Song tags",
        "",
        f"Generated by `{TOOL}` from `tag-signals.json`, the catalog's composers and `tag-hand.json`; don't edit "
        "by hand. Command:",
        "",
        "```sh",
        f"python3 -I {TOOL} apply",
        "```",
        "",
        f"**{len(tagged)} Songs.** Kind: " + ", ".join(f"{k} {kinds[k]}" for k in KINDS) + ".",
        "",
        f"Origin: {with_origin} of {len(tagged)} ({round(100 * with_origin / max(1, len(tagged)))}%): "
        + ", ".join(f"{o} {n}" for o, n in sorted(origins.items(), key=lambda x: (-x[1], x[0]))) + ".",
        "",
        f"Well known: {known}. The rules' kind came from a fallback for {fallback} Songs, and {disagreeing} "
        "Well known Songs have one strong signal the other doesn't back: review both by hand, and set what's "
        "wrong in `tag-hand.json`.",
        "",
        f"Hand-set: {len(hand)} Songs (`tag-hand.json`): "
        + ", ".join(f"{n} {r}" for r, n in sorted(reasons.items(), key=lambda x: (-x[1], x[0]))) + ".",
        "",
        "## Every Song",
        "",
        "| Song | Kind | Origin | Fame | Well known | Kind from | Origin from | Views |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for e, t in tagged:
        s = t["sources"]
        lines.append(f"| {cell(e['title'])} (`{e['id']}`) | {t['kind']} | {t['origin'] or ''} | {t['fame']} | "
                     f"{'yes' if t['well_known'] else ''} | {cell(s['kind'])} | {cell(s['origin'])} | "
                     f"{cell(s['well_known'])} |")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- the command


def read_json(path, default=None):
    path = Path(path)
    if not path.exists() and default is not None:
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    """The catalog's own format (`json.dumps(indent=1)`, no trailing newline)."""
    Path(path).write_text(json.dumps(value, indent=1, ensure_ascii=False), encoding="utf-8")


def load():
    catalog = read_json(CATALOG)
    signals = read_json(SIGNALS, {"songs": [], "composers": {}})
    hand = read_json(HAND, {})
    batches = batch_records()
    return catalog, signals, hand, batches, tags(catalog, signals, hand)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("fetch")
    p.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="where the answers are kept")
    p.add_argument("--pdmx", type=Path, default=Path.home() / ".cache/pedos/pdmx/PDMX.csv")
    p.add_argument("--offline", action="store_true", help="fail on any answer not in the cache")
    sub.add_parser("apply")
    sub.add_parser("check")
    p = sub.add_parser("guess")
    p.add_argument("--batch", type=Path, required=True, help="a tools/catalog/composers-NN.json")
    args = parser.parse_args()

    if args.command == "fetch":
        catalog = read_json(CATALOG)
        fetch = Fetcher(args.cache, offline=args.offline)
        write_json(SIGNALS, fetch_signals(catalog, fetch, args.pdmx, log=lambda m: print(m, file=sys.stderr)))
        print(f"{SIGNALS.relative_to(ROOT)}: {len(catalog)} Songs, {fetch.requests} requests")
        return 0

    catalog, signals, hand, batches, all_tags = load()
    problems = hand_problems(hand, {e["id"] for e in catalog})
    problems += [f"{sid}: composer batch: {p}" for sid, r in batches.items() for p in value_problems(
        {k: r[k] for k in ("kind", "origin") if k in r})]
    if args.command == "guess":
        records = guess(read_json(args.batch), all_tags)
        composers.write_json(args.batch, records)
        print(f"{args.batch.name}: guessed {sum(1 for r in records if 'kind' in r)} of {len(records)} records")
        return 0
    if args.command == "apply":
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
        catalog = apply(catalog, all_tags)
        write_json(CATALOG, catalog)
        REPORT.write_text(report(catalog, all_tags, hand), encoding="utf-8")
    problems += catalog_problems(catalog, all_tags) + signal_problems(catalog, signals)
    problems += batch_problems(composers.read_batches(HERE), all_tags)
    if args.command == "check" and (not REPORT.exists() or REPORT.read_text(encoding="utf-8") != report(
            catalog, all_tags, hand)):
        problems.append(f"{REPORT.name} isn't apply's: run tag.py apply")
    print(f"{sum(1 for e in catalog if e.get('kind') in KINDS)} of {len(catalog)} Songs have their kind")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

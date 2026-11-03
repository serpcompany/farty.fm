import unittest

import flag_picks

BATCH = "tools/catalog/titles-09.txt"


def row(sid, genres="classical", tags="NA", artist="Misc tunes", title="A Tune"):
    return {"metadata": f"./metadata/1/{sid}.json", "genres": genres, "tags": tags, "artist_name": artist,
            "title": title}


def entry(sid, song_id, titles=BATCH):
    return {"id": song_id, "title": song_id.title(), "source": {"musescore_score_id": sid,
            "musescore_url": f"https://musescore.com/score/{sid}"}, "import": {"titles": titles}}


class ModernSigns(unittest.TestCase):
    def test_a_modern_genre_tag_or_artist_is_a_sign(self):
        self.assertEqual(flag_picks.modern_signs(row("1", genres="rock")), ["genre rock"])
        self.assertEqual(flag_picks.modern_signs(row("1", genres="classical-soundtrack")), ["genre soundtrack"])
        self.assertEqual(flag_picks.modern_signs(row("1", tags="piano-disney-videogame")),
                         ["tag disney", "tag videogame"])
        self.assertEqual(flag_picks.modern_signs(row("1", artist="Misc Soundtrack")), ["artist Misc Soundtrack"])

    def test_old_genres_and_generic_artists_are_not(self):
        for genres in ("classical", "folk", "jazz", "blues", "religiousmusic", "worldmusic", "NA", ""):
            self.assertEqual(flag_picks.modern_signs(row("1", genres=genres)), [], genres)
        for artist in ("Misc tunes", "Misc Traditional", "Henry Purcell", "NA", ""):
            self.assertEqual(flag_picks.modern_signs(row("1", artist=artist)), [], artist)

    def test_a_tag_must_match_whole(self):
        self.assertEqual(flag_picks.modern_signs(row("1", tags="jsbach-stmatthewpassion-popular-rockabye")), [])

    def test_missing_fields_are_no_sign(self):
        self.assertEqual(flag_picks.modern_signs({"metadata": "./metadata/1/1.json"}), [])


class Flag(unittest.TestCase):
    def test_flags_only_the_batchs_picks_that_look_modern_in_catalog_order(self):
        catalog = [entry("30", "lavenders-blue"), entry("10", "misirlou"), entry("20", "greensleeves"),
                   entry("40", "rock-elsewhere", titles="tools/catalog/titles-01.txt")]
        picks = flag_picks.batch_picks(catalog, BATCH)
        self.assertEqual(sorted(picks), ["10", "20", "30"])
        rows = [row("10", genres="rock", artist="Dick Dale"), row("20"), row("40", genres="rock"),
                row("30", genres="soundtrack", artist="Misc Soundtrack"), row("99", genres="pop")]
        flagged = flag_picks.flag(picks, rows)
        self.assertEqual([(e["id"], signs) for e, _, signs in flagged],
                         [("lavenders-blue", ["genre soundtrack", "artist Misc Soundtrack"]),
                          ("misirlou", ["genre rock"])])

    def test_no_picks_no_flags(self):
        self.assertEqual(flag_picks.flag({}, [row("1", genres="rock")]), [])

    def test_flags_a_pick_that_is_one_voice_or_a_variant(self):
        picks = flag_picks.batch_picks([entry("10", "my-faith"), entry("20", "on-christmas-night"),
                                        entry("30", "hymn"), entry("40", "plain")], BATCH)
        rows = [row("10", title="My Faith Looks Up To Thee: Tenor"), row("20", title="On Christmas Night - Version 4"),
                row("30", title="A Hymn"), row("40", title="A Tune")]
        flagged = flag_picks.flag(picks, rows, parts={"30": ["Alto"], "40": ["Piano", "Melody"]})
        self.assertEqual([(e["id"], signs) for e, _, signs in flagged],
                         [("my-faith", ["title tenor"]), ("on-christmas-night", ["title version 4"]),
                          ("hymn", ["part alto"])])


class PartSigns(unittest.TestCase):
    def test_a_voice_or_version_in_the_title_subtitle_or_part_names_is_a_sign(self):
        self.assertEqual(flag_picks.part_signs({"title": "Forty Days and Forty Nights - tenor"}), ["title tenor"])
        self.assertEqual(flag_picks.part_signs({"title": "My Faith", "subtitle": "Tenor Line"}), ["subtitle tenor"])
        self.assertEqual(flag_picks.part_signs({"title": "Carol (Version  2)"}), ["title version 2"])
        for part in ("Soprano", "Bass", "Descant", "Harmony"):
            self.assertEqual(flag_picks.part_signs({"title": "X"}, [part]), [f"part {part.lower()}"])

    def test_a_part_name_counts_only_when_it_is_the_one_part(self):
        self.assertEqual(flag_picks.part_signs({"title": "X"}, ["Soprano", "Alto"]), [])

    def test_only_whole_words_count(self):
        for title in ("Bassoon Song", "Altogether Now", "Tenorio", "The Last Version", "Harmonyville", "NA"):
            self.assertEqual(flag_picks.part_signs({"title": title}), [], title)
        self.assertEqual(flag_picks.part_signs({}), [])


class SameTune(unittest.TestCase):
    WE_THREE_KINGS = [71, 69, 67, 64, 66, 67, 66, 64, 71, 69, 67, 64, 66, 67, 66, 64]
    JOHNNY_COMES_MARCHING = [64, 64, 69, 69, 69, 71, 72, 71, 72, 69, 67, 64, 67, 69]
    JOHNNY_I_HARDLY_KNEW_YE = [59, 59, 64, 64, 66, 67, 66, 67, 64, 62, 59, 62, 64]

    def test_the_same_tune_in_another_key_or_with_repeated_notes_opens_alike(self):
        self.assertEqual(flag_picks.opening(self.JOHNNY_COMES_MARCHING), flag_picks.opening(self.JOHNNY_I_HARDLY_KNEW_YE))
        self.assertEqual(flag_picks.opening([p - 5 for p in self.WE_THREE_KINGS]), flag_picks.opening(self.WE_THREE_KINGS))

    def test_a_melody_with_too_few_changes_of_pitch_has_no_opening(self):
        self.assertIsNone(flag_picks.opening([60, 60, 62, 62, 64]))

    def test_pairs_have_one_song_in_the_batch(self):
        melodies = {"we-three-kings": self.WE_THREE_KINGS, "johnny-comes-marching": self.JOHNNY_COMES_MARCHING, "other": [60, 62] * 8,
                    "kings-of-orient": [p + 2 for p in self.WE_THREE_KINGS], "johnny-i-hardly-knew-ye": self.JOHNNY_I_HARDLY_KNEW_YE}
        self.assertEqual(flag_picks.same_tunes(melodies, {"kings-of-orient", "johnny-i-hardly-knew-ye"}),
                         [("we-three-kings", "kings-of-orient"), ("johnny-comes-marching", "johnny-i-hardly-knew-ye")])
        self.assertEqual(flag_picks.same_tunes(melodies, {"other"}), [])

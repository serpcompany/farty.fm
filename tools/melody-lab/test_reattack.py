import unittest

from evaluate import added_reattacks, reattacks
from signals import tone_between


def burst(start, end):
    return tone_between(start, end, 1.2, 0.8)


SINGLE = burst(0.0, 0.20)
TWO_BURSTS = burst(0.0, 0.20) + burst(0.30, 0.50)
RETRIGGERED_LATER = burst(0.70, 0.90)


class Reattacks(unittest.TestCase):
    def test_every_reattack_is_listed(self):
        found = reattacks(TWO_BURSTS + RETRIGGERED_LATER)
        self.assertEqual(len(found), 2)
        self.assertAlmostEqual(found[0], 0.30, delta=0.03)
        self.assertAlmostEqual(found[1], 0.70, delta=0.03)

    def test_a_single_burst_has_none(self):
        self.assertEqual(reattacks(SINGLE), [])


class AddedReattacks(unittest.TestCase):
    def test_a_retriggered_two_burst_fart_is_caught(self):
        added = added_reattacks(TWO_BURSTS + RETRIGGERED_LATER, TWO_BURSTS)
        self.assertEqual(len(added), 1)
        self.assertAlmostEqual(added[0], 0.70, delta=0.03)

    def test_a_retriggered_single_burst_fart_is_caught(self):
        added = added_reattacks(SINGLE + RETRIGGERED_LATER, SINGLE)
        self.assertEqual(len(added), 1)
        self.assertAlmostEqual(added[0], 0.70, delta=0.03)

    def test_a_farts_own_second_burst_alone_is_not_counted_even_played_quieter(self):
        self.assertEqual(added_reattacks(TWO_BURSTS, TWO_BURSTS), [])
        self.assertEqual(added_reattacks(0.5 * TWO_BURSTS, TWO_BURSTS), [])

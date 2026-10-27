"""The two blocks of a two-block lathe cycle in Python (B1, plan "Two-block schema").

The twin of ``src/lib/core/codes/blocks.test.ts``: ``gedit_nc.cycle_block_of`` and
``params_of_block`` are held to the cases of ``tests/fixtures/codes/blocks.json``, on the
resolved databases the app hands to a script. And the rule that keeps every other reader
right without knowing the block: an address declared in both blocks reads the same in both
(``position``, ``axis``, ``programNumber``), so ``position_of`` gives one answer for either
block. ``unit`` alone may differ, and only between a ``block: 1`` and a ``block: 2``
declaration (P4h, plan section 6.10 rule 11; T118: the ``G76`` ``P``): ``number_class_of``
then reads the block's own unit with ``cycle_block``, and gives no class without it.
"""

from __future__ import annotations

import copy
import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

CASES = helpers.load_json(helpers.FIXTURES_DIR / "codes" / "blocks.json")["cases"]
READING_MEMBERS = ("unit", "position", "axis", "programNumber")


def entry_of(dialect: str, code: str):
    for entry in helpers.resolved_codes(dialect):
        if entry.get("code") == code:
            return entry
    raise AssertionError("no %s in %s" % (code, dialect))


def with_t118(entry):
    """T118 DATA LINE (P4h, plan section 6.10 rule 10): the ``G76`` entry with the second-block
    ``P`` as P4.43a's data change declares it in ``src/lib/data/codes/fanuc-lathe.json``, the
    thread height in least increments (``unit: 'increment'``), where the shipped file still
    says ``count``. Once the line is in the file this changes nothing."""
    out = copy.deepcopy(entry)
    found = [p for p in out["params"] if p.get("address") == "P" and p.get("block") == 2]
    if len(found) != 1:
        raise AssertionError("no second-block P in %s" % out.get("code"))
    found[0]["unit"] = "increment"
    return out


class CycleBlockTest(unittest.TestCase):
    def test_the_shared_cases(self) -> None:
        for case in CASES:
            with self.subTest(dialect=case["dialect"], code=case["code"], written=case["written"]):
                entry = entry_of(case["dialect"], case["code"])
                self.assertEqual(gedit_nc.cycle_block_of(entry, case["written"]), case["block"])
                params = gedit_nc.params_of_block(entry, case["block"])
                self.assertEqual([p["address"] for p in params], case["params"])

    def test_an_entry_written_by_hand(self) -> None:
        entry = {
            "code": "G71",
            "blocks": 2,
            "params": [
                {"address": "U", "label": "a", "block": 1},
                {"address": "S", "label": "both"},
                {"address": "P", "label": "p", "block": 2},
            ],
        }
        self.assertTrue(gedit_nc.declares_blocks(entry))
        self.assertEqual(gedit_nc.cycle_block_of(entry, ["p"]), 2)
        self.assertEqual(gedit_nc.cycle_block_of(entry, ["s"]), 1)
        self.assertIsNone(gedit_nc.cycle_block_of(entry, ["X"]))
        self.assertEqual([p["label"] for p in gedit_nc.params_of_block(entry, 2)], ["both", "p"])
        # Without blocks: 2, or without any block, nothing is said and every parameter counts.
        plain = {"code": "G71", "params": [{"address": "P", "label": "p", "block": 2}]}
        self.assertFalse(gedit_nc.declares_blocks(plain))
        self.assertIsNone(gedit_nc.cycle_block_of(plain, ["P"]))
        self.assertIsNone(gedit_nc.cycle_block_of(None, ["P"]))
        self.assertEqual(len(gedit_nc.params_of_block(plain, 1)), 1)


class SameReadingInBothBlocksTest(unittest.TestCase):
    def test_every_address_of_both_blocks_reads_alike(self) -> None:
        for dialect in ("fanuc-lathe", "fanuc-lathe-b"):
            for entry in helpers.resolved_codes(dialect):
                if not gedit_nc.declares_blocks(entry):
                    continue
                first = {p["address"]: p for p in gedit_nc.params_of_block(entry, 1)}
                for param in gedit_nc.params_of_block(entry, 2):
                    other = first.get(param["address"])
                    if other is None:
                        continue
                    for member in READING_MEMBERS:
                        # P4h (T118): the unit may differ between two explicit blocks.
                        if member == "unit" and param.get("block") is not None and other.get("block") is not None:
                            continue
                        with self.subTest(dialect=dialect, code=entry["code"], address=param["address"], member=member):
                            self.assertEqual(param.get(member), other.get(member))

    def test_number_class_of_answers_once_for_either_block(self) -> None:
        profile = helpers.load_profile("fanuc-lathe")
        g76 = with_t118(entry_of("fanuc-lathe", "G76"))
        # Q and F read the same in either block, and with the block unknown.
        for block in (1, 2, None):
            with self.subTest(block=block):
                self.assertEqual(gedit_nc.number_class_of("Q", profile, "per-rev", [g76], True, None, block), "increment")
                self.assertEqual(gedit_nc.number_class_of("F", profile, "per-rev", [g76], True, None, block), "feedPerRev")
        g71 = entry_of("fanuc-lathe", "G71")
        self.assertEqual(gedit_nc.number_class_of("P", profile, "per-rev", [g71]), "count")
        self.assertEqual(gedit_nc.number_class_of("U", profile, "per-rev", [g71]), "length")


class BlockAwareUnitTest(unittest.TestCase):
    """P4h (plan section 6.10 rules 10, 11; T118): the ``G76`` ``P`` read by its block."""

    def setUp(self) -> None:
        self.profile = helpers.load_profile("fanuc-lathe")
        self.g76 = with_t118(entry_of("fanuc-lathe", "G76"))

    def block_of(self, words):
        return gedit_nc.cycle_block_of(self.g76, words)

    def test_the_second_block_reads_the_thread_height_in_increments(self) -> None:
        block = self.block_of(["X", "Z", "R", "P", "Q", "F"])
        self.assertEqual(block, 2)
        self.assertEqual(gedit_nc.number_class_of("P", self.profile, "per-rev", [self.g76], True, None, block), "increment")
        machine = {"numberInput": {"mode": "increment", "incrementMm": "0.001"}}
        self.assertEqual(gedit_nc.value_of(gedit_nc.parse_number("1500"), "increment", machine, "mm"), "1.5")

    def test_the_first_block_reads_a_packed_count(self) -> None:
        block = self.block_of(["P", "Q", "R"])
        self.assertEqual(block, 1)
        self.assertEqual(gedit_nc.number_class_of("P", self.profile, "per-rev", [self.g76], True, None, block), "count")

    def test_an_unknown_block_gives_no_class(self) -> None:
        self.assertIsNone(gedit_nc.number_class_of("P", self.profile, "per-rev", [self.g76], True))
        self.assertIsNone(gedit_nc.number_class_of("P", self.profile, "per-rev", [self.g76], True, None, None))
        # A code in force is read as if the block were not known.
        self.assertIsNone(gedit_nc.number_class_of("P", self.profile, "per-rev", [], True, [self.g76], 2))

    def test_true_is_not_a_block(self) -> None:
        # Python's True equals 1; the block is an int, and anything else is "not known".
        self.assertIsNone(gedit_nc.number_class_of("P", self.profile, "per-rev", [self.g76], True, None, True))

    def test_the_entry_declares_another_unit_per_block(self) -> None:
        units = {p.get("block"): p.get("unit") for p in self.g76["params"] if p.get("address") == "P"}
        self.assertEqual(units, {1: "count", 2: "increment"})


if __name__ == "__main__":
    unittest.main()

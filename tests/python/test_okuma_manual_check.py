"""The Okuma fixes of the manual check (fix batch B3, owner decisions of 2026-10-25), the
Python half: the three-digit tool word (D3-2), the fixed thread cycles G31/G32/G33 that go back
to their start (D5-6) and the change points of LAP G84 as coordinates of X and Z (D5-1), as the
scripts read them from the resolved data."""

from __future__ import annotations

import unittest

from tests.python import helpers

OKUMA = "okuma-osp"


def run(script, lines, params=None, **kw):
    context = helpers.effective_context(OKUMA, **kw)
    context["params"] = params or {}
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    out = helpers.run_script(script, stdin="\n".join(lines), context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


class TestThreeDigitToolWord(unittest.TestCase):
    """D3-2: with two-digit offsets `T100` indexes station 1 (offset 00), `T123` station 1."""

    def test_the_tool_list_counts_t100_t101_and_t0101_as_station_1(self):
        program = ["O0102", "G00 T100", "G01 Z-20. F0.2", "G00 T0101", "G01 Z-30. F0.15", "T101", "T305", "T012", "M02"]
        rows = run("tool_list.py", program)["rows"]
        self.assertEqual([(row["tool"], row["calls"], row["line"]) for row in rows], [("T1", 3, 2), ("T3", 1, 7)])

    def test_one_and_two_and_five_digit_words_stay_unread(self):
        rows = run("tool_list.py", ["O0102", "T1", "T12", "T12345", "M02"])["rows"]
        self.assertEqual(rows, [])


class TestFixedThreadCycles(unittest.TestCase):
    """D5-6: each block of G31/G32/G33 is a whole pass that ends where it started."""

    def test_a_thread_pass_goes_back_to_its_start(self):
        # From X40 the pass cuts to X38.5 and X38, and returns to X40: the incremental move
        # after it starts there (X50), not at the thread diameter (X48).
        for code in ("G33", "G31"):
            with self.subTest(code=code):
                report = run("extents.py", ["G00 X40. Z5.", "%s X38.5 Z-20. F1.5" % code, "X38.", "G91 G00 X10.", "G90 M02"], preset="okuma-1mm")
                rows = {row["axisId"]: row for row in report["rows"] if row["scope"] == "program"}
                self.assertEqual((rows["X"]["min"], rows["X"]["max"], rows["X"]["maxLine"]), ("38", "50", 4))
                self.assertEqual((rows["Z"]["min"], rows["Z"]["max"]), ("-20", "5"))

    def test_the_resolved_entries_are_whole_passes(self):
        entries = {e["code"]: e for e in helpers.resolved_codes("okuma")}
        for code in ("G31", "G32", "G33"):
            self.assertEqual(entries[code]["sets"], {"motion": "feed", "path": "cycle"}, code)


class TestLapChangePoints(unittest.TestCase):
    """D5-1: XA=/XB= are X coordinates (diameter), ZA=/ZB= Z coordinates."""

    def test_the_resolved_g84_names_the_axis_of_each_change_point(self):
        (g84,) = [e for e in helpers.resolved_codes("okuma") if e["code"] == "G84"]
        axes = {p["address"]: p.get("axis") for p in g84["params"]}
        self.assertEqual(axes, {"XA": "X", "ZA": "Z", "DA": None, "FA": None, "XB": "X", "ZB": "Z", "DB": None, "FB": None})


if __name__ == "__main__":
    unittest.main()

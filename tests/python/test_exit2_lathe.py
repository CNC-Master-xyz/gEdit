"""The lathe program of the Phase 2 exit criteria (``tests/fixtures/exit2/checks-lathe.nc``) against
the golden of address arithmetic, without the app.

B1 intB (glue item 20, after fixnc NC-02): on the Fanuc lathe ``G69`` ends only the turret mirror
image; a ``G68.2`` tilted plane ends with ``G69.1``. The program used to close its ``G68.2`` with
``G69``, which now leaves the rest of the program inside the frame, so address arithmetic left ten
blocks as written and the runtime scenarios (exit2-x8) would have failed on the golden. This runs
the script on the same input, with the same parameters, and compares the saved text byte for byte
with the golden (``expected/`` and the text of ``expected-nopython/``, which is the input again
for the lines that matter here), so the runtime harness does not have to be the first to say so.

After P4a it compares the summary and the findings too, in the context the app runs with no machine
(the effective profile's defaults): the bare resolved profile has no ``U``/``W`` twins, so a check
built on it lost the two ``W`` rows and blamed the script for it.
"""

from __future__ import annotations

import json
import unittest

from tests.python import helpers as H

EXIT2 = H.FIXTURES_DIR / "exit2"


def rows(findings):
    """A finding as the runtime scenario compares it (exit2-x8): line, severity, reason, message."""
    return ["%s|%s|%s|%s" % (f.get("line"), f.get("severity"), f.get("reason"), f.get("message")) for f in findings]


class TestExit2LatheGolden(unittest.TestCase):
    def run_golden(self):
        """The script on the lathe program as the app runs it with no machine chosen.

        The context is the **effective** profile's defaults (``effective_context``), not the
        bare resolved profile: the app with no machine applies the profile's default G-code
        system, whose overlay is what makes ``U`` and ``W`` the incremental twins of ``X`` and
        ``Z``. With the bare profile ``W`` is no twin at all and its words are never listed.
        """
        source = (EXIT2 / "checks-lathe.nc").read_bytes().decode("utf-8")
        report = json.loads((EXIT2 / "expected" / "checks-lathe.arith-z-0.5.none.report.json").read_text(encoding="utf-8"))
        lines = source.split("\n")
        if lines[-1] == "":
            lines.pop()
        context = H.effective_context("fanuc-lathe", params=report["params"])
        context["document"]["name"] = "checks-lathe.nc"
        context["input"]["endLine"] = len(lines)
        out = H.run_script("address_arithmetic.py", stdin=source, context=context)
        self.assertEqual(out.returncode, 0, out.stderr)
        return lines, report, out.json()

    def test_the_tilted_plane_ends_with_g69_1_and_the_arithmetic_golden_holds(self) -> None:
        lines, _report, envelope = self.run_golden()
        golden = (EXIT2 / "expected" / "checks-lathe.arith-z-0.5.none.nc").read_bytes().decode("utf-8")
        self.assertEqual(envelope["text"], golden)
        # The tilted plane is the one frame the report names, and it is closed by its own G69.1.
        frames = [row for row in envelope["findings"] if row.get("reason") == "frame"]
        self.assertEqual([row["line"] for row in frames], [36], frames)
        self.assertIn("G69.1", lines[36])

    def test_the_summary_and_the_findings_match_the_golden_report(self) -> None:
        # The runtime scenario (exit2-x8) compares these too; the text alone missed it when
        # the findings changed.
        _lines, report, envelope = self.run_golden()
        self.assertEqual(envelope["message"], report["message"])
        self.assertEqual(rows(envelope["findings"]), rows(report["findings"]))

    def test_the_w_words_of_plain_moves_are_listed_and_the_g71_allowance_is_a_cycle_value(self) -> None:
        # W is the incremental twin of Z: a shift of Z leaves `G01 W-1.` (line 4) and a bare
        # `W-2.` under G01 (line 42) and says so. The `W0.1` of the second G71 block is the
        # finishing allowance on Z, a value of the cycle (P4a, NC-16), not an incremental move.
        lines, _report, envelope = self.run_golden()
        listed = {(f["line"], f["reason"]): f["message"] for f in envelope["findings"]}
        self.assertEqual(listed.get((4, "incremental")), "W-1.: W moves Z by a distance, so a shift does not apply to it.")
        self.assertEqual(listed.get((42, "incremental")), "W-2.: W moves Z by a distance, so a shift does not apply to it.")
        self.assertEqual(listed.get((13, "data")), "W0.1: a value of G71, not a position of this program.")
        self.assertEqual(lines[3], "G01 W-1. F0.1")
        self.assertEqual(lines[41], "W-2.")
        self.assertIn("2 incremental words", envelope["message"])
        self.assertNotIn("cycle-not-reviewed", [f["reason"] for f in envelope["findings"] if f["line"] in (12, 13, 20)])

    def test_the_two_goldens_differ_only_in_what_the_script_changed(self) -> None:
        saved = (EXIT2 / "expected" / "checks-lathe.arith-z-0.5.none.nc").read_text(encoding="utf-8").split("\n")
        nopython = (EXIT2 / "expected-nopython" / "checks-lathe.arith-z-0.5.none.nc").read_text(encoding="utf-8").split("\n")
        self.assertEqual(saved[36], "G69.1")
        self.assertEqual(nopython[36], "G69.1")


if __name__ == "__main__":
    unittest.main()

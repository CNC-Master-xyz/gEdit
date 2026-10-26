"""Manual-check fix D5-6: the start of an Okuma G31/G32/G33 taper is not resolved (the path rule
is in ``_nc_path.py``; test_extents holds it on a stand-in code). NC-10: it runs on the shipped
data and never skips; NC-6: the start shift K (I on G32) and the phase shift C."""

import unittest

from tests.python import helpers


def extents(lines):
    context = helpers.effective_context("okuma-osp", preset="okuma-1mm")
    context["params"] = {}
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    out = helpers.run_script("extents.py", stdin="\n".join(lines), context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    report = out.json()
    rows = {row["axisId"]: row for row in report["rows"] if row["scope"] == "program"}
    return rows, report.get("findings") or []


class TestOkumaThreadTaper(unittest.TestCase):
    def test_a_taper_by_i_or_a_leaves_the_start_not_resolved(self):
        for taper in ("I-1.", "I1.", "A10."):
            with self.subTest(taper=taper):
                rows, findings = extents(["G00 X40. Z5.", "G33 X38.5 Z-20. %s F1.5" % taper, "G91 G00 X10.", "G90 M02"])
                self.assertEqual(rows["X"]["unresolved"], 1)
                self.assertEqual(rows["X"]["min"], "38.5")
                self.assertIn((2, "cycle"), [(f["line"], f["reason"]) for f in findings])

    def test_a_straight_pass_is_resolved(self):
        rows, findings = extents(["G00 X40. Z5.", "G33 X38.5 Z-20. I0 F1.5", "G91 G00 X10.", "G90 M02"])
        self.assertEqual(rows["X"]["unresolved"], 0)
        self.assertEqual(findings, [])

    def test_the_g33_data_is_a_whole_pass(self):
        # NC-10: the data this file tests is pinned here too, so losing it fails, never skips.
        g33 = next(e for e in helpers.resolved_codes("okuma") if e.get("code") == "G33")
        self.assertEqual((g33.get("sets") or {}).get("path"), "cycle")

    def test_the_phase_shift_c_is_no_c_axis_move(self):
        # NC-6 (OSP-P300 programming manual, fixed thread cycles): C is the phase shift of a
        # thread with several starts, an angle of the cycle; the tool does not turn a C axis.
        rows, findings = extents(["G00 X40. Z5.", "G33 X38.5 Z-20. F1.5 C90.", "X38.", "G00 X100.", "M02"])
        self.assertNotIn("C", rows)
        self.assertEqual((rows["X"]["unresolved"], rows["Z"]["unresolved"]), (0, 0))
        self.assertEqual(findings, [])

    def test_a_start_shift_leaves_only_its_own_axis_not_resolved(self):
        # NC-6: K of G33/G31 shifts the start along Z, I of G32 along X. Neither is a taper in
        # the Series 15 format of another control, so the finding does not say so.
        for code in ("G33", "G31"):
            with self.subTest(code=code):
                rows, findings = extents(["G00 X40. Z5.", "%s X38.5 Z-20. F1.5 K2." % code, "G00 X100.", "M02"])
                self.assertEqual((rows["X"]["unresolved"], rows["Z"]["unresolved"]), (0, 1))
                self.assertEqual([(f["line"], f["reason"]) for f in findings], [(2, "cycle")])
                self.assertNotIn("Series 15", findings[0]["message"])
                self.assertIn("moved by K2.", findings[0]["message"])
        rows, findings = extents(["G00 X40. Z5.", "G32 X10. Z-2. F1.5 I2.", "G00 X100.", "M02"])
        self.assertEqual((rows["X"]["unresolved"], rows["Z"]["unresolved"]), (1, 0))
        self.assertNotIn("Series 15", findings[0]["message"])
        # Written as 0, nothing is shifted.
        rows, findings = extents(["G00 X40. Z5.", "G33 X38.5 Z-20. F1.5 K0", "G00 X100.", "M02"])
        self.assertEqual(findings, [])


if __name__ == "__main__":
    unittest.main()

"""`mirror.py` (Phase 4 plan §5 P4a, P4.4; exit criteria X21 and X22), against the golden
cases in ``tests/fixtures/scripts/mirror/`` (the format is ``tests/fixtures/scripts/README.md``,
"The geometry goldens"), and the properties of X21 the goldens cannot hold alone: mirroring
twice gives every value back, on a mill and with the lathe Z mirror; every mill result warns
about climb milling and every counter-spindle result about the tool nose direction.

The round trip also runs over every owner-public program the mirror does not refuse (the Z
mirror on the turning profiles, the mirror in X on the milling ones); what each program
refuses is printed, counted per reason, and not asserted.

The programs are synthetic, written for gEdit.
"""

from __future__ import annotations

import unittest
from decimal import Decimal
from typing import Any, Dict, List, Tuple

from tests.python import helpers
from tests.python.test_rotate import (
    FANUC_TOP,
    CountedTrackers,
    assert_synthetic,
    assert_values_back,
    case_named,
    errors_of,
    in_process,
    owner_public,
    positions,
    print_counts,
    refusal_counts,
    refused,
    run_case,
    run_long,
    run_owner_public,
    run_text,
)

SCRIPT = "mirror.py"

#: The cases of the plan's exit criteria.
CASES = {
    "fanuc-lathe-b-z-mirror", "fanuc-lathe-cycles-refused", "fanuc-lathe-x-mirror-refused", "fanuc-mill-line-30-rounded",
    "fanuc-mill-refused", "fanuc-mill-selection-under-comp", "fanuc-mill-x-decimal", "fanuc-mill-y-decimal",
    "fanuc-mill-z-refused", "klartext-y-axis", "lathe-thread-refused", "lathe-z-counter-spindle",
    "okuma-lathe-refused", "okuma-lathe-z-mirror", "okuma-milling-as-lathe", "sinumerik-mill-x-axis",
    "sinumerik-turning-refused", "sinumerik-turning-z-mirror",
    # The P4a fix round (batch B2).
    "b2-lathe-selection-without-z-refused", "b2-selection-unprimed",
    # The P4a fix round, the owner's decision Q-B (batch B1, written by the integration).
    "b1-lathe-y-sign",
}

#: The refusals of X22 (and §7 #296) a mirror has, each held by a refused golden (the rest
#: are the same rules as rotate's and are held there).
REASONS = {
    "frame", "coordinate-shift", "intermediate-point", "call", "expression", "machine-dependent",
    "distance-assumed", "unknown-code", "rotary-word", "selection-mode", "swap-unknown", "arc-unsupported",
    "plane", "lathe-x-mirror", "mill-z-mirror", "thread", "roughing-cycle", "lathe-cycle", "single-pass-taper",
    "selection-start", "selection-unprimed",
}


class GoldenTest(unittest.TestCase):
    def test_every_case(self) -> None:
        cases = helpers.geometry_cases("mirror")
        self.assertLessEqual(CASES, {c.name for c in cases})
        for case in cases:
            with self.subTest(case=case.name):
                out = helpers.run_script(SCRIPT, stdin=case.input_text(), context=helpers.geometry_context(case))
                self.assertTrue(out.ok, out.stderr)
                result = out.json()
                self.assertEqual(result["text"], case.expected_text())
                want = case.envelope()
                self.assertEqual(result.get("message"), want["message"])
                self.assertEqual(result.get("findings", []), want["findings"])
                self.assertEqual(refused(result), case.refused)
                if case.refused:
                    self.assertEqual(result["text"], case.input_text())

    def test_every_refusal_that_applies_is_held_by_a_golden(self) -> None:
        seen = set()
        for case in helpers.geometry_cases("mirror"):
            if case.refused:
                seen |= {f["reason"] for f in case.envelope()["findings"] if f["severity"] == "error"}
        self.assertEqual(REASONS - seen, set())

    def test_every_program_says_it_is_synthetic(self) -> None:
        assert_synthetic(self, "mirror")

    def test_every_result_carries_its_warning(self) -> None:
        # AD-42 / Q4-7 on a mill, Q4-2 on a lathe: one warning per written result.
        for case in helpers.geometry_cases("mirror"):
            if case.refused:
                continue
            with self.subTest(case=case.name):
                warnings = [f["reason"] for f in case.envelope()["findings"] if f["severity"] == "warning"]
                lathe = case.params.get("about") == "z"
                self.assertEqual(warnings.count("tool-nose" if lathe else "climb-milling"), 1)
                self.assertNotIn("climb-milling" if lathe else "tool-nose", warnings)


class TwiceTest(unittest.TestCase):
    """X21: mirroring twice gives every value back (the line at 30° rounds: its points come
    back within the rounding)."""

    def test_twice(self) -> None:
        for case in helpers.geometry_cases("mirror"):
            if case.refused:
                continue
            with self.subTest(case=case.name):
                once = run_case(SCRIPT, case, **case.params)
                twice = run_case(SCRIPT, case, once["text"], **case.params)
                self.assertFalse(refused(twice), twice["message"])
                context = helpers.geometry_context(case)
                if "rounded" in case.envelope()["message"]:
                    start = case.context()["input"]["startLine"]
                    before = positions(case.input_text(), context, start, case.preceding_lines())
                    after = positions(twice["text"], context, start, case.preceding_lines())
                    for number, (b, a) in enumerate(zip(before, after), 1):
                        for axis in ("X", "Y"):
                            if b.get(axis) is not None:
                                self.assertLess(abs(a[axis] - b[axis]), Decimal("0.0011"), "line %d" % number)  # type: ignore[operator]
                else:
                    assert_values_back(self, case.input_text(), twice["text"], context["profile"])

    def test_the_codes_come_back_in_their_own_style(self) -> None:
        case = case_named("mirror", "fanuc-mill-x-decimal")
        once = run_case(SCRIPT, case, **case.params)
        self.assertIn("G03 X5. Y5. I-5. J0.", once["text"].split("\n"))
        twice = run_case(SCRIPT, case, once["text"], **case.params)
        self.assertIn("G02 X20. Y5. I5. J0.", twice["text"].split("\n"))


class LatheTest(unittest.TestCase):
    def test_a_turning_profile_mirrors_in_z_when_the_form_says_nothing(self) -> None:
        case = case_named("mirror", "lathe-z-counter-spindle")
        result = run_case(SCRIPT, case, z0=0)
        self.assertEqual(result["text"], case.expected_text())

    def test_x_u_and_i_stay_and_z_w_k_change_sign(self) -> None:
        case = case_named("mirror", "lathe-z-counter-spindle")
        before = case.input_text().split("\n")
        after = case.expected_text().split("\n")
        self.assertEqual((before[9], after[9]), ("G3 X40. W-5. K-5. I0.", "G2 X40. W5. K5. I0."))
        self.assertEqual((before[10], after[10]), ("G1 U5. W-2.", "G1 U5. W2."))

    def test_a_mirror_z_that_is_not_zero(self) -> None:
        case = case_named("mirror", "fanuc-lathe-b-z-mirror")
        self.assertEqual(case.params["z0"], -2.5)
        # Z' = 2 x (-2.5) - Z.
        self.assertIn("G0 X50. Z-7.", case.expected_text().split("\n"))


class FormTest(unittest.TestCase):
    def test_an_unknown_mirror_line_is_an_error(self) -> None:
        case = case_named("mirror", "fanuc-mill-x-decimal")
        context = helpers.geometry_context(case)
        context["params"] = {"about": "diagonal"}
        out = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertFalse(out.ok)
        self.assertIn("Mirror", out.stderr)

    def test_the_header_is_the_contract_of_the_readme(self) -> None:
        source = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8")
        # Q-C (the owner's answer of 2026-10-16): the geometry scripts get 900 s.
        for line in ('# input = "selection-or-document"', '# output = "replace"', "# envelope = true", "# timeout = 900"):
            self.assertIn(line, source)
        for field in ("about", "px", "py", "angle", "z0", "decimals"):
            self.assertIn('# id = "%s"' % field, source)
        for value in ("auto", "x-axis", "y-axis", "line", "z"):
            self.assertIn('value = "%s"' % value, source)

    def test_the_form_opens_on_automatic(self) -> None:
        # CODE-5 (the P4a review): "In X" as the first choice was refused on every lathe.
        source = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8")
        about = source[source.index('# id = "about"'):source.index('# id = "px"')]
        self.assertIn('# default = "auto"', about)
        choices = [line for line in about.split("\n") if "value = " in line]
        self.assertIn('value = "auto"', choices[0])
        self.assertTrue(choices[0].split('label = "')[1].startswith("Automatic"))

    def test_automatic_is_z_on_a_turning_program_and_x_on_a_milling_one(self) -> None:
        lathe = "\n".join(["(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "%", "O4220", "G18 G21 G99", "G0 X50. Z5.", "G1 Z-5. F0.2", "M30", "%"])
        result = run_text(SCRIPT, "fanuc-lathe", {"about": "auto", "z0": 0}, lathe)
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("G0 X50. Z-5.", result["text"].split("\n"))
        self.assertIn("Mirrored in Z", result["message"])
        mill = "\n".join(FANUC_TOP + ["G1 X-5. F100.", "M30", "%"])
        result = run_text(SCRIPT, "fanuc-gcode", {"about": "auto", "px": 0}, mill)
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("G0 X-5. Y3. Z5.", result["text"].split("\n"))
        self.assertIn("Mirrored in X", result["message"])


class FixRoundTest(unittest.TestCase):
    """The P4a review's findings in the run rotate and mirror share (batch B2)."""

    def test_an_increment_read_as_written_is_not_rounded_to_whole_millimetres(self) -> None:
        # NC-1: the line at 30 degrees reflects X10 Y10 to X13.660 Y3.660.
        text = "\n".join(["; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "N10 G90 G17 G71", "N20 G0 X0 Y0 Z5", "N30 G91 G1 X10 Y10 F100", "N40 M30"])
        result = run_text(SCRIPT, "sinumerik-mill", {"about": "line", "px": 0, "py": 0, "angle": 30}, text)
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("N30 G91 G1 X13.66 Y3.66 F100", result["text"].split("\n"))

    def test_a_selection_whose_lines_above_were_not_sent(self) -> None:
        # CODE-2: without them the mirror cannot see a G2/G3 or G41/G42 in force above.
        self.assertEqual(errors_of(case_named("mirror", "b2-selection-unprimed").envelope()), [(6, "selection-unprimed")])

    def test_the_first_move_writes_the_mirrored_axis(self) -> None:
        # CODE-4: from X5 Y3, `G1 X10.` mirrored in Y ends at X10 Y-3. (Not a golden: the
        # added word makes mirroring twice give the values back, not the bytes, which the
        # oracle asks of an axis mirror.)
        mirrored = run_text(SCRIPT, "fanuc-gcode", {"about": "x-axis", "py": 0}, "G1 Z-1. F100.\nG1 X10.\nG1 Y8.\nG0 Z5.", FANUC_TOP)
        self.assertEqual(mirrored["text"], "G1 Z-1. F100.\nG1 X10. Y-3.\nG1 Y-8.\nG0 Z5.")
        result = run_text(SCRIPT, "fanuc-gcode", {"about": "y-axis", "px": 0}, "G1 Y10. F100.\nG1 X8.", FANUC_TOP)
        self.assertEqual(result["text"], "G1 X-5. Y10. F100.\nG1 X-8.")

    def test_an_arc_from_a_point_on_the_mirror_line_is_mirrored(self) -> None:
        # The start X10 Y0 lies on the line Y0, so the mirror does not move it.
        above = FANUC_TOP[:4] + ["G0 X10. Y0. Z5.", "G1 Z-1. F100."]
        result = run_text(SCRIPT, "fanuc-gcode", {"about": "x-axis", "py": 0}, "G3 X0. Y10. I-10. J0.\nG1 X-5.", above)
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"].split("\n")[0], "G2 X0. Y-10. I-10. J0.")
        moved = run_text(SCRIPT, "fanuc-gcode", {"about": "x-axis", "py": 2}, "G3 X0. Y10. I-10. J0.\nG1 X-5.", above)
        self.assertEqual(errors_of(moved), [(7, "selection-start")])

    def test_the_lathe_z_mirror_of_a_selection(self) -> None:
        above = ["(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "%", "O4221", "G18 G21 G40 G99", "T0101", "G0 X50. Z5."]
        params = {"about": "z", "z0": 0}
        self.assertEqual(errors_of(case_named("mirror", "b2-lathe-selection-without-z-refused").envelope()), [(7, "selection-start")])
        self.assertEqual(errors_of(run_text(SCRIPT, "fanuc-lathe", params, "G1 W-3. F0.2\nG1 Z-10.", above)), [(7, "selection-start")])
        # A first move with Z, and an X increment beside it, joins the mirrored path.
        result = run_text(SCRIPT, "fanuc-lathe", params, "G1 U-5. Z-2. F0.2\nG1 Z-10.", above)
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"], "G1 U-5. Z2. F0.2\nG1 Z10.")

    def test_one_row_for_the_rounded_blocks_and_every_warning_listed(self) -> None:
        # CODE-8: 1,200 rounded blocks were 999 rows and pushed the helix warning out.
        lines = ["(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "%", "O4222", "G90 G17 G21", "G0 X0. Y0. Z5.", "G1 Z-1. F100."]
        lines += ["G1 X%.3f Y%.3f" % (i * 0.1, (i % 7) * 0.1) for i in range(1, 1201)]
        lines += ["G0 X10. Y0.", "G3 X10. Y0. Z-3. I-10. J0.", "M30", "%"]
        result = run_text(SCRIPT, "fanuc-gcode", {"about": "line", "px": 0, "py": 0, "angle": 30}, "\n".join(lines))
        reasons = [f["reason"] for f in result["findings"]]
        self.assertEqual(reasons.count("rounded"), 1)
        self.assertIn("helix-hand", reasons)
        self.assertIn("climb-milling", reasons)
        self.assertIn("(the first of 1,202 rounded blocks)", next(f["message"] for f in result["findings"] if f["reason"] == "rounded"))

    def test_the_cap_never_cuts_a_warning(self) -> None:
        # 1,100 information rows (machine positions) and a helix at the end.
        lines = ["(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "%", "O4223", "G90 G17 G21", "G0 X0. Y0. Z5."]
        lines += ["G53 G0 Z0."] * 1100
        lines += ["G0 X10. Y0. Z5.", "G1 Z-1. F100.", "G3 X10. Y0. Z-3. I-10. J0.", "M30", "%"]
        result = run_text(SCRIPT, "fanuc-gcode", {"about": "y-axis", "px": 0}, "\n".join(lines))
        self.assertFalse(refused(result), result["message"])
        reasons = [f["reason"] for f in result["findings"]]
        self.assertEqual(len(reasons), 1000)
        self.assertIn("helix-hand", reasons)
        self.assertIn("climb-milling", reasons)
        self.assertIn("102 further findings are not listed", result["message"])


class SharedEngineTest(unittest.TestCase):
    """rotate.py and mirror.py run on one engine, `_nc_run.plane_main` (the P4b prelude, TODO
    CODE-6): until then each carried a copy of it, word for word, that this test held equal.
    Now it holds that neither carries a copy again and that both hand the engine the texts
    of the run's own refusals for every id it knows."""

    OLD_MARK = "# The run: the same text in rotate.py and mirror.py"

    def test_both_scripts_run_on_the_shared_engine(self) -> None:
        import importlib

        helpers.import_gedit_nc()
        import _nc_run

        for name in ("rotate", "mirror"):
            source = (helpers.SCRIPTS_DIR / (name + ".py")).read_text(encoding="utf-8")
            with self.subTest(script=name):
                self.assertNotIn(self.OLD_MARK, source)
                self.assertNotIn("class Run", source)
                self.assertIn("_nc_run.plane_main(SCRIPT, Params, RUN_REASONS)", source)
                module = importlib.import_module(name)
                self.assertEqual(set(module.RUN_REASONS), set(_nc_run.PLANE_RUN_REASONS))
                self.assertIs(module.REASON_LABEL, _nc_run.REASON_LABEL)


class MirrorRegressionTest(unittest.TestCase):
    """Regression tests for gaps P4.4 found and the P4a Wave B integration fixed (plan §7 #300, #308, #309)."""

    def test_a_klartext_word_that_turns_positive_keeps_its_plus(self) -> None:
        # The Klartext profile writes signed words with a sign (`numberFormat.plusSign:
        # 'signed'`): `Y-2.5` mirrored about Y5 is `Y+12.5`, as the TNC writes it.
        case = case_named("mirror", "klartext-y-axis")
        text = case.input_text().replace("13 L Y+2.5 R0", "13 L Y-2.5 R0")
        result = run_case(SCRIPT, case, text, **case.params)
        self.assertIn("13 L Y+12.5 R0", result["text"].split("\n"))

    def test_a_rotary_axis_at_zero_is_mirrored_with_the_path(self) -> None:
        # AD-31's rotary rule about the tool axis: `A0. C0.` turns nothing, so the mirror
        # leaves it and goes on; an axis away from 0 refuses its block and every move while it
        # stands there.
        case = case_named("mirror", "fanuc-mill-x-decimal")
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 A0. C0.\n"
            "G0 X10. Y5. Z50.\nG1 X20. F100.\nG0 C30.\nG1 X30.\nM30"
        )
        result = run_case(SCRIPT, case, text, about="y-axis", px=0)
        self.assertEqual(
            [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"],
            [(6, "rotary-word"), (7, "rotary-word")],
        )
        zero = run_case(SCRIPT, case, text.replace("G0 C30.\n", "G0 C0.\n"), about="y-axis", px=0)
        self.assertFalse(refused(zero), zero["findings"])
        self.assertIn("G0 A0. C0.", zero["text"].split("\n"))
        self.assertIn("G1 X-30.", zero["text"].split("\n"))

    def test_a_selection_under_a_side_set_above_it_says_why(self) -> None:
        # `selection-mode`, not `selection-inside`: the selection cuts no cycle; it starts
        # under a G41 (or an arc direction) the mirror would have to swap above it.
        case = case_named("mirror", "fanuc-mill-selection-under-comp")
        self.assertEqual({f["reason"] for f in case.envelope()["findings"] if f["severity"] == "error"}, {"selection-mode"})
        result = run_case(SCRIPT, case, **case.params)
        self.assertEqual([f["reason"] for f in result["findings"] if f["severity"] == "error"], ["selection-mode", "selection-mode"])


class Wave1IntegrationTest(unittest.TestCase):
    """What the P4a fix batches handed each other, joined by the Wave 1 integration (plan §7)."""

    LATHE_ABOVE = ["; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "G18 G90 G71 G95", "G0 X40 Y5 Z0"]
    LATHE_Z = {"about": "z", "z0": 0}

    def test_y_and_j_change_sign_under_the_z_mirror(self) -> None:
        # Q-B: the golden flips Y about 0 and an incremental Y; X stays.
        case = case_named("mirror", "b1-lathe-y-sign")
        before = case.input_text().split("\n")
        after = case.expected_text().split("\n")
        self.assertEqual((before[4], after[4]), ("G0 Y10.5", "G0 Y-10.5"))
        self.assertEqual((before[5], after[5]), ("G1 X30 Y=IC(-4) Z-12", "G1 X30 Y=IC(4) Z12"))
        # The centre word along Y (J) changes sign too; I and X stay.
        text = "\n".join(self.LATHE_ABOVE[:2] + ["G0 X40 Y0 Z2", "G2 X30 Z-5 I-5 K0 J4", "M30"])
        result = run_text(SCRIPT, "sinumerik", self.LATHE_Z, text)
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"].split("\n")[3], "G3 X30 Z5 I-5 K0 J-4")

    def test_the_first_move_of_a_selection_minds_y_under_the_z_mirror(self) -> None:
        # The tool stands at Y5 above the selection, a point the Z mirror moves to Y-5.
        incremental = run_text(SCRIPT, "sinumerik", self.LATHE_Z, "G1 Y=IC(-4) F0.2\nM30", self.LATHE_ABOVE)
        self.assertEqual(errors_of(incremental), [(4, "selection-start")])
        without_y = run_text(SCRIPT, "sinumerik", self.LATHE_Z, "G1 X30 Z-5 F0.2\nM30", self.LATHE_ABOVE)
        self.assertEqual(errors_of(without_y), [(4, "selection-start")])
        with_y = run_text(SCRIPT, "sinumerik", self.LATHE_Z, "G1 X30 Y2 Z-5 F0.2\nM30", self.LATHE_ABOVE)
        self.assertFalse(refused(with_y), with_y["findings"])
        self.assertEqual(with_y["text"], "G1 X30 Y-2 Z5 F0.2\nM30")
        # On the turning axis (Y0) the mirror does not move the tool: no Y is needed.
        on_axis = self.LATHE_ABOVE[:2] + ["G0 X40 Y0 Z0"]
        result = run_text(SCRIPT, "sinumerik", self.LATHE_Z, "G1 X30 Z-5 F0.2\nM30", on_axis)
        self.assertFalse(refused(result), result["findings"])

    def test_a_mirror_at_45_degrees_writes_exact_increments(self) -> None:
        # transform is exact at 45 degrees (B1, NC-19), so an increment keeps its own form and is
        # not written as the difference of two rounded points.
        text = "\n".join(FANUC_TOP[:4] + ["G0 X10. Y0. Z5.", "G91 G1 X10. Y5. F100.", "G1 X-2.5", "G90", "M30", "%"])
        result = run_text(SCRIPT, "fanuc-gcode", {"about": "line", "px": 0, "py": 0, "angle": 45}, text, preset="is-b")
        self.assertFalse(refused(result), result["findings"])
        lines = result["text"].split("\n")
        self.assertEqual(lines[5:7], ["G91 G1 X5. Y10. F100.", "G1 X0.0 Y-2.5"])
        self.assertNotIn("rounded", [f["reason"] for f in result["findings"]])

    def test_every_reason_the_message_counts_has_a_label(self) -> None:
        import importlib

        import _nc_geom

        for name, ops in (("rotate", ("rotate",)), ("mirror", ("mirror", "lathe-z-mirror"))):
            module = importlib.import_module(name)
            need = [k for k, (applies, _) in _nc_geom.REASONS.items() if set(applies) & set(ops)]
            need += list(module.RUN_REASONS)
            with self.subTest(script=name):
                self.assertEqual([k for k in need if k not in module.REASON_LABEL], [])

    def test_the_message_words_the_new_reasons(self) -> None:
        jump = "\n".join(FANUC_TOP[:4] + ["G0 X0. Y0. Z5.", "GOTO 10", "G91", "N10 G1 X5. F100.", "M30", "%"])
        result = run_text(SCRIPT, "fanuc-gcode", {"about": "y-axis", "px": 0}, jump)
        self.assertIn("1 block a jump or a loop may reach with other settings", result["message"])
        chamfer = "G90 G18\nG0 X20 Z2\nG1 Z0 F0.2\nG1 X60 G75 L-2\nM02"
        result = run_text(SCRIPT, "okuma-osp", self.LATHE_Z, chamfer)
        self.assertIn("chamfer or corner round whose sign sets the next move", result["message"])
        pocket = "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CYCL DEF 251 RECTANGULAR POCKET ~\n  Q218=+60 ;FIRST SIDE LENGTH\n3 END PGM P MM"
        result = run_text(SCRIPT, "heidenhain-klartext", {"about": "y-axis", "px": 0}, pocket)
        self.assertIn("cycle with an angle or a corner of its own", result["message"])

    def test_the_blank_is_one_sentence_of_the_message(self) -> None:
        # Q-D: the BLK FORM is left as written, said once; it is not "Left 1 block as written: ."
        text = "\n".join([
            "BEGIN PGM P MM", "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
            "BLK FORM 0.1 Z X+0 Y+0 Z-20", "BLK FORM 0.2 X+100 Y+100 Z+0", "TOOL CALL 1 Z S5000",
            "L X+10 Y+5 Z+5 R0 FMAX", "L Z-1 F100", "L X+20", "L M91 Z-10 R0 FMAX", "END PGM P MM",
        ])
        for script, params in (("mirror.py", {"about": "x-axis", "py": 0}), ("rotate.py", {"cx": 0, "cy": 0, "angle": 90})):
            with self.subTest(script=script):
                result = run_text(script, "heidenhain-klartext", params, text)
                self.assertFalse(refused(result), result["findings"])
                self.assertIn("Left 1 block as written: 1 position in machine coordinates. The workpiece blank (BLK FORM) is left as written.", result["message"])
                self.assertNotIn("as written: .", result["message"])
                self.assertEqual([f["line"] for f in result["findings"] if f["reason"] == "blank"], [3])


class D2FixTest(unittest.TestCase):
    """v1.2.0 NC fix round, batch D2 (path and geometry): NCR-2 and NCR-3 under the lathe Z
    mirror. Each test fails without its fix, except those marked as guards."""

    Z = {"about": "z", "z0": 0}
    TOP = ["%", "O1000"]  # the line numbers of the review
    #: The review's repro: a facing pass with a taper, a second one under it in force.
    FACING = ["G0 X60. Z2.", "G94 X20. Z-5. R-1. F0.2", "G0 X60. Z2.", "G94 X10. Z-6.", "G0 X100. Z50.", "M30", "%"]
    #: Turning passes without a taper.
    PASSES = ["G0 X60. Z2.", "G90 X50. Z-20. F0.2", "X48.", "X46.", "G0 X100. Z50.", "M30", "%"]

    def select(self, lines, start, end, params=None, variant=None):
        """Lines ``start`` to ``end`` (1-based, counting TOP) of TOP + ``lines``, as a selection."""
        program = self.TOP + list(lines)
        context = helpers.effective_context("fanuc-lathe", variant=variant) if variant else helpers.effective_context("fanuc-lathe")
        context["params"] = dict(params or self.Z)
        context["input"] = {"scope": "selection", "startLine": start, "endLine": end, "precedingLines": program[: start - 1]}
        out = helpers.run_script(SCRIPT, stdin="\n".join(program[start - 1 : end]), context=context)
        self.assertTrue(out.ok, out.stderr)
        return out.json()

    # -- NCR-2: a taper in force along Z -------------------------------------------------------

    def test_ncr2_a_facing_taper_in_force_from_above_refuses_the_selection(self) -> None:
        self.assertEqual(errors_of(self.select(self.FACING, 5, 7)), [(6, "single-pass-taper")])

    def test_ncr2_a_taper_in_force_with_no_rapid_between(self) -> None:
        lines = ["G0 X60. Z2.", "G94 X20. Z-5. R-1. F0.2", "X10. Z-6.", "G0 X100. Z50.", "M30", "%"]
        self.assertIn((5, "single-pass-taper"), errors_of(self.select(lines, 5, 5)))

    def test_ncr2_g79_in_system_b(self) -> None:
        lines = ["G90 G0 X60. Z2.", "G79 X20. Z-5. R-1. F0.2", "G0 X60. Z2.", "G79 X10. Z-6.", "G0 X100. Z50.", "M30", "%"]
        result = self.select(lines, 5, 7, variant=("gcodeSystem", "B"))
        self.assertEqual(errors_of(result), [(6, "single-pass-taper")])

    def test_ncr2_ncr4_g79_of_system_a(self) -> None:
        # The A file reads G79 as a facing pass with its taper along Z since D3 (NCR-4).
        lines = [line.replace("G94", "G79") for line in self.FACING]
        self.assertEqual(errors_of(self.select(lines, 5, 7)), [(6, "single-pass-taper")])

    def test_ncr2_after_a_subprogram_call_the_taper_is_not_known(self) -> None:
        lines = ["G0 X60. Z2.", "G94 X20. Z-5. F0.2", "M98 P100", "G0 X60. Z2.", "G94 X10. Z-6.", "G0 X100. Z50.", "M30", "%"]
        self.assertEqual(errors_of(self.select(lines, 6, 8)), [(7, "single-pass-taper")])
        # The same after a macro call (G65), which the tracker forgets everything at.
        lines[2] = "G65 P9010 A1."
        self.assertEqual(errors_of(self.select(lines, 6, 8)), [(7, "single-pass-taper")])

    def test_ncr2_r0_is_no_taper(self) -> None:
        lines = ["G18 G21", "G0 X60. Z2.", "G94 X20. Z-5. R0. F0.2", "G0 X60. Z2.", "G94 X10. Z-6.", "G0 X100. Z50.", "M30", "%"]
        result = run_text(SCRIPT, "fanuc-lathe", self.Z, "\n".join(self.TOP + lines))
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("G94 X20. Z5. R0. F0.2\nG0 X60. Z-2.\nG94 X10. Z6.", result["text"])

    def test_ncr2_a_taper_along_x_or_cleared_is_mirrored_and_a_dwell_keeps_it(self) -> None:
        # A G90 taper lies along X, which the Z mirror keeps; a plane code clears a taper (guards); a
        # dwell does not.
        lines = ["G0 X60. Z2.", "G90 X50. Z-20. R-2. F0.2", "G0 X60. Z2.", "G90 X48. Z-20.", "G0 X100. Z50.", "M30", "%"]
        result = self.select(lines, 5, 7)
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"], "G0 X60. Z-2.\nG90 X48. Z20.\nG0 X100. Z-50.")
        cleared = self.FACING[:2] + ["G18"] + self.FACING[2:]
        self.assertFalse(refused(self.select(cleared, 6, 8)))
        dwell = self.FACING[:2] + ["G04 X1."] + self.FACING[2:]
        self.assertEqual(errors_of(self.select(dwell, 6, 8)), [(7, "single-pass-taper")])

    # -- NCR-3: a selection among single passes -------------------------------------------------

    def test_ncr3_a_selection_that_starts_at_a_pass_is_refused(self) -> None:
        self.assertIn((4, "selection-start"), errors_of(self.select(self.PASSES, 4, 6)))
        self.assertIn((5, "selection-start"), errors_of(self.select(self.PASSES, 5, 6)))

    def test_ncr3_a_selection_that_ends_while_the_passes_are_in_force(self) -> None:
        self.assertEqual(errors_of(self.select(self.PASSES, 3, 5)), [(5, "selection-inside")])
        # Guard (n3e): the passes and the rapids on both sides are written.
        result = self.select(self.PASSES, 3, 7)
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"], "G0 X60. Z-2.\nG90 X50. Z20. F0.2\nX48.\nX46.\nG0 X100. Z-50.")

    def test_ncr3_a_pass_that_takes_its_z_from_above_the_selection(self) -> None:
        # Mirror Z2: the start Z2 does not move, but the end Z-20 of the passes, written above
        # the selection, would have to become Z24.
        lines = ["G0 X60. Z2.", "G90 X50. Z-20. F0.2", "G0 X60. Z2.", "G90 X48.", "G0 X100. Z50.", "M30", "%"]
        result = self.select(lines, 5, 7, {"about": "z", "z0": 2})
        self.assertEqual(errors_of(result), [(6, "selection-start")])

    def test_ncr3_an_unknown_start_in_z_refuses_the_first_move(self) -> None:
        lines = ["G0 X60. Z#1", "G0 X50.", "G1 Z-10. F0.2", "M30", "%"]
        self.assertEqual(errors_of(self.select(lines, 4, 5)), [(4, "selection-start")])


class OwnerPublicTest(unittest.TestCase):
    """X21 over the owner-public programs: mirroring twice gives every value back on every
    program the mirror does not refuse; the refusals are printed per reason, not asserted."""

    def test_twice(self) -> None:
        programs = owner_public()
        def params_of(pid: str) -> Dict[str, object]:
            lathe = helpers.effective_context(pid)["profile"].get("machineType") == "lathe"
            return {"about": "z"} if lathe else {"about": "y-axis"}
        results = run_owner_public([(rel, "once", SCRIPT, params_of(pid)) for rel, pid, _ in programs])
        counts: Dict[str, Dict[str, int]] = {}
        kept: List[str] = []
        for rel, pid, text in programs:
            result = results[(rel, "once")]
            if refused(result):
                self.assertEqual(result["text"], text, rel)
                counts[rel] = refusal_counts(result)
                continue
            with self.subTest(program=rel):
                twice = run_long(SCRIPT, result["text"], pid, params_of(pid))
                self.assertFalse(refused(twice))
                assert_values_back(self, text, twice["text"], helpers.effective_context(pid)["profile"])
                kept.append("%s (twice gives every value back)" % rel)
        print_counts("mirror twice over the owner-public programs", counts, kept)
        # A refused run is clean by itself, so a floor keeps a script that came to refuse everything
        # from passing. Measured on 2026-10-16: 5 of the 20 programs are mirrored and come back; the
        # floor is one below. A deliberate new refusal may lower it, in the commit that adds it.
        self.assertGreaterEqual(len(kept), 4, "mirror wrote %d of the 20 owner-public programs: a new refusal? lower the floor on purpose" % len(kept))



class WalkCountTest(unittest.TestCase):
    """P4a fix batch B6 (CODE-1): the arc check walks the written program again only to look at the arcs it wrote."""

    PARAMS = {"about": "line", "px": 5, "py": -3, "angle": 30}

    def test_a_rounded_mirror_without_an_arc_walks_the_program_once(self) -> None:
        import mirror

        text = "G21 G17 G90\nG0 X10. Y0.\nG1 X20.5 Y5.25 F200.\nG1 X-4. Y8.\nM30"
        with CountedTrackers() as trackers:
            result = in_process(mirror, "fanuc-gcode", self.PARAMS, text)
        self.assertIn("rounded", result["message"])
        self.assertEqual(len(trackers.made), 1, trackers.made)

    def test_a_rounded_mirror_with_an_arc_looks_at_the_arcs_it_wrote(self) -> None:
        import mirror

        text = "G21 G17 G90\nG0 X10. Y0.\nG3 X0. Y10. I-10. J0. F200.\nG1 X-4. Y8.\nM30"
        with CountedTrackers() as trackers:
            result = in_process(mirror, "fanuc-gcode", self.PARAMS, text)
        self.assertEqual([made for made in trackers.made][1:], [{"reach": False, "flow": False}])
        self.assertIn("G2 ", result["text"])


class LaterVersionTest(unittest.TestCase):
    """Wave Y, BL-NC-geometry: the later-version transforms under the mirror. Each test fails
    without its change."""

    Z = {"about": "z"}
    HEAD = ["%", "O0071 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "G18 G21 G40 G99", "T0101", "G0 X60. Z2."]
    G71 = ["G71 U2. R0.5", "G71 P10 Q20 U0.4 W0.1 F0.25", "N10 G0 X20.", "G1 Z-15. F0.15", "X30. W-10.", "N20 G1 X60.", "G70 P10 Q20"]
    TAIL = ["G0 X100. Z50.", "M30", "%"]

    def errors(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_t015_a_roughing_cycle_with_its_contour_is_mirrored(self) -> None:
        # The P4a prelude's case list (FANUC 0i-F lathe manual, the stock removal cycles): the
        # contour is points, W of the second block of G71 and G72 and both W of G73 change sign,
        # the depth of cut and the retract stay.
        result = run_text("mirror.py", "fanuc-lathe", self.Z, "\n".join(self.HEAD + self.G71 + self.TAIL))
        self.assertEqual(self.errors(result), [])
        lines = result["text"].split("\n")
        self.assertEqual(lines[5:12], ["G71 U2. R0.5", "G71 P10 Q20 U0.4 W-0.1 F0.25", "N10 G0 X20.", "G1 Z15. F0.15", "X30. W10.", "N20 G1 X60.", "G70 P10 Q20"])
        g72 = ["G72 W1.5 R0.5", "G72 P10 Q20 U0.2 W0.1 F0.2", "N10 G0 Z-25.", "G1 X20.", "N20 Z0."]
        lines = run_text("mirror.py", "fanuc-lathe", self.Z, "\n".join(self.HEAD + g72 + self.TAIL))["text"].split("\n")
        self.assertEqual(lines[5:7], ["G72 W1.5 R0.5", "G72 P10 Q20 U0.2 W-0.1 F0.2"])
        g73 = ["G73 U3. W-2. R3", "G73 P10 Q20 U0.4 W0.2 F0.25", "N10 G0 X20. Z0.", "G1 Z-20.", "N20 X60."]
        lines = run_text("mirror.py", "fanuc-lathe", self.Z, "\n".join(self.HEAD + g73 + self.TAIL))["text"].split("\n")
        self.assertEqual(lines[5:7], ["G73 U3. W2. R3", "G73 P10 Q20 U0.4 W-0.2 F0.25"])

    def test_t015_a_contour_outside_the_scope_is_still_refused(self) -> None:
        program = self.HEAD + self.G71 + self.TAIL
        # The selection holds the cycle and G70 but not the whole contour.
        found = self.errors(run_text("mirror.py", "fanuc-lathe", self.Z, "\n".join(program[5:9]), preceding=program[:5]))
        self.assertIn((6, "roughing-cycle"), found)
        self.assertIn((7, "roughing-cycle"), found)
        # The first block alone, its second below the selection.
        found = self.errors(run_text("mirror.py", "fanuc-lathe", self.Z, "\n".join(program[5:6]), preceding=program[:5]))
        self.assertEqual(found, [(6, "roughing-cycle")])
        # G70 whose contour lies above the selection.
        found = self.errors(run_text("mirror.py", "fanuc-lathe", self.Z, "\n".join(program[11:13]), preceding=program[:11]))
        self.assertIn((12, "lathe-cycle"), found)
        # A block number that stands twice: which contour the control takes is not certain.
        twice = self.HEAD + self.G71 + ["N10 G0 X100. Z50."] + self.TAIL
        self.assertIn((7, "roughing-cycle"), self.errors(run_text("mirror.py", "fanuc-lathe", self.Z, "\n".join(twice))))

    def test_t015_d5_10_the_taper_passes_stay_refused(self) -> None:
        # Manual check D5-10: a pass with a taper stays refused under the Z mirror in v1.2.0.
        text = "\n".join(self.HEAD + ["G90 X50. Z-20. R-2. F0.2", "G94 X20. Z-2. R-1. F0.2"] + self.TAIL)
        found = self.errors(run_text("mirror.py", "fanuc-lathe", self.Z, text))
        self.assertIn((6, "single-pass-taper"), found)
        self.assertIn((7, "single-pass-taper"), found)


if __name__ == "__main__":
    unittest.main()

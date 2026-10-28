"""`_nc_geom.py`, the transform rules (Phase 4 plan §6.1, AD-41 to AD-44; P4.2).

Written by the P4a prelude as the cases P4.2 must make pass, and extended by P4.2: the
vocabulary of the stub (the roles, the operations, every refusal reason of X22 as a stable id
with a plain text, the warnings, the tolerances of Q4-4); the operations on each role
(exactness on decimal text, the lathe Z mirror); the swaps from data; the write-back in the
word's own form and the rounding of Q4-4; the arc check after rounding; the role of the words
in each dialect and each refusal reason on a block that has it.

The last three run twice: on :class:`HandTracker`, a stand-in for the P4.1 tracker built here
by hand (the members ``_nc_geom`` reads), and on the real tracker of P4.1 (since the Wave A
integration, ``p4a/intA``).

The programs are synthetic, written for gEdit.
"""

from __future__ import annotations

import unittest
from decimal import Decimal

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()
import _nc_geom  # noqa: E402  (the bundled folder is on sys.path from here on)
import _nc_path  # noqa: E402


D = Decimal

#: The scalar roles no operation changes (a radius keeps its sign: AD-44, the prelude's case list).
KEPT_ROLES = ("radius", "arc-angle", "turns", "polar-radius", "polar-radius-inc", "length", "data", "untouched")

#: Every refusal X22 names, by the id the plan's §6.1 gives it. A reason that is renamed or
#: dropped fails here before any golden notices.
X22_REASONS = {
    "frame": "a frame or shift in force (G68, G51.1, G16, ROT, MIRROR, SCALE, Klartext 8, 10, 26, PLANE, 19)",
    "coordinate-shift": "a coordinate setting or shift (G92 as a setting, G52, G10, TRANS, Klartext 7)",
    "rotary-word": "tool centre point control with a rotary word in scope (rotate, mirror)",
    "expression": "a variable or expression in a moved word",
    "call": "a subprogram or macro call (M98, G65, G66, CALL LBL, CALL PGM, L…, a Sinumerik name call)",
    "cycle-not-reviewed": "a cycle with a parameter not reviewed",
    "cycle-position": "a cycle with a parameter whose role is other (pockets, patterns, PATTERN DEF)",
    "fk-contour": "an FK contour",
    "arc-tangential": "CT, CTP, CIP under rotate and mirror",
    "arc-unsupported": "Okuma L-radius arcs, G102/G103",
    "plane": "a plane other than XY (rotate, mirror); the lathe Z mirror needs G18",
    "lathe-rotate": "a rotate on a lathe",
    "lathe-x-mirror": "a mirror of X on a lathe",
    "thread": "under the lathe Z mirror: a thread cycle (G76, G92, G32)",
    "roughing-cycle": "under the lathe Z mirror: a roughing cycle G71-G73",
    "lathe-cycle": "under the lathe Z mirror: the turning cycles (prelude item 5)",
    "machine-dependent": "a point-less word whose reading depends on the machine with no machine chosen",
    "distance-assumed": "a distance mode that is only assumed (Q4-5)",
    "axis-unwritten": "an axis the shift must move that the program never writes before its first moved block",
    "selection-inside": "a selection that starts or ends inside a cycle or a Klartext multi-line block",
    "intermediate-point": "an absolute intermediate point that the transform would change (Q4-6)",
}


class VocabularyTest(unittest.TestCase):
    """The final part of the stub."""

    def test_every_x22_reason_has_an_id_and_a_plain_text(self) -> None:
        for reason in X22_REASONS:
            with self.subTest(reason=reason):
                self.assertIn(reason, _nc_geom.REASONS)
                ops, text = _nc_geom.REASONS[reason]
                self.assertTrue(set(ops) <= set(_nc_geom.ALL_OPS), ops)
                self.assertGreater(len(text), 20)
                # A plain sentence that follows "<as written>: ": no capital at the start, no
                # full stop at the end (the message adds it), no reason id in it.
                self.assertTrue(text[0].islower(), text)
                self.assertFalse(text.endswith("."), text)

    def test_the_ids_are_kebab_case_and_do_not_overlap(self) -> None:
        ids = list(_nc_geom.REASONS) + list(_nc_geom.INFO) + list(_nc_geom.WARNINGS)
        self.assertEqual(len(ids), len(set(ids)))
        for reason in ids:
            with self.subTest(reason=reason):
                self.assertRegex(reason, r"^[a-z]+(-[a-z0-9]+)*$")

    def test_the_lathe_reasons_belong_to_the_lathe_z_mirror(self) -> None:
        for reason in ("thread", "roughing-cycle", "lathe-cycle", "single-pass-taper"):
            with self.subTest(reason=reason):
                self.assertEqual(_nc_geom.REASONS[reason][0], ("lathe-z-mirror",))
        self.assertEqual(_nc_geom.REASONS["lathe-rotate"][0], ("rotate",))
        self.assertEqual(_nc_geom.REASONS["lathe-x-mirror"][0], ("mirror",))

    def test_the_warnings_the_plan_names(self) -> None:
        self.assertEqual(_nc_geom.WARNINGS["climb-milling"][0], ("mirror",))
        self.assertEqual(_nc_geom.WARNINGS["tool-nose"][0], ("lathe-z-mirror",))
        self.assertIn("tool nose direction", _nc_geom.WARNINGS["tool-nose"][1])
        self.assertIn("climb milling", _nc_geom.WARNINGS["climb-milling"][1])

    def test_the_tolerances_of_q4_4(self) -> None:
        self.assertEqual(_nc_geom.ARC_TOLERANCE, {"mm": D("0.002"), "inch": D("0.0001")})
        self.assertEqual(_nc_geom.MIN_DECIMALS, {"mm": 3, "inch": 4})
        # The extents' chord slack is the same 0.002 (in the program's units).
        self.assertEqual(_nc_path.CHORD_SLACK, _nc_geom.ARC_TOLERANCE["mm"])

    def test_the_operations(self) -> None:
        self.assertEqual(set(_nc_geom.OPS), set(_nc_geom.ALL_OPS))
        self.assertEqual(_nc_geom.LatheZMirror().z0, D(0))
        self.assertIsNone(_nc_geom.Translate({"X": D(1)}).x_reading)

    def test_the_roles(self) -> None:
        for role in ("point", "point-inc", "centre", "centre-inc", "radius", "arc-angle", "turns", "direction",
                     "polar-radius", "polar-radius-inc", "polar-angle", "polar-angle-inc", "pole", "pole-inc",
                     "cycle-position", "tool-axis", "length", "data", "code-arc", "code-comp", "untouched", "unknown"):
            with self.subTest(role=role):
                self.assertIn(role, _nc_geom.ROLES)

    def test_the_stub_is_implemented(self) -> None:
        # CODE-12: the stub's error is gone (nothing raised it since P4.2).
        self.assertFalse(hasattr(_nc_geom, "GeomNotImplemented"))
        self.assertTrue(_nc_geom.is_exact(_nc_geom.Translate({"X": D(1)})))


class ExactnessTest(unittest.TestCase):
    def test_which_operations_are_exact(self) -> None:
        exact = [
            _nc_geom.Translate({"X": D("0.1")}),
            _nc_geom.LatheZMirror(D("2.5")),
            _nc_geom.Rotate((D(0), D(0)), D(90)),
            _nc_geom.Rotate((D("1.5"), D(2)), D(-270)),
            _nc_geom.Rotate((D(0), D(0)), D(360)),
            _nc_geom.Mirror((D("12.5"), D(0)), D(90)),
            _nc_geom.Mirror((D(0), D("-3")), D(0)),
        ]
        inexact = [
            _nc_geom.Rotate((D(0), D(0)), D(30)),
            _nc_geom.Rotate((D(0), D(0)), D("90.5")),
            _nc_geom.Mirror((D(0), D(0)), D(45)),
        ]
        for op in exact:
            with self.subTest(op=op):
                self.assertTrue(_nc_geom.is_exact(op))
        for op in inexact:
            with self.subTest(op=op):
                self.assertFalse(_nc_geom.is_exact(op))


class TransformTest(unittest.TestCase):
    """Each operation on each role (contract item 3; X19 to X21)."""

    def t(self, role, value, op):
        return _nc_geom.transform(role, value, op)

    def test_translate_moves_absolute_values_only(self) -> None:
        op = _nc_geom.Translate({"X": D("0.1"), "Y": D(-2), "Z": D("0.5")})
        self.assertEqual(self.t("point", {"X": D(10), "Z": D(-1)}, op), ({"X": D("10.1"), "Z": D("-0.5")}, True))
        self.assertEqual(self.t("centre", {"X": D(5), "Y": D(5)}, op), ({"X": D("5.1"), "Y": D(3)}, True))
        self.assertEqual(self.t("pole", {"X": D(50), "Y": D(50)}, op), ({"X": D("50.1"), "Y": D(48)}, True))
        self.assertEqual(self.t("tool-axis", {"Z": D(2)}, op), ({"Z": D("2.5")}, True))
        for role, value in [("point-inc", {"X": D(5)}), ("centre-inc", {"X": D(5), "Y": D(0)}), ("pole-inc", {"X": D(1)})]:
            with self.subTest(role=role):
                self.assertEqual(self.t(role, value, op), (value, True))
        for role in ("radius", "polar-radius", "polar-angle", "polar-angle-inc", "arc-angle", "length"):
            with self.subTest(role=role):
                self.assertEqual(self.t(role, D(30), op), (D(30), True))

    def test_translate_by_d_and_then_by_minus_d_gives_the_value_back(self) -> None:
        there, _ = self.t("point", {"X": D("10.")}, _nc_geom.Translate({"X": D("0.1")}))
        back, _ = self.t("point", there, _nc_geom.Translate({"X": D("-0.1")}))
        self.assertEqual(back, {"X": D(10)})

    def test_a_lathe_x_shift_follows_how_the_form_reads_x(self) -> None:
        # Coordinates are geometric: a diameter word X40 is 20 here. A shift of 1 asked as a
        # diameter is 0.5 of radius; asked as a radius it is 1.
        self.assertEqual(self.t("point", {"X": D(20)}, _nc_geom.Translate({"X": D(1)}, "diameter")), ({"X": D("20.5")}, True))
        self.assertEqual(self.t("point", {"X": D(20)}, _nc_geom.Translate({"X": D(1)}, "radius")), ({"X": D(21)}, True))

    def test_rotate_by_90_degrees_is_exact(self) -> None:
        op = _nc_geom.Rotate((D(0), D(0)), D(90))
        self.assertEqual(self.t("point", {"X": D(10), "Y": D(5)}, op), ({"X": D(-5), "Y": D(10)}, True))
        self.assertEqual(self.t("point-inc", {"X": D(1), "Y": D(0)}, op), ({"X": D(0), "Y": D(1)}, True))
        self.assertEqual(self.t("centre-inc", {"X": D(2), "Y": D(1)}, op), ({"X": D(-1), "Y": D(2)}, True))
        about = _nc_geom.Rotate((D(10), D(10)), D(180))
        self.assertEqual(self.t("point", {"X": D(12), "Y": D(10)}, about), ({"X": D(8), "Y": D(10)}, True))

    def test_rotate_turns_the_polar_angle_and_keeps_the_increment(self) -> None:
        op = _nc_geom.Rotate((D(0), D(0)), D(90))
        self.assertEqual(self.t("polar-angle", D(30), op), (D(120), True))
        self.assertEqual(self.t("polar-angle-inc", D(30), op), (D(30), True))
        self.assertEqual(self.t("radius", D(-5), op), (D(-5), True))

    def test_four_rotations_by_90_give_every_value_back(self) -> None:
        op = _nc_geom.Rotate((D("1.5"), D("-2")), D(90))
        value = {"X": D("12.345"), "Y": D("-6.789")}
        for _ in range(4):
            value, exact = self.t("point", value, op)
            self.assertTrue(exact)
        self.assertEqual(value, {"X": D("12.345"), "Y": D("-6.789")})

    def test_any_other_angle_is_not_exact(self) -> None:
        value, exact = self.t("point", {"X": D(10), "Y": D(0)}, _nc_geom.Rotate((D(0), D(0)), D(30)))
        self.assertFalse(exact)
        self.assertAlmostEqual(float(value["X"]), 8.660254037844387, places=9)
        self.assertAlmostEqual(float(value["Y"]), 5.0, places=9)

    def test_mirror_about_an_axis_parallel_line_through_a_decimal_point(self) -> None:
        op = _nc_geom.Mirror((D("12.5"), D(0)), D(90))  # the line X12.5: X flips
        self.assertEqual(self.t("point", {"X": D(10), "Y": D(3)}, op), ({"X": D(15), "Y": D(3)}, True))
        self.assertEqual(self.t("centre-inc", {"X": D(2), "Y": D(1)}, op), ({"X": D(-2), "Y": D(1)}, True))
        self.assertEqual(self.t("polar-angle", D(30), op), (D(150), True))
        self.assertEqual(self.t("polar-angle-inc", D(30), op), (D(-30), True))
        about_x = _nc_geom.Mirror((D(0), D(0)), D(0))  # the X axis: Y flips
        self.assertEqual(self.t("polar-angle", D(30), about_x), (D(-30), True))
        # An opening angle and a radius keep their values; the direction swaps elsewhere.
        self.assertEqual(self.t("arc-angle", D("140.134"), op), (D("140.134"), True))
        self.assertEqual(self.t("radius", D(-10), op), (D(-10), True))

    def test_mirroring_twice_gives_every_value_back(self) -> None:
        op = _nc_geom.Mirror((D("12.5"), D(0)), D(90))
        value = {"X": D("3.25"), "Y": D(7)}
        once, _ = self.t("point", value, op)
        twice, _ = self.t("point", once, op)
        self.assertEqual(twice, value)

    def test_the_lathe_z_mirror(self) -> None:
        op = _nc_geom.LatheZMirror(D(5))
        self.assertEqual(self.t("point", {"Z": D(2), "X": D(20)}, op), ({"Z": D(8), "X": D(20)}, True))
        self.assertEqual(self.t("point-inc", {"Z": D(-3), "X": D(1)}, op), ({"Z": D(3), "X": D(1)}, True))
        self.assertEqual(self.t("centre-inc", {"Z": D(-10), "X": D(0)}, op), ({"Z": D(10), "X": D(0)}, True))
        self.assertEqual(self.t("radius", D(20), op), (D(20), True))
        zero = _nc_geom.LatheZMirror()
        self.assertEqual(self.t("point", {"Z": D("-12.5")}, zero), ({"Z": D("12.5")}, True))

    def test_an_unknown_word_has_no_transform(self) -> None:
        with self.assertRaises(ValueError):
            self.t("unknown", D(1), _nc_geom.Translate({"X": D(1)}))


class SwapTest(unittest.TestCase):
    """Contract item 4: the partner of a flagged code, from data."""

    def entry(self, dialect, code):
        return next(e for e in helpers.resolved_codes(dialect) if e.get("code") == code)

    def test_the_partner_of_each_flagged_code(self) -> None:
        cases = [
            ("fanuc", "G2", "arcDirection", "G3"),
            ("fanuc", "G3", "arcDirection", "G2"),
            ("fanuc", "G41", "compSide", "G42"),
            ("fanuc-lathe", "G42", "compSide", "G41"),
            ("fanuc-lathe-b", "G2", "arcDirection", "G3"),
            ("okuma", "G3", "arcDirection", "G2"),
            ("sinumerik", "G41", "compSide", "G42"),
            ("heidenhain", "RL", "compSide", "RR"),
        ]
        for dialect, code, flag, want in cases:
            with self.subTest(dialect=dialect, code=code):
                codes = helpers.resolved_codes(dialect)
                self.assertEqual(_nc_geom.swap_partner(self.entry(dialect, code), codes, flag), want)

    def test_no_partner_for_a_code_without_the_flag(self) -> None:
        for dialect, code, flag in [("fanuc", "G41.2", "compSide"), ("okuma", "G102", "arcDirection"),
                                    ("sinumerik", "CIP", "arcDirection"), ("fanuc", "G1", "arcDirection")]:
            with self.subTest(dialect=dialect, code=code):
                codes = helpers.resolved_codes(dialect)
                self.assertIsNone(_nc_geom.swap_partner(self.entry(dialect, code), codes, flag))

    def test_two_partners_are_none(self) -> None:
        codes = [dict(e) for e in helpers.resolved_codes("fanuc")]
        codes.append({"code": "G43.9", "group": "compensation", "label": "x", "sets": {"radiusComp": "on", "compSide": "right"}})
        self.assertIsNone(_nc_geom.swap_partner(self.entry("fanuc", "G41"), codes, "compSide"))

    def test_the_klartext_direction_word(self) -> None:
        profile = helpers.resolved_profile("heidenhain-klartext")
        self.assertEqual(_nc_geom.swap_word("DR+", profile), "DR-")
        self.assertEqual(_nc_geom.swap_word("DR-", profile), "DR+")
        self.assertIsNone(_nc_geom.swap_word("DR+", helpers.resolved_profile("fanuc-gcode")))


class ArcCheckTest(unittest.TestCase):
    """AD-44: after rounding, the radius at the start and at the end within 0.002 mm."""

    def arc(self, end):
        return _nc_path.Arc(
            line=7, plane=("X", "Y"), direction="ccw", form="centre", centre=(D(0), D(0)),
            start=(D(10), D(0)), end=end, full=False, sweep=None, helix={},
        )

    def test_a_rounded_arc_within_the_tolerance_passes(self) -> None:
        self.assertEqual(_nc_geom.check_arcs([self.arc((D(0), D("10.002")))], "mm"), [])

    def test_one_beyond_it_refuses_the_run_at_that_arc(self) -> None:
        refusals = _nc_geom.check_arcs([self.arc((D(0), D("10.003")))], "mm")
        self.assertEqual([(r.line, r.reason) for r in refusals], [(7, "arc-check")])

    def test_inch_has_its_own_tolerance(self) -> None:
        self.assertEqual(_nc_geom.check_arcs([self.arc((D(0), D("10.0001")))], "inch"), [])
        self.assertEqual(len(_nc_geom.check_arcs([self.arc((D(0), D("10.0002")))], "inch")), 1)


class MoreTransformTest(unittest.TestCase):
    """Each operation on each role, beyond the prelude's cases (X19 to X21, AD-44)."""

    def t(self, role, value, op):
        return _nc_geom.transform(role, value, op)

    def test_every_kept_role_keeps_its_value_under_every_operation(self) -> None:
        ops = [
            _nc_geom.Translate({"X": D(3), "Y": D(4), "Z": D(5)}),
            _nc_geom.Rotate((D(1), D(2)), D(30)),
            _nc_geom.Mirror((D(1), D(2)), D(45)),
            _nc_geom.LatheZMirror(D(7)),
        ]
        for role in KEPT_ROLES:
            for op in ops:
                with self.subTest(role=role, op=_nc_geom.op_name(op)):
                    self.assertEqual(self.t(role, D("-12.5"), op), (D("-12.5"), True))

    def test_the_absolute_vector_roles_move_like_points(self) -> None:
        for role in ("point", "centre", "pole", "cycle-position"):
            with self.subTest(role=role):
                self.assertEqual(self.t(role, {"X": D(1), "Y": D(2)}, _nc_geom.Translate({"X": D(1)})), ({"X": D(2), "Y": D(2)}, True))
                self.assertEqual(self.t(role, {"X": D(1), "Y": D(2)}, _nc_geom.Rotate((D(1), D(1)), D(180))), ({"X": D(1), "Y": D(0)}, True))
                self.assertEqual(self.t(role, {"X": D(1), "Y": D(2)}, _nc_geom.Mirror((D(0), D(5)), D(0))), ({"X": D(1), "Y": D(8)}, True))
                self.assertEqual(self.t(role, {"Z": D(1), "X": D(2)}, _nc_geom.LatheZMirror(D(-1))), ({"Z": D(-3), "X": D(2)}, True))

    def test_the_incremental_vector_roles_turn_but_do_not_shift(self) -> None:
        for role in ("point-inc", "centre-inc", "pole-inc"):
            with self.subTest(role=role):
                self.assertEqual(self.t(role, {"X": D(1), "Y": D(2)}, _nc_geom.Translate({"X": D(9)})), ({"X": D(1), "Y": D(2)}, True))
                self.assertEqual(self.t(role, {"X": D(1), "Y": D(2)}, _nc_geom.Rotate((D(50), D(50)), D(270))), ({"X": D(2), "Y": D(-1)}, True))
                self.assertEqual(self.t(role, {"X": D(1), "Y": D(2)}, _nc_geom.Mirror((D(50), D(50)), D(90))), ({"X": D(-1), "Y": D(2)}, True))
                self.assertEqual(self.t(role, {"Z": D(1), "X": D(2)}, _nc_geom.LatheZMirror(D(30))), ({"Z": D(-1), "X": D(2)}, True))
                # An increment left out is a zero move along its axis.
                self.assertEqual(self.t(role, {"X": D(5)}, _nc_geom.Rotate((D(0), D(0)), D(90))), ({"X": D(0), "Y": D(5)}, True))

    def test_the_tool_axis_role_moves_with_the_tool_axis_only(self) -> None:
        self.assertEqual(self.t("tool-axis", {"Z": D(2)}, _nc_geom.Translate({"X": D(1), "Z": D("-0.5")})), ({"Z": D("1.5")}, True))
        self.assertEqual(self.t("tool-axis", {"Z": D(2)}, _nc_geom.Rotate((D(0), D(0)), D(30))), ({"Z": D(2)}, True))
        self.assertEqual(self.t("tool-axis", {"Z": D(2)}, _nc_geom.Mirror((D(0), D(0)), D(0))), ({"Z": D(2)}, True))

    def test_a_helix_keeps_its_third_axis(self) -> None:
        op = _nc_geom.Rotate((D(0), D(0)), D(90))
        self.assertEqual(self.t("point", {"X": D(10), "Y": D(0), "Z": D(-3)}, op), ({"X": D(0), "Y": D(10), "Z": D(-3)}, True))
        mirror = _nc_geom.Mirror((D(0), D(0)), D(90))
        self.assertEqual(self.t("point-inc", {"X": D(1), "Y": D(1), "Z": D(-1)}, mirror), ({"X": D(-1), "Y": D(1), "Z": D(-1)}, True))

    def test_rotate_by_360_is_the_identity(self) -> None:
        op = _nc_geom.Rotate((D("3.3"), D("-1.1")), D(360))
        self.assertTrue(_nc_geom.is_exact(op))
        self.assertEqual(self.t("point", {"X": D("12.345"), "Y": D("0.5")}, op), ({"X": D("12.345"), "Y": D("0.5")}, True))
        self.assertEqual(self.t("centre-inc", {"X": D("-2.5"), "Y": D(1)}, op), ({"X": D("-2.5"), "Y": D(1)}, True))
        self.assertEqual(self.t("polar-angle", D(30), op), (D(30), True))
        self.assertEqual(self.t("polar-angle", D(-350), _nc_geom.Rotate((D(0), D(0)), D(-90))), (D(-80), True))

    def test_whole_turns_add_nothing_to_a_polar_angle(self) -> None:
        # P4a integration (plan §7 #306): PA+30 turned by -360 stays PA+30 (it was PA-330), by
        # 720.5 it is PA+30.5; a turn that is not whole keeps its sign (by -60 it is -30); a
        # mirror line at 180 degrees reflects like the one at 0.
        rotate = lambda deg: _nc_geom.Rotate((D(0), D(0)), D(deg))  # noqa: E731
        self.assertEqual(self.t("polar-angle", D(30), rotate(-360)), (D(30), True))
        self.assertEqual(self.t("polar-angle", D(30), rotate("720.5")), (D("30.5"), True))
        self.assertEqual(self.t("polar-angle", D(30), rotate(-60)), (D(-30), True))
        self.assertEqual(self.t("polar-angle", D(30), rotate(270)), (D(300), True))
        self.assertEqual(self.t("polar-angle", D(30), _nc_geom.Mirror((D(0), D(0)), D(180))), (D(-30), True))
        self.assertEqual(self.t("polar-angle", D(30), _nc_geom.Mirror((D(0), D(0)), D(270))), (D(150), True))

    def test_rotate_by_180_and_270_is_exact(self) -> None:
        self.assertEqual(self.t("point", {"X": D("1.25"), "Y": D(2)}, _nc_geom.Rotate((D(0), D(0)), D(180))), ({"X": D("-1.25"), "Y": D(-2)}, True))
        self.assertEqual(self.t("point", {"X": D("1.25"), "Y": D(2)}, _nc_geom.Rotate((D(0), D(0)), D(270))), ({"X": D(2), "Y": D("-1.25")}, True))
        self.assertEqual(self.t("point", {"X": D("1.25"), "Y": D(2)}, _nc_geom.Rotate((D(0), D(0)), D(-90))), ({"X": D(2), "Y": D("-1.25")}, True))

    def test_a_mirror_at_45_degrees_is_no_axis_mirror_but_computes_exactly(self) -> None:
        # P4a fix B1 (NC-19): the run still writes both axes (`is_exact` is False: no axis
        # mirror), but the value is exact decimal arithmetic and says so, so a word keeps its
        # own decimals (`X10.` -> `Y10.`, not `Y10.000`).
        op = _nc_geom.Mirror((D(0), D(0)), D(45))
        value, exact = self.t("point", {"X": D("10.5"), "Y": D(3)}, op)
        self.assertTrue(exact)
        self.assertFalse(_nc_geom.is_exact(op))
        self.assertEqual(value, {"X": D(3), "Y": D("10.5")})
        self.assertEqual(self.t("point", {"X": D(1), "Y": D(0)}, _nc_geom.Mirror((D(0), D(0)), D(135))), ({"X": D(0), "Y": D(-1)}, True))
        self.assertEqual(self.t("point", {"X": D(1), "Y": D(0)}, _nc_geom.Mirror((D(0), D(0)), D(30)))[1], False)

    def test_a_mirror_at_any_angle_twice_gives_the_value_back_within_the_carried_digits(self) -> None:
        op = _nc_geom.Mirror((D(2), D(1)), D(30))
        once, exact = self.t("point", {"X": D("12.5"), "Y": D(-4)}, op)
        self.assertFalse(exact)
        twice, _ = self.t("point", once, op)
        self.assertAlmostEqual(float(twice["X"]), 12.5, places=9)
        self.assertAlmostEqual(float(twice["Y"]), -4.0, places=9)

    def test_the_lathe_z_mirror_twice_gives_every_value_back(self) -> None:
        op = _nc_geom.LatheZMirror(D("-7.25"))
        for role, value in [("point", {"Z": D("3.1"), "X": D(40)}), ("point-inc", {"Z": D("-2")}), ("centre-inc", {"Z": D(5), "X": D(1)})]:
            with self.subTest(role=role):
                once, _ = self.t(role, value, op)
                twice, _ = self.t(role, once, op)
                self.assertEqual(twice, value)

    def test_a_lathe_translate_moves_an_absolute_centre_as_a_radius(self) -> None:
        # I=AC(...) on a lathe is a coordinate (a radius); a diameter shift of 2 moves it by 1.
        self.assertEqual(self.t("centre", {"X": D(10), "Z": D(0)}, _nc_geom.Translate({"X": D(2), "Z": D(1)}, "diameter")), ({"X": D(11), "Z": D(1)}, True))

    def test_an_absolute_vector_needs_both_axes_of_the_plane(self) -> None:
        with self.assertRaises(ValueError):
            self.t("point", {"X": D(10)}, _nc_geom.Rotate((D(0), D(0)), D(90)))

    def test_the_swapped_roles_have_no_transform(self) -> None:
        for role in _nc_geom.SWAPPED_ROLES:
            with self.subTest(role=role):
                with self.assertRaises(ValueError):
                    self.t(role, D(1), _nc_geom.Mirror((D(0), D(0)), D(0)))

    def test_which_words_an_operation_affects(self) -> None:
        def role(kind, axis):
            return _nc_geom.WordRole(None, kind, axis, "length")

        translate = _nc_geom.Translate({"X": D(1), "Z": D(0)})
        self.assertTrue(_nc_geom.affects(role("point", "X"), translate))
        self.assertFalse(_nc_geom.affects(role("point", "Z"), translate))  # a shift of 0 moves nothing
        self.assertFalse(_nc_geom.affects(role("point-inc", "X"), translate))
        rotate = _nc_geom.Rotate((D(0), D(0)), D(30))
        self.assertTrue(_nc_geom.affects(role("centre-inc", "Y"), rotate))
        self.assertFalse(_nc_geom.affects(role("point", "Z"), rotate))
        self.assertFalse(_nc_geom.affects(role("code-arc", None), rotate))
        self.assertTrue(_nc_geom.affects(role("code-arc", None), _nc_geom.Mirror((D(0), D(0)), D(0))))
        lathe = _nc_geom.LatheZMirror()
        self.assertTrue(_nc_geom.affects(role("point-inc", "Z"), lathe))
        self.assertFalse(_nc_geom.affects(role("point", "X"), lathe))
        # Q-B (2026-10-16): Y and its centre word J change sign under the Z mirror.
        self.assertTrue(_nc_geom.affects(role("point", "Y"), lathe))
        self.assertTrue(_nc_geom.affects(role("point-inc", "Y"), lathe))
        self.assertTrue(_nc_geom.affects(role("centre-inc", "Y"), lathe))


class MoreSwapTest(unittest.TestCase):
    def test_a_partner_is_written_in_the_style_of_the_code_it_replaces(self) -> None:
        self.assertEqual(_nc_geom.partner_text("G02", "G3"), "G03")
        self.assertEqual(_nc_geom.partner_text("G2", "G3"), "G3")
        self.assertEqual(_nc_geom.partner_text("g42", "G41"), "g41")
        self.assertEqual(_nc_geom.partner_text("G002", "G3"), "G003")
        self.assertEqual(_nc_geom.partner_text("RL", "RR"), "RR")

    def test_the_okuma_and_sinumerik_partners(self) -> None:
        for dialect, code, flag, want in [("okuma", "G41", "compSide", "G42"), ("sinumerik", "G2", "arcDirection", "G3"),
                                          ("heidenhain", "RR", "compSide", "RL"), ("fanuc-lathe-b", "G41", "compSide", "G42")]:
            with self.subTest(dialect=dialect, code=code):
                codes = helpers.resolved_codes(dialect)
                entry = next(e for e in codes if e.get("code") == code)
                self.assertEqual(_nc_geom.swap_partner(entry, codes, flag), want)

    def test_a_word_with_no_other_direction(self) -> None:
        profile = {"addresses": {"arcDirectionWords": {"DR+": "ccw"}}}
        self.assertIsNone(_nc_geom.swap_word("DR+", profile))
        self.assertIsNone(_nc_geom.swap_word("DR", helpers.resolved_profile("heidenhain-klartext")))


class FindingTest(unittest.TestCase):
    def test_a_refusal_reads_as_the_goldens_write_it(self) -> None:
        refusal = _nc_geom.Refusal(7, "roughing-cycle", "G71 U2. R0.5")
        self.assertEqual(
            _nc_geom.finding_of(refusal),
            {
                "line": 7,
                "severity": "error",
                "message": "G71 U2. R0.5: a roughing cycle that works from a contour (its finishing allowance along Z has a direction); gEdit does not mirror it yet.",
                "reason": "roughing-cycle",
            },
        )
        info = _nc_geom.finding_of(_nc_geom.Refusal(13, "machine-position", "G91 G28 Z0."))
        self.assertEqual(info["severity"], "info")
        self.assertEqual(info["message"], "G91 G28 Z0.: a position in machine coordinates or an incremental return to the reference point; left as written.")

    def test_a_warning_reads_as_the_goldens_write_it(self) -> None:
        self.assertEqual(
            _nc_geom.warning_of("tool-nose", 6)["message"],
            "Mirrored for the counter spindle: the tool nose direction (the cutting edge position in each tool's offset) is not in the program. Set it for the counter spindle before this program runs.",
        )
        self.assertEqual(_nc_geom.warning_of("climb-milling", 3)["severity"], "warning")


class ArcAfterRoundingTest(unittest.TestCase):
    """AD-44 end to end: an arc rotated by an angle that is not a quarter turn, its words rounded
    by write_word, then checked."""

    def rounded(self, point, op):
        context, tracker, steps = walk("G90 G17 G21\nG0 X10.000 Y0.000", "fanuc-gcode", tracker=HandTracker)
        roles = {r.token.address: r for r in _nc_geom.roles_of(steps[-1], tracker)}
        value, exact = _nc_geom.transform("point", {"X": point[0], "Y": point[1]}, op)
        out = []
        for axis in ("X", "Y"):
            written = _nc_geom.write_word(roles[axis], value[axis], tracker, "mm", exact, context)
            out.append(D(written.text[1:]))
        return tuple(out)

    def test_a_good_arc_stays_good(self) -> None:
        op = _nc_geom.Rotate((D(0), D(0)), D(30))
        arc = _nc_path.Arc(line=3, plane=("X", "Y"), direction="ccw", form="centre", centre=(D(0), D(0)),
                           start=self.rounded((D(10), D(0)), op), end=self.rounded((D(0), D(10)), op), full=False, sweep=None, helix={})
        self.assertEqual(_nc_geom.check_arcs([arc], "mm"), [])

    def test_an_arc_near_the_tolerance_is_refused_after_rounding(self) -> None:
        # The post wrote the end 0.0015 off the circle: inside the tolerance as written; turned
        # by 30 degrees and rounded to three decimals it falls outside.
        op = _nc_geom.Rotate((D(0), D(0)), D(30))
        start = (D(10), D(0))
        end = (D(0), D("10.0015"))
        before = _nc_path.Arc(line=3, plane=("X", "Y"), direction="ccw", form="centre", centre=(D(0), D(0)),
                              start=start, end=end, full=False, sweep=None, helix={})
        self.assertEqual(_nc_geom.check_arcs([before], "mm"), [])
        after = _nc_path.Arc(line=3, plane=("X", "Y"), direction="ccw", form="centre", centre=(D(0), D(0)),
                             start=self.rounded(start, op), end=self.rounded(end, op), full=False, sweep=None, helix={})
        self.assertEqual((after.start, after.end), ((D("8.660"), D("5.000")), (D("-5.001"), D("8.662"))))
        refused = _nc_geom.check_arcs([after], "mm")
        self.assertEqual([(r.line, r.reason) for r in refused], [(3, "arc-check")])

    def test_a_radius_arc_keeps_its_radius_and_its_chord_is_checked(self) -> None:
        self.assertIsNone(_nc_geom.check_chord(4, (D(0), D(0)), (D("10.002"), D(0)), D(5), "mm"))
        refused = _nc_geom.check_chord(4, (D(0), D(0)), (D("10.003"), D(0)), D(-5), "mm")
        self.assertEqual((refused.line, refused.reason), (4, "arc-check"))
        self.assertIsNotNone(_nc_geom.check_chord(4, (D(0), D(0)), (D("1.0002"), D(0)), D("0.5"), "inch"))


# ---------------------------------------------------------------------------
# The tracker: the real one of P4.1 and a stand-in
# ---------------------------------------------------------------------------


class HandTracker:
    """A stand-in for ``_nc_path.PathTracker`` with what ``_nc_geom`` reads of it (``profile``,
    ``cp``, ``codes``, ``interp``) and Steps built the way §6.1 describes them (the tokens, the
    written codes, the unknown codes, the moves and how each was read, the position before and
    after, the pole, the cycle run, the units). It computes no arcs and keeps no columns: the
    rules do not need them, and the real tracker is P4.1's."""

    def __init__(self, context, cp):
        self.profile = context["profile"]
        self.cp = cp
        self.codes = context.get("codes") or []
        self.interp = gedit_nc.ModalInterpreter(cp, self.codes)
        self.machine = gedit_nc.machine_params(context)
        self.context = context
        addresses = self.profile.get("addresses") or {}
        self.twins = gedit_nc.incremental_axes(self.profile)
        listed = [str(a).upper() for a in addresses.get("axes") or []]
        self.order = [a for a in listed if a not in self.twins] + [a for a in self.twins.values() if a not in listed]
        self.pos = {axis: None for axis in self.order}
        self.pole = {}
        self.report_units = None
        heads = set()
        for entry in self.codes:
            heads.add("".join(ch for ch in str(entry.get("code") or "").split(" ")[0] if ch.isalpha()).upper())
        self.heads = heads
        self.code_heads = {
            str(e.get("code"))[0].upper() for e in self.codes
            if e.get("group") == "motion" and len(str(e.get("code"))) > 1 and str(e.get("code"))[0].isalpha() and str(e.get("code"))[1].isdigit()
        }

    def axis_of(self, address):
        word = address.upper()
        if word in self.twins:
            return self.twins[word]
        return word if word in self.order else None

    def written(self, tokens):
        entries, unknown, calls = [], [], []
        interp = self.interp
        for i, token in enumerate(tokens):
            if token.kind == "word" and token.address and not gedit_nc.is_assignment(token):
                address = token.address.upper()
                head = "".join(ch for ch in address if ch.isalpha())
                code = address + (token.value_text or "")
                entry = interp.entry(code)
                if entry is not None:
                    entries.append((entry, entry.get("code"), "word"))
                elif head in self.code_heads and token.value is not None and len(address) == 1:
                    unknown.append(token.text)
            elif token.kind == "call":
                calls.append(token)
                entry = interp.entry(token.address or "")
                if entry is not None:
                    entries.append((entry, entry.get("code"), "call"))
            elif token.kind == "keyword":
                name = token.address or token.text
                number = token.value_text
                if number is None:
                    nxt = next((t for t in tokens[i + 1:] if t.kind != "whitespace"), None)
                    if nxt is not None and nxt.address is None and nxt.value_text is not None:
                        number = nxt.value_text
                entry = interp.entry("%s %s" % (name, number)) if number is not None else None
                if entry is None and number is not None and "." in number:
                    entry = interp.entry("%s %s" % (name, number.split(".")[0]))
                if entry is None:
                    entry = interp.entry(name)
                if entry is not None:
                    entries.append((entry, entry.get("code"), "keyword"))
        return entries, unknown, calls

    def value(self, token, units, entries, number_class=None):
        literal, _ = _nc_path.literal_of(token)
        if literal is None:
            return None, []
        cls = number_class or gedit_nc.number_class_of(token.address or "", self.profile, self.interp.feed_unit, entries, self.interp.pitch_feed)
        text, readings = gedit_nc.resolve_value(literal, cls, self.machine, self.profile, units or "mm")
        return _nc_path.dec(text), readings

    def line(self, text, number, state, record):
        tokens, state = gedit_nc.tokenize_line(text, self.cp, state)
        masked = gedit_nc.mask_comments(text, self.cp)
        start = gedit_nc.program_start_of(text, self.cp)
        if start is not None and self.interp.program_start(number):
            self.pos = {axis: None for axis in self.order}
        self.interp.update(tokens, number, masked)
        step = _nc_path.Step(number)
        step.tokens, step.masked = tokens, masked
        written, unknown, calls = self.written(tokens)
        step.entries, step.unknown_codes, step.calls = written, unknown, calls
        entries = [e for e, _, _ in written]
        st = self.interp.state
        units = st["units"]["value"]
        step.units = units if units in ("mm", "inch") else None
        if step.units and self.report_units is None and record:
            self.report_units = step.units
        moves = []
        for token in tokens:
            if token.kind == "word" and token.address and token.index is None:
                step.words[token.address.upper()] = token
                axis = self.axis_of(token.address)
                if axis is not None and (token.value_text or "") != "":
                    moves.append((axis, token))
        step.moves = moves
        step.before = dict(self.pos)
        block = st["block"]
        step.cycle = block.get("cycle") or (self.interp.active_cycle if moves else None)
        flags = [gedit_nc.axis_words_of(e) for e in entries]
        if "machine" in flags:
            step.kind = "machine"
            for axis, _ in moves:
                self.pos[axis] = None
        elif "data" in flags:
            if any(e.get("pole") == "set" for e in entries):
                step.kind = "pole"
                plane = _nc_path.PLANE_AXES.get(st["plane"] or "")
                pole = {a: self.pos.get(a) for a in (plane or ())}
                for axis, token in moves:
                    value, _ = self.value(token, step.units, entries)
                    if value is None:
                        pole[axis] = None
                    elif token.incremental:
                        pole[axis] = None if pole.get(axis) is None else pole[axis] + value
                    else:
                        pole[axis] = value
                self.pole = {a: v for a, v in pole.items() if v is not None}
            else:
                step.kind = "data"
                if any(e.get("wordsAreData") is True for e in entries):
                    self.pos = {axis: None for axis in self.order}
        else:
            distance = st["distance"]
            for axis, token in moves:
                address = token.address.upper()
                literal, function = _nc_path.literal_of(token)
                if address in self.twins or token.incremental or function == "incremental":
                    incremental = True
                elif function == "absolute":
                    incremental = False
                elif distance in ("absolute", "incremental"):
                    incremental = distance == "incremental"
                else:
                    incremental = None
                value, _ = self.value(token, step.units, entries) if literal is not None else (None, [])
                why = None if value is not None else ("expression" if literal is None else "machine-dependent")
                step.reads.append(_nc_path.WordRead(axis, token, address, incremental, function, value, None, why))
                if value is None or incremental is None:
                    self.pos[axis] = None
                elif incremental:
                    self.pos[axis] = None if self.pos.get(axis) is None else self.pos[axis] + value
                else:
                    self.pos[axis] = value
            step.kind = "move" if moves else "none"
        step.after = dict(self.pos)
        step.pole = dict(self.pole)
        return state, step


def walk(text, profile_id, preset=None, upto=None, tracker=None, codes=None):
    """A tracker over ``text`` as the scripts will run it, stopped after line ``upto`` (all of
    them by default): the rules read the tracker's state after the step's line."""
    context = helpers.effective_context(profile_id, preset=preset) if preset else helpers.effective_context(profile_id)
    if codes is not None:
        context["codes"] = codes
    cp = gedit_nc.compile_profile(context["profile"])
    tracker = (tracker or _nc_path.PathTracker)(context, cp)
    state = None
    steps = []
    for number, line in enumerate(text.strip("\n").split("\n"), 1):
        state, step = tracker.line(line, number, state, True)
        steps.append(step)
        if upto is not None and number == upto:
            break
    return context, tracker, steps


class RolesCases:
    """Contract items 1 and 2: the role of every word, in each dialect, from data."""

    TRACKER = None

    def roles(self, text, profile_id, line, preset=None, codes=None):
        _, tracker, steps = walk(text, profile_id, preset=preset, upto=line, tracker=self.TRACKER, codes=codes)
        return {(r.token.text.strip(), r.role) for r in _nc_geom.roles_of(steps[line - 1], tracker)}

    def test_fanuc_mill(self) -> None:
        got = self.roles("G90 G17 G21\nG0 X0. Y0. Z5.\nG2 X10. Y0. I5. J0. F200.", "fanuc-gcode", 3)
        self.assertLessEqual({("G2", "code-arc"), ("X10.", "point"), ("I5.", "centre-inc"), ("F200.", "untouched")}, got)
        got = self.roles("G90 G17 G21\nG0 X0. Y0. Z5.\nG81 X10. Y10. Z-5. R2. F100.", "fanuc-gcode", 3)
        self.assertLessEqual({("X10.", "cycle-position"), ("R2.", "tool-axis"), ("Z-5.", "cycle-position")}, got)
        got = self.roles("G91 G17 G21\nG1 X5. F100.", "fanuc-gcode", 2)
        self.assertIn(("X5.", "point-inc"), got)

    def test_fanuc_lathe(self) -> None:
        got = self.roles("G18 G21\nG0 X40. Z2.\nG1 W-5. U2. F0.2\nG2 X50. Z-10. R5.", "fanuc-lathe", 3)
        self.assertLessEqual({("W-5.", "point-inc"), ("U2.", "point-inc")}, got)
        got = self.roles("G18 G21\nG0 X40. Z2.\nG2 X50. Z-10. R5.", "fanuc-lathe", 3)
        self.assertIn(("R5.", "radius"), got)

    def test_klartext(self) -> None:
        text = "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CC X+5 Y+0\n3 L X+0 Y+0 RL F100\n4 C X+10 Y+0 DR-\n5 LP PR+5 IPA+30\n6 END PGM P MM"
        self.assertIn(("X+5", "pole"), self.roles(text, "heidenhain-klartext", 3))
        self.assertIn(("RL", "code-comp"), self.roles(text, "heidenhain-klartext", 4))
        self.assertIn(("DR-", "direction"), self.roles(text, "heidenhain-klartext", 5))
        self.assertLessEqual({("PR+5", "polar-radius"), ("IPA+30", "polar-angle-inc")}, self.roles(text, "heidenhain-klartext", 6))

    def test_sinumerik(self) -> None:
        got = self.roles("G90 G17 G71\nG0 X0 Y0\nG3 X10 Y0 I=AC(5) J=AC(0) AR=180", "sinumerik-mill", 3)
        self.assertLessEqual({("I=AC(5)", "centre"), ("AR=180", "arc-angle")}, got)
        got = self.roles("G90 G17 G71\nG0 X0 Y0\nG2 X10 Y0 CR=5 TURN=1", "sinumerik-mill", 3)
        self.assertLessEqual({("CR=5", "radius"), ("TURN=1", "turns")}, got)
        got = self.roles("G90 G17 G71\nG0 X0 Y0\nG1 AP=45 RP=10", "sinumerik-mill", 3)
        self.assertLessEqual({("AP=45", "unknown"), ("RP=10", "unknown")}, got)

    def test_okuma(self) -> None:
        got = self.roles("G90 G18\nG0 X40 Z2\nG2 X50 Z-10 I5 K0", "okuma-osp", 3)
        self.assertLessEqual({("I5", "centre-inc"), ("K0", "centre-inc"), ("G2", "code-arc")}, got)

    # P4.2: every built-in dialect, every kind of word.

    def test_fanuc_mill_more(self) -> None:
        got = self.roles("G90 G17 G21\nG0 X0. Y0. Z5.\nG41 D1 G1 X5. Y5. F100. S2000 M3 T1", "fanuc-gcode", 3)
        self.assertLessEqual({("G41", "code-comp"), ("D1", "untouched"), ("S2000", "untouched"), ("T1", "untouched")}, got)
        self.assertNotIn("G1", {t for t, _ in got})  # a code without a flag is not listed
        got = self.roles("G90 G17 G21\nG0 X0. Y0. Z5.\nG4 X1.5", "fanuc-gcode", 3)
        self.assertIn(("X1.5", "data"), got)
        got = self.roles("G90 G17 G21\nG0 X0. Y0. Z5.\nG91 G28 Z0.", "fanuc-gcode", 3)
        self.assertIn(("Z0.", "data"), got)
        got = self.roles("G90 G17 G21\nG0 X0. Y0. Z5.\nG91 G81 X10. Y0. Z-5. R-3. F100.", "fanuc-gcode", 3)
        self.assertLessEqual({("X10.", "point-inc"), ("Z-5.", "point-inc"), ("R-3.", "point-inc")}, got)
        got = self.roles("G90 G17 G21\nG0 X0. Y0. Z5.\nG2 X10. Y0. R5. Z-1.", "fanuc-gcode", 3)
        self.assertLessEqual({("R5.", "radius"), ("Z-1.", "point")}, got)
        got = self.roles("G90 G17 G21\nG0 X0. Y0. Z5. B0.", "fanuc-gcode", 2)
        self.assertIn(("B0.", "point"), got)

    def test_fanuc_lathe_system_b(self) -> None:
        text = "G18 G21 G90\nG0 X40. Z2.\nG91 G1 Z-5. F0.2\nG90 G2 X50. Z-10. I5. K0."
        got = self.roles(text, "fanuc-lathe", 3, codes=helpers.resolved_codes("fanuc-lathe-b"))
        self.assertIn(("Z-5.", "point-inc"), got)
        got = self.roles(text, "fanuc-lathe", 4, codes=helpers.resolved_codes("fanuc-lathe-b"))
        self.assertLessEqual({("X50.", "point"), ("I5.", "centre-inc"), ("K0.", "centre-inc"), ("G2", "code-arc")}, got)
        got = self.roles("G18 G21\nG0 X40. Z2.\nG71 U2. R0.5", "fanuc-lathe", 3)
        self.assertIn(("U2.", "data"), got)

    def test_sinumerik_turning(self) -> None:
        got = self.roles("G18 G90 G71\nDIAMON\nG0 X40 Z2\nG1 Z=IC(-10) X=AC(30) F0.2", "sinumerik", 4)
        self.assertLessEqual({("Z=IC(-10)", "point-inc"), ("X=AC(30)", "point"), ("F0.2", "untouched")}, got)
        got = self.roles("G18 G90 G71\nG0 X40 Z2\nG3 X30 Z-5 K=AC(-5) I=AC(10)", "sinumerik", 3)
        self.assertLessEqual({("K=AC(-5)", "centre"), ("I=AC(10)", "centre"), ("G3", "code-arc")}, got)
        got = self.roles("G18 G90 G71\nG0 X40 Z2\nG33 Z-20 K1.5", "sinumerik", 3)
        self.assertIn(("K1.5", "untouched"), got)  # the lead of G33, not an arc centre
        got = self.roles("G18 G90 G71\nG0 X40 Z2 S1=1000 LIMS=3000", "sinumerik", 2)
        self.assertLessEqual({("S1=1000", "untouched"), ("LIMS=3000", "untouched")}, got)

    def test_sinumerik_milling_cycles_and_intermediate_points(self) -> None:
        got = self.roles("G90 G17 G71\nG0 X0 Y0 Z5\nCYCLE81(10,0,2,-5)", "sinumerik-mill", 3)
        self.assertLessEqual({("10", "tool-axis"), ("0", "tool-axis"), ("2", "untouched"), ("-5", "tool-axis")}, got)
        got = self.roles("G90 G17 G71\nG0 X0 Y0\nCIP X10 Y0 I1=5 J1=5", "sinumerik-mill", 3)
        self.assertLessEqual({("I1=5", "centre"), ("J1=5", "centre"), ("X10", "point")}, got)
        got = self.roles("G90 G17 G71\nG0 X0 Y0\nMCALL CYCLE81(10,0,2,-5)\nX20 Y5", "sinumerik-mill", 4)
        self.assertLessEqual({("X20", "cycle-position"), ("Y5", "cycle-position")}, got)

    def test_klartext_cycles_and_approaches(self) -> None:
        text = ("0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CYCL DEF 200 BOHREN ~\n  Q200=+2 ~\n  Q203=+0 ~\n  Q201=-10\n"
                "3 CYCL CALL POS X+10 Y+20 Z+0\n4 L IX+5 R0 FMAX\n5 RND R5\n6 END PGM P MM")
        self.assertIn(("Q203=+0", "tool-axis"), self.roles(text, "heidenhain-klartext", 5))
        self.assertIn(("Q200=+2", "untouched"), self.roles(text, "heidenhain-klartext", 4))
        self.assertLessEqual({("X+10", "cycle-position"), ("Z+0", "cycle-position")}, self.roles(text, "heidenhain-klartext", 7))
        self.assertIn(("IX+5", "point-inc"), self.roles(text, "heidenhain-klartext", 8))
        self.assertIn(("R5", "length"), self.roles(text, "heidenhain-klartext", 9))
        got = self.roles("0 BEGIN PGM P MM\n1 L X+40 Y+10 R0 FMAX\n2 APPR CT X+10 Y+20 CCA180 R+10 RR F100", "heidenhain-klartext", 3)
        self.assertLessEqual({("X+10", "point"), ("R+10", "radius"), ("RR", "code-comp")}, got)

    def test_okuma_more(self) -> None:
        got = self.roles("G90 G18\nG0 X40 Z2\nG2 X50 Z-10 L20", "okuma-osp", 3)
        self.assertIn(("L20", "radius"), got)
        got = self.roles("G90 G18\nG0 X40 Z2\nG91 G1 Z-5 F0.2", "okuma-osp", 3)
        self.assertIn(("Z-5", "point-inc"), got)


class RolesTest(RolesCases, unittest.TestCase):
    TRACKER = _nc_path.PathTracker


class HandRolesTest(RolesCases, unittest.TestCase):
    TRACKER = HandTracker


TRANSLATE = _nc_geom.Translate({"X": D(1), "Y": D(1), "Z": D(1)})
ROTATE = _nc_geom.Rotate((D(0), D(0)), D(90))
MIRROR = _nc_geom.Mirror((D(0), D(0)), D(90))
#: Wave Y (T016): the rounding operations, under which a tangential arc or an arc through a
#: point is still refused.
ROTATE_30 = _nc_geom.Rotate((D(0), D(0)), D(30))
MIRROR_30 = _nc_geom.Mirror((D(0), D(0)), D(30))
LATHE = _nc_geom.LatheZMirror()


class ReasonsCases:
    """Every refusal of X22 on a block that has it, under the operations it applies to."""

    TRACKER = None

    CASES = [
        ("frame", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG68 X0. Y0. R30.\nG1 X10. F100.", 4, TRANSLATE),
        ("coordinate-shift", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG52 X10. Y0.", 3, TRANSLATE),
        ("expression", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG1 X#1 F100.", 3, TRANSLATE),
        ("call", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG65 P9001 X5.", 3, TRANSLATE),
        ("machine-dependent", "fanuc-gcode", "G90 G17 G21\nG0 X1000 Y0.", 2, TRANSLATE),
        ("distance-assumed", "fanuc-gcode", "G17 G21\nG0 X0. Y0.", 2, TRANSLATE),
        ("axis-unwritten", "fanuc-gcode", "G90 G17 G21\nG91 G1 Z-1. F100.", 2, _nc_geom.Translate({"Z": D(1)})),
        ("position-unknown", "fanuc-gcode", "G90 G17 G21\nG0 X0.\nG1 X10. F100.", 3, ROTATE),
        ("unknown-code", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG123 X5.", 3, TRANSLATE),
        ("word-unknown", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nG1 AP=45 RP=10", 3, ROTATE),
        ("rotary-word", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. B0.\nG1 X10. B30. F100.", 3, ROTATE),
        ("cycle-position", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CYCL DEF 254 CIRCULAR SLOT ~\n  Q216=+50 ~\n  Q217=+50\n3 END PGM P MM", 3, TRANSLATE),
        ("fk-contour", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 L X+0 Y+0 RL F100\n3 FL LEN 10 AN+0\n4 END PGM P MM", 4, ROTATE),
        ("arc-tangential", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nCIP X10 Y0 I1=5 J1=5", 3, MIRROR_30),
        ("arc-unsupported", "okuma-osp", "G90 G18\nG0 X40 Z2\nG2 X50 Z-10 L20", 3, LATHE),
        ("plane", "fanuc-gcode", "G90 G18 G21\nG0 X0. Z0.\nG1 X10. F100.", 3, ROTATE),
        ("lathe-rotate", "fanuc-lathe", "G18 G21\nG0 X40. Z2.", 2, ROTATE),
        ("lathe-x-mirror", "fanuc-lathe", "G18 G21\nG0 X40. Z2.", 2, MIRROR),
        ("thread", "fanuc-lathe", "G18 G21\nG0 X40. Z2.\nG32 Z-20. F1.5", 3, LATHE),
        ("thread", "fanuc-lathe", "G18 G21\nG0 X40. Z2.\nG76 P020060 Q100 R0.05\nG76 X37.4 Z-20. P1300 Q400 F2.", 3, LATHE),
        ("roughing-cycle", "fanuc-lathe", "G18 G21\nG0 X40. Z2.\nG71 U2. R0.5\nG71 P10 Q20 U0.4 W0.1 F0.3", 3, LATHE),
        ("lathe-cycle", "sinumerik", "G18 G90 G71\nG0 X40 Z2\nCYCLE95(\"KONTUR\",2,0.2,0.4,0,0.3,0.2,0.1,9,0,0,0.5)", 3, LATHE),
        ("single-pass-taper", "fanuc-lathe", "G18 G21\nG0 X52. Z2.\nG94 X20. Z-2. R-3. F0.2", 3, LATHE),
        ("intermediate-point", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5.\nG28 X10. Y10.", 3, TRANSLATE),
        # P4.2: the rest of X22 and the reasons the rules add (§7 #296).
        ("frame", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nROT RPL=30\nG1 X10", 4, ROTATE),
        ("frame", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 PLANE SPATIAL SPA+0 SPB+30 SPC+0 TURN MB MAX FMAX\n2 L X+10 Y+0 FMAX\n3 END PGM P MM", 3, TRANSLATE),
        ("coordinate-shift", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nTRANS X10", 3, TRANSLATE),
        ("coordinate-shift", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 CYCL DEF 7.0 NULLPUNKT\n2 CYCL DEF 7.1 X+10\n3 END PGM P MM", 3, ROTATE),
        ("coordinate-shift", "fanuc-gcode", "G90 G17 G21\nG10 L2 P1 X0. Y0.", 2, TRANSLATE),
        ("call", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nM98 P1000", 3, ROTATE),
        ("call", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 CALL LBL 1\n2 END PGM P MM", 2, MIRROR),
        ("call", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 CALL PGM SUB1\n2 END PGM P MM", 2, TRANSLATE),
        ("call", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nKONTUR", 3, TRANSLATE),
        ("call", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nL100", 3, TRANSLATE),
        ("call", "fanuc-gcode", "G90 G17 G21\nG66 P9010 R2. Z-5.\nX10. Y10.", 3, TRANSLATE),
        ("expression", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nG1 X=R1 Y0", 3, ROTATE),
        ("distance-assumed", "sinumerik-mill", "G17 G71\nG0 X0 Y0", 2, TRANSLATE),
        ("word-unknown", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nG1 X10 NAME=5", 3, TRANSLATE),
        ("rotary-word", "okuma-osp", "G90 G18\nG0 X40 Z2 C0\nG1 Z-5 C90", 3, LATHE),
        ("rotary-turned", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5. B30.\nG1 X10. F100.", 3, TRANSLATE),
        ("cycle-not-reviewed", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 CYCL DEF 999 UNKNOWN ~\n  Q1=+5\n2 END PGM P MM", 2, TRANSLATE),
        # P4a integration: CYCLE95's parameters are reviewed; its contour NPP is elsewhere.
        ("cycle-position", "sinumerik", "G18 G90 G71\nG0 X40 Z2\nCYCLE95(\"KONTUR\",2,0.2,0.4,0,0.3,0.2,0.1,9,0,0,0.5)", 3, TRANSLATE),
        ("cycle-not-reviewed", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0 Z5\nCYCLE81(10,0,2,-5,,,1)", 3, TRANSLATE),
        ("cycle-position", "sinumerik-mill", "G90 G17 G71\nG0 X0 Y0 Z5\nSLOT1(10,0,2,-5,,4,20,8,50,50,10,0,90)", 3, TRANSLATE),
        ("cycle-plane", "fanuc-gcode", "G90 G18 G21\nG0 X0. Y0. Z5.\nG81 X10. Z-5. R2. F100.", 3, TRANSLATE),
        # v1.2.0 (NCR-9b): an empty retract plane is 0, which a Z shift cannot move.
        ("cycle-level-empty", "sinumerik-mill", "G17 G90 G71\nG0 X0 Y0 Z50\nCYCLE81(,0,2,-10)", 3, TRANSLATE),
        ("arc-tangential", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 L X+0 Y+0 R0 FMAX\n2 CT X+10 Y+10\n3 END PGM P MM", 3, ROTATE_30),
        ("arc-unsupported", "okuma-osp", "G90 G18\nG0 X40 Z2 C0\nG102 X30 C90 L5 F100", 3, TRANSLATE),
        ("swap-unknown", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG41.2 D1 G1 X10. Y0. F100.", 3, MIRROR),
        ("pole-unknown", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 L X+0 Y+0 R0 FMAX\n2 LP PR+5 PA+30\n3 END PGM P MM", 3, ROTATE),
        ("mill-z-mirror", "fanuc-gcode", "G90 G18 G21\nG0 X0. Z0.\nG1 Z-10. F100.", 3, LATHE),
        ("plane", "fanuc-lathe", "G17 G21\nG0 X40. Z2.\nG1 Z-10. F0.2", 3, LATHE),
        ("thread", "okuma-osp", "G90 G18\nG0 X40 Z2\nG71 X30 Z-20 F1.5", 3, LATHE),
        ("thread", "sinumerik", "G18 G90 G71\nG0 X40 Z2\nG33 Z-20 K1.5", 3, LATHE),
        ("roughing-cycle", "okuma-osp", "G90 G18\nG0 X40 Z2\nG81", 3, LATHE),
        ("lathe-cycle", "fanuc-lathe", "G18 G21\nG0 X40. Z2.\nG70 P10 Q20", 3, LATHE),
        ("single-pass-taper", "fanuc-lathe", "G18 G21\nG0 X52. Z2.\nG90 X40. Z-20. R-2. F0.2", 3, LATHE),
        ("intermediate-point", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5.\nG91 G28 X10. Y0.", 3, ROTATE),
        # P4a fix B1 (plan §7 #311, #312, #316): the reasons the fixes add.
        ("jump", "fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5.\nGOTO 10\nG91\nN10 G1 X5. F100.", 5, TRANSLATE),
        ("cycle-angle", "heidenhain-klartext", "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CYCL DEF 251 RECTANGULAR POCKET ~\n  Q218=+60 ;FIRST SIDE LENGTH\n3 END PGM P MM", 3, ROTATE),
        ("chamfer-sign", "okuma-osp", "G90 G18\nG0 X20 Z2\nG1 Z0 F0.2\nG1 X60 G75 L-2", 4, LATHE),
    ]

    #: Reasons whose case needs the real tracker's reading of the program's flow.
    NEEDS_FLOW = ()

    def refusals(self, profile_id, text, line, op, preset=None, codes=None):
        context, tracker, steps = walk(text, profile_id, preset=preset, upto=line, tracker=self.TRACKER, codes=codes)
        step = steps[line - 1]
        return _nc_geom.refusals_of(step, _nc_geom.roles_of(step, tracker), tracker, op, context)

    def notes(self, profile_id, text, line, op):
        context, tracker, steps = walk(text, profile_id, upto=line, tracker=self.TRACKER)
        step = steps[line - 1]
        return _nc_geom.notes_of(step, _nc_geom.roles_of(step, tracker), tracker, op, context)

    def test_each_reason_on_its_block(self) -> None:
        for reason, profile_id, text, line, op in self.CASES:
            if reason in self.NEEDS_FLOW:
                continue
            with self.subTest(reason=reason, profile=profile_id, text=text):
                refusals = self.refusals(profile_id, text, line, op)
                self.assertIn(reason, [r.reason for r in refusals])
                self.assertTrue(all(r.line == line for r in refusals))
                order = list(_nc_geom.REASONS)
                self.assertEqual([r.reason for r in refusals], sorted((r.reason for r in refusals), key=order.index))

    def test_every_reason_the_rules_raise_has_a_case(self) -> None:
        # The ones that are not a property of one block: the selection (the script's walk), the
        # arc check (the written program, ArcCheckTest) and the resolution (write_word,
        # WriteBackCases). v1.2.0 manual-check fix round (D6-7): the increment after a shift
        # needs the lines before the block, which the scripts' walk keeps (ManualCheckB5Test).
        elsewhere = {"selection-inside", "selection-mode", "arc-check", "resolution", "shift-increment"}
        covered = {case[0] for case in self.CASES}
        self.assertEqual(set(_nc_geom.REASONS) - covered, elsewhere)

    def test_no_refusal_where_the_rule_does_not_apply(self) -> None:
        cases = [
            # Diameter programming refuses nothing under the Z mirror: it reads no X.
            ("sinumerik", "G18 G90 G71\nDIAMON\nG0 X40 Z2\nG1 Z-10 F0.2", 4, LATHE),
            # A single pass without a taper is points.
            ("fanuc-lathe", "G18 G21\nG0 X52. Z2.\nG90 X40. Z-20. F0.2", 3, LATHE),
            # v1.2.0 (NCR-2): a taper written as 0 is none; one along X keeps its sign under the
            # Z mirror; a plane code clears the taper in force.
            ("fanuc-lathe", "G18 G21\nG0 X52. Z2.\nG94 X20. Z-2. R0. F0.2", 3, LATHE),
            ("fanuc-lathe", "G18 G21\nG0 X52. Z2.\nG90 X40. Z-20. R-2. F0.2\nG0 X52. Z2.\nG90 X38. Z-20.", 5, LATHE),
            ("fanuc-lathe", "G18 G21\nG0 X52. Z2.\nG94 X20. Z-2. R-3. F0.2\nG18\nG0 X52. Z2.\nG94 X20. Z-4.", 6, LATHE),
            # v1.2.0 (NCR-9b): the depth left empty with its twin written; a shift that keeps Z.
            ("sinumerik-mill", "G17 G90 G71\nG0 X0 Y0 Z50\nCYCLE81(10,0,2,,5)", 3, TRANSLATE),
            ("sinumerik-mill", "G17 G90 G71\nG0 X0 Y0 Z50\nCYCLE81(,0,2,-10)", 3, _nc_geom.Translate({"X": D(1), "Y": D(0), "Z": D(0)})),
            # An incremental zero return is information, not a refusal (Q4-6).
            ("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5.\nG91 G28 Z0.", 3, TRANSLATE),
            # P4.2: the cases of the prelude's goldens and the rules around them.
            ("fanuc-lathe", "G18 G21 G40 G99\nG0 X50. Z2.\nG42 G1 X20. Z0. F0.2", 3, LATHE),
            ("fanuc-lathe", "G18 G21 G40 G99\nG0 X50. Z2.\nG3 X40. W-5. K-5. I0.", 3, LATHE),
            ("fanuc-lathe", "G18 G21 G40 G99\nG0 X50. Z2.\nG2 X30. Z-15. R5.", 3, LATHE),
            ("fanuc-gcode", "G21 G17 G90 G54\nG0 X0. Y0. Z5.\nG81 X20. Y20. Z-5. R2. F100.\nX30.", 4, TRANSLATE),
            ("fanuc-gcode", "G21 G17 G90 G54\nG0 X10. Y0. Z5.\nG91 G1 X5.", 3, ROTATE),
            ("fanuc-gcode", "G21 G17 G90 G54\nG0 X10. Y0. Z5.\nG3 X0. Y10. I-10. J0.", 3, MIRROR),
            ("fanuc-gcode", "G21 G17 G90 G54\nG0 X10. Y0. Z5.\nG53 Z0.", 3, ROTATE),
            # A translate in X only does not need to read a Z it does not move.
            ("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG1 Z#1 F100.", 3, _nc_geom.Translate({"X": D(1)})),
            # A Sinumerik tool offset number in a block that moves nothing.
            ("sinumerik-mill", "G90 G17 G71\nT1 D1", 2, ROTATE),
            ("heidenhain-klartext", "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z\n2 L X+0 Y+0 R0 FMAX\n3 CC X+5 Y+0\n4 C X+10 Y+0 DR-\n5 END PGM P MM", 5, MIRROR),
            ("heidenhain-klartext", "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z\n2 L X+5 Y+0 FMAX\n3 CC\n4 CP IPA+90 DR+\n5 END PGM P MM", 5, ROTATE),
            ("sinumerik-mill", "G90 G17 G71\nG0 X0 Y0 Z5\nCYCLE81(10,0,2,-5)", 3, TRANSLATE),
            # A polar angle is an angle although the profile lists no angular PA (regression:
            # it had no number class and read as a word that needs the machine).
            ("heidenhain-klartext", "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z\n2 CC X+0 Y+0\n3 LP PR+10 PA+30 F100\n4 END PGM P MM", 4, MIRROR),
            ("heidenhain-klartext", "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z\n2 CC X+0 Y+0\n3 LP PR+10 PA+30 F100\n4 END PGM P MM", 4, ROTATE),
        ]
        for profile_id, text, line, op in cases:
            with self.subTest(profile=profile_id, text=text):
                self.assertEqual([r.reason for r in self.refusals(profile_id, text, line, op)], [])
        # The Okuma lathe works in the turning plane (its plane codes only choose the
        # compensation plane); its point-less words need the machine.
        text = "G90\nG0 X40 Z2\nG2 X50 Z-10 I5 K0"
        self.assertEqual([r.reason for r in self.refusals("okuma-osp", text, 3, LATHE)], ["machine-dependent"])
        self.assertEqual([r.reason for r in self.refusals("okuma-osp", text, 3, LATHE, preset="okuma-1um")], [])

    def test_a_klartext_approach_on_a_tangential_arc_is_mirrored(self) -> None:
        # The prelude's case list: R and CCA keep their values, RL becomes RR. v1.2 NC fix round
        # (FZ-6): the database describes CCA, R and LEN of the approach and departure codes, so
        # the shipped data mirrors it; an entry without them still refuses rather than guesses.
        text = "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 L X+40 Y+10 R0 FMAX\n3 APPR CT X+10 Y+20 CCA180 R+10 RR F100\n4 END PGM P MM"
        self.assertEqual([r.reason for r in self.refusals("heidenhain-klartext", text, 4, MIRROR)], [])
        codes = [dict(e) for e in helpers.resolved_codes("heidenhain")]
        for entry in codes:
            if entry.get("code") == "APPR CT":
                entry.pop("params", None)
        self.assertEqual([r.reason for r in self.refusals("heidenhain-klartext", text, 4, MIRROR, codes=codes)], ["word-unknown"])

    def test_the_information_rows(self) -> None:
        notes = self.notes("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5.\nG91 G28 Z0.", 3, TRANSLATE)
        self.assertEqual([(n.line, n.reason, n.written) for n in notes], [(3, "machine-position", "G91 G28 Z0.")])
        self.assertEqual([n.reason for n in self.notes("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5.\nG53 Z0.", 3, ROTATE)], ["machine-position"])
        notes = self.notes("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5.\nG1 X10. Q5. F100.", 3, TRANSLATE)
        self.assertEqual([n.reason for n in notes], ["word-left"])
        self.assertEqual(self.notes("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0. Z5.\nG28 X10. Y10.", 3, TRANSLATE), [])

    def test_the_lathe_z_mirror_golden_refusals_come_first(self) -> None:
        # The first reason of each block is the one the prelude's refused golden reports.
        text = ("G18 G21 G40 G99\nT0101\nG0 X42. Z2.\nG71 U2. R0.5\nG71 P10 Q20 U0.4 W0.1 F0.25\nN10 G0 X20.\n"
                "G1 Z-20. F0.15\nN20 X42.\nG70 P10 Q20\nT0303\nG0 X26. Z5.\nG76 P020060 Q100 R0.05\nG76 X22.16 Z-18. P920 Q300 F1.5")
        first = {}
        for line in range(1, 14):
            refusals = self.refusals("fanuc-lathe", text, line, LATHE)
            if refusals:
                first[line] = refusals[0].reason
        self.assertEqual(first, {4: "roughing-cycle", 5: "roughing-cycle", 9: "lathe-cycle", 12: "thread", 13: "thread"})

    def test_a_rotate_on_a_lathe_says_so_first(self) -> None:
        self.assertEqual([r.reason for r in self.refusals("fanuc-lathe", "G18 G21\nG0 X40. Z2.", 2, ROTATE)], ["lathe-rotate"])


class ReasonsTest(ReasonsCases, unittest.TestCase):
    TRACKER = _nc_path.PathTracker


class HandReasonsTest(ReasonsCases, unittest.TestCase):
    TRACKER = HandTracker
    #: The stand-in walks the lines straight; the flow of a program is the real tracker's.
    NEEDS_FLOW = ("jump",)


class D2ReasonsTest(unittest.TestCase):
    """v1.2.0 NC fix round, batch D2 (NCR-2): the taper in force is the real tracker's
    (``PathTracker.pass_taper``); the stand-in keeps no pass values."""

    def refusals(self, text, line):
        context, tracker, steps = walk(text, "fanuc-lathe", upto=line)
        step = steps[line - 1]
        return [r.reason for r in _nc_geom.refusals_of(step, _nc_geom.roles_of(step, tracker), tracker, LATHE, context)]

    def test_ncr2_a_facing_taper_in_force_refuses_the_pass(self) -> None:
        above = "G18 G21\nG0 X52. Z2.\nG94 X20. Z-2. R-3. F0.2\n%sG0 X52. Z2.\nG94 X20. Z-4."
        self.assertEqual(self.refusals(above % "", 5), ["single-pass-taper"])
        self.assertEqual(self.refusals(above % "G04 X1.\n", 6), ["single-pass-taper"])
        self.assertEqual(self.refusals(above % "M98 P100\n", 6), ["single-pass-taper"])
        self.assertEqual(self.refusals(above % "G18\n", 6), [])


class WriteBackCases:
    """Contract item 5: a word written back in its own form."""

    TRACKER = None

    def role(self, text, profile_id, line, address, preset=None):
        context, tracker, steps = walk(text, profile_id, preset=preset, upto=line, tracker=self.TRACKER)
        step = steps[line - 1]
        role = next(r for r in _nc_geom.roles_of(step, tracker) if r.token.address and r.token.address.upper() == address)
        return context, tracker, role

    def write(self, text, profile_id, line, address, value, exact, preset=None, units="mm"):
        context, tracker, role = self.role(text, profile_id, line, address, preset)
        return _nc_geom.write_word(role, D(value), tracker, units, exact, context)

    def test_a_point_stays_a_point_and_klartext_keeps_its_sign(self) -> None:
        self.assertEqual(self.write("G90 G17 G21\nG0 X10. Y0.", "fanuc-gcode", 2, "X", "10.1", True), _nc_geom.Written("X10.1", False))
        text = "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 L X+10 Y+0 R0 FMAX\n3 END PGM P MM"
        self.assertEqual(self.write(text, "heidenhain-klartext", 3, "X", "15", True).text, "X+15")
        self.assertEqual(self.write(text, "heidenhain-klartext", 3, "X", "-5", True).text, "X-5")

    def test_a_point_less_word_stays_whole_increments(self) -> None:
        self.assertEqual(self.write("G90 G17 G21\nG0 X10000 Y0.", "fanuc-gcode", 2, "X", "10.5", True, preset="is-b").text, "X10500")
        refused = self.write("G90 G17 G21\nG0 X10000 Y0.", "fanuc-gcode", 2, "X", "10.0005", True, preset="is-b")
        self.assertEqual(refused.reason, "resolution")
        rounded = self.write("G90 G17 G21\nG0 X10000 Y0.", "fanuc-gcode", 2, "X", "10.0005", False, preset="is-b")
        self.assertEqual(rounded, _nc_geom.Written("X10001", True))

    def test_a_rounding_operation_writes_at_least_three_decimals_in_mm(self) -> None:
        self.assertEqual(self.write("G90 G17 G21\nG0 X10. Y0.", "fanuc-gcode", 2, "X", "8.660254037844", False), _nc_geom.Written("X8.660", True))

    def test_a_value_function_is_kept(self) -> None:
        self.assertEqual(self.write("G90 G17 G71\nG0 X0 Y0\nG2 X10 Y0 I=AC(5) J=AC(0)", "sinumerik-mill", 3, "I", "-5", True).text, "I=AC(-5)")

    # P4.2: rounding to the word's resolution (AD-44), in each form.

    def test_rounding_to_is_b_and_is_c_increments(self) -> None:
        self.assertEqual(self.write("G90 G17 G21\nG0 X10000 Y0.", "fanuc-gcode", 2, "X", "8.660254037844", False, preset="is-b"), _nc_geom.Written("X8660", True))
        self.assertEqual(self.write("G90 G17 G21\nG0 X100000 Y0.", "fanuc-gcode", 2, "X", "8.660254037844", False, preset="is-c"), _nc_geom.Written("X86603", True))
        self.assertEqual(self.write("G90 G17 G21\nG0 X-10000 Y0.", "fanuc-gcode", 2, "X", "-8.6605", False, preset="is-b"), _nc_geom.Written("X-8661", True))

    def test_rounding_keeps_more_decimals_where_the_word_has_them(self) -> None:
        self.assertEqual(self.write("G90 G17 G21\nG0 X10.12345 Y0.", "fanuc-gcode", 2, "X", "8.660254037844", False), _nc_geom.Written("X8.66025", True))
        self.assertEqual(self.write("G90 G17 G20\nG0 X1. Y0.", "fanuc-gcode", 2, "X", "0.86602540", False, units="inch"), _nc_geom.Written("X0.8660", True))
        self.assertEqual(self.write("G90 G17 G21\nG0 X10. Y0.", "fanuc-gcode", 2, "X", "-0.00049", False), _nc_geom.Written("X0.000", True))

    def test_an_exact_result_adds_the_decimals_it_needs(self) -> None:
        self.assertEqual(self.write("G90 G17 G21\nG0 X10. Y0.", "fanuc-gcode", 2, "X", "10.0001", True), _nc_geom.Written("X10.0001", False))
        self.assertEqual(self.write("G90 G17 G21\nG0 X10. Y0.", "fanuc-gcode", 2, "X", "10", True), _nc_geom.Written("X10.", False))
        self.assertEqual(self.write("G90 G17 G21\nG0 X10. Y0.", "fanuc-gcode", 2, "X", "10.0000001", True).reason, "resolution")
        self.assertEqual(self.write("G90 G17 G21\nG0 X-.5 Y0.", "fanuc-gcode", 2, "X", "-0.25", True).text, "X-.25")

    def test_a_klartext_word_without_a_point_is_read_as_written(self) -> None:
        text = "0 BEGIN PGM P MM\n1 L X+10 Y+0 R0 FMAX\n2 END PGM P MM"
        self.assertEqual(self.write(text, "heidenhain-klartext", 2, "X", "8.660254037844", False), _nc_geom.Written("X+8.66", True))
        self.assertEqual(self.write(text, "heidenhain-klartext", 2, "X", "10.0000000001", False), _nc_geom.Written("X+10", True))
        self.assertEqual(self.write(text, "heidenhain-klartext", 2, "X", "10.5", True), _nc_geom.Written("X+10.5", False))

    def test_a_word_whose_result_depends_on_the_machine(self) -> None:
        refused = self.write("G90 G17 G21\nG0 X10000 Y0.", "fanuc-gcode", 2, "X", "10.5", True)
        self.assertEqual(refused.reason, "machine-dependent")
        # With a point every preset writes it alike.
        self.assertEqual(self.write("G90 G17 G21\nG0 X10. Y0.", "fanuc-gcode", 2, "X", "10.5", True).text, "X10.5")

    def test_a_lathe_diameter_word_is_doubled_on_the_way_back(self) -> None:
        context, tracker, role = self.role("G18 G21\nG0 X40. Z2.", "fanuc-lathe", 2, "X")
        value, _ = _nc_geom.read_word(role, tracker, "mm", context)
        self.assertEqual(value, D(20))
        shifted, _ = _nc_geom.transform("point", {"X": value}, _nc_geom.Translate({"X": D(1)}, "diameter"))
        self.assertEqual(_nc_geom.write_word(role, shifted["X"], tracker, "mm", True, context).text, "X41.")
        shifted, _ = _nc_geom.transform("point", {"X": value}, _nc_geom.Translate({"X": D(1)}, "radius"))
        self.assertEqual(_nc_geom.write_word(role, shifted["X"], tracker, "mm", True, context).text, "X42.")

    def test_sinumerik_diamof_and_diam90_per_word(self) -> None:
        context, tracker, role = self.role("G18 G90 G71\nDIAMOF\nG0 X20 Z2", "sinumerik", 3, "X")
        self.assertEqual(_nc_geom.read_word(role, tracker, "mm", context)[0], D(20))
        context, tracker, role = self.role("G18 G90 G71\nDIAM90\nG0 X=IC(4) Z2", "sinumerik", 3, "X")
        self.assertEqual(_nc_geom.read_word(role, tracker, "mm", context)[0], D(4))
        context, tracker, role = self.role("G18 G90 G71\nDIAM90\nG0 X=AC(40) Z2", "sinumerik", 3, "X")
        self.assertEqual(_nc_geom.read_word(role, tracker, "mm", context)[0], D(20))

    def test_a_cycle_argument_and_a_klartext_parameter(self) -> None:
        context, tracker, steps = walk("G90 G17 G71\nG0 X0 Y0 Z5\nCYCLE81(10,0,2,-5)", "sinumerik-mill", tracker=self.TRACKER)
        roles = [r for r in _nc_geom.roles_of(steps[2], tracker) if r.role == "tool-axis"]
        self.assertEqual([r.token.address for r in roles], ["RTP", "RFP", "DP"])
        line = "CYCLE81(10,0,2,-5)"
        rfp = roles[1]
        self.assertEqual(line[rfp.token.start:rfp.token.end], "0")
        self.assertEqual(_nc_geom.write_word(rfp, D("0.5"), tracker, "mm", True, context).text, "0.5")
        text = "0 BEGIN PGM P MM\n1 CYCL DEF 200 BOHREN ~\n  Q203=+0 ~\n  Q201=-10\n2 END PGM P MM"
        context, tracker, steps = walk(text, "heidenhain-klartext", upto=3, tracker=self.TRACKER)
        q = next(r for r in _nc_geom.roles_of(steps[2], tracker) if r.role == "tool-axis")
        self.assertEqual("  Q203=+0 ~"[q.token.start:q.token.end], "Q203=+0")
        self.assertEqual(_nc_geom.write_word(q, D("0.5"), tracker, "mm", True, context).text, "Q203=+0.5")

    def test_a_polar_angle_is_written_as_an_angle(self) -> None:
        context, tracker, role = self.role("0 BEGIN PGM P MM\n1 TOOL CALL 1 Z\n2 CC X+0 Y+0\n3 LP PR+10 PA+30", "heidenhain-klartext", 4, "PA")
        self.assertEqual((role.role, role.number_class), ("polar-angle", "angle"))
        value, _ = _nc_geom.read_word(role, tracker, "mm", context)
        turned, exact = _nc_geom.transform("polar-angle", value, _nc_geom.Mirror((D(0), D(0)), D(90)))
        self.assertEqual(_nc_geom.write_word(role, turned, tracker, "mm", exact, context), _nc_geom.Written("PA+150", False))

    def test_a_word_a_rotation_adds(self) -> None:
        context, tracker, role = self.role("G90 G17 G21\nG91 G1 X5.", "fanuc-gcode", 2, "X")
        self.assertEqual(_nc_geom.write_added("Y", role, D(5), tracker, "mm", True, context), _nc_geom.Written("Y5.", False))
        context, tracker, role = self.role("0 BEGIN PGM P MM\n1 L IX+5 FMAX", "heidenhain-klartext", 2, "X")
        self.assertEqual(_nc_geom.write_added("Y", role, D(-5), tracker, "mm", True, context).text, "IY-5")
        context, tracker, role = self.role("G90 G17 G71\nG0 X=AC(5)", "sinumerik-mill", 2, "X")
        self.assertEqual(_nc_geom.write_added("Y", role, D(2), tracker, "mm", True, context).text, "Y=AC(2)")

    def test_translate_by_d_and_back_gives_every_word_its_value(self) -> None:
        text = "G90 G17 G21\nG0 X10.25 Y-3. Z5."
        context, tracker, steps = walk(text, "fanuc-gcode", tracker=self.TRACKER)
        there = _nc_geom.Translate({"X": D("0.1"), "Y": D("-0.1"), "Z": D("0.05")})
        back = _nc_geom.Translate({"X": D("-0.1"), "Y": D("0.1"), "Z": D("-0.05")})
        for role in _nc_geom.roles_of(steps[1], tracker):
            if role.role != "point":
                continue
            with self.subTest(word=role.token.text):
                value, _ = _nc_geom.read_word(role, tracker, "mm", context)
                moved, exact = _nc_geom.transform("point", {role.axis: value}, there)
                written = _nc_geom.write_word(role, moved[role.axis], tracker, "mm", exact, context)
                returned, exact = _nc_geom.transform("point", {role.axis: moved[role.axis]}, back)
                again = _nc_geom.write_word(role._replace(token=role.token), returned[role.axis], tracker, "mm", exact, context)
                self.assertFalse(written.rounded)
                self.assertEqual(D(again.text[1:]), value)


class WriteBackTest(WriteBackCases, unittest.TestCase):
    TRACKER = _nc_path.PathTracker


class HandWriteBackTest(WriteBackCases, unittest.TestCase):
    TRACKER = HandTracker


# ---------------------------------------------------------------------------
# P4a fix batch B1 (the P4a reviews, plan §7 #311-#322): the rules, through the scripts
# ---------------------------------------------------------------------------


def run_geo(script, text, profile_id, params, preceding=None, preset=None, variant=None):
    """One run of a geometry script on an inline program (a selection below ``preceding``)."""
    kwargs = {}
    if preset is not None:
        kwargs["preset"] = preset
    if variant is not None:
        kwargs["variant"] = variant
    context = helpers.effective_context(profile_id, params=params, **kwargs)
    lines = text.split("\n")
    if preceding is not None:
        start = len(preceding) + 1
        context["input"] = {"scope": "selection", "startLine": start, "endLine": start + len(lines) - 1, "precedingLines": preceding}
    else:
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    out = helpers.run_script(script + ".py", stdin=text, context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


def errors(result):
    return [(f["line"], f["reason"]) for f in result.get("findings", []) if f["severity"] == "error"]


ROTATE90 = ("rotate", {"cx": 0, "cy": 0, "angle": 90})
MIRROR_X = ("mirror", {"about": "y-axis", "px": 0, "py": 0})
MIRROR_Y = ("mirror", {"about": "x-axis", "px": 0, "py": 0})
LATHE_Z = ("mirror", {"about": "z", "z0": 0})


class FixB1Test(unittest.TestCase):
    """Each case failed before its fix (checked against the tree of p4a/intB)."""

    def refused_with(self, result, wanted):
        self.assertEqual(result["text"].count("\n"), result["text"].count("\n"))
        got = errors(result)
        for item in wanted:
            self.assertIn(item, got, result.get("findings"))

    # -- NC-2: pockets, slots and studs turned or placed by a value of their own ------------

    POCKET = (
        "0 BEGIN PGM P MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 TOOL CALL 1 Z S3000\n"
        "3 L X+0 Y+0 Z+50 R0 FMAX\n"
        "4 CYCL DEF 251 RECTANGULAR POCKET ~\n  Q215=+0 ;MACHINING OPERATION ~\n  Q218=+60 ;FIRST SIDE LENGTH ~\n"
        "  Q219=+20 ;2ND SIDE LENGTH ~\n  Q220=+5 ;CORNER RADIUS ~\n  Q368=+0 ;ALLOWANCE FOR SIDE ~\n"
        "  Q224=+30 ;ANGLE OF ROTATION ~\n  Q367=+1 ;POCKET POSITION ~\n  Q207=+500 ;FEED RATE FOR MILLING ~\n"
        "  Q351=+1 ;CLIMB OR UP-CUT ~\n  Q201=-5 ;DEPTH ~\n  Q202=+5 ;PLUNGING DEPTH ~\n  Q369=+0 ;ALLOWANCE FOR FLOOR ~\n"
        "  Q206=+150 ;FEED RATE FOR PLNGNG ~\n  Q338=+0 ;INFEED FOR FINISHING ~\n  Q200=+2 ;SET-UP CLEARANCE ~\n"
        "  Q203=+0 ;SURFACE COORDINATE ~\n  Q204=+50 ;2ND SET-UP CLEARANCE ~\n  Q370=+1 ;TOOL PATH OVERLAP ~\n"
        "  Q366=+1 ;PLUNGE ~\n  Q385=+500 ;FINISHING FEED RATE\n"
        "5 L X+50 Y+50 R0 FMAX M99\n6 END PGM P MM"
    )

    def test_nc2_a_pocket_with_its_own_angle_is_not_turned_or_mirrored(self) -> None:
        for script, params in (ROTATE90, MIRROR_X, MIRROR_Y):
            with self.subTest(script=script, params=params):
                result = run_geo(script, self.POCKET, "heidenhain-klartext", params)
                self.assertEqual(result["text"], self.POCKET)
                self.assertEqual(errors(result), [(5, "cycle-angle"), (26, "cycle-angle")])

    def test_nc2_translate_keeps_the_pocket_angle_and_corner(self) -> None:
        result = run_geo("translate", self.POCKET, "heidenhain-klartext", {"dx": 1, "dy": 2})
        self.assertEqual(errors(result), [])
        lines = result["text"].split("\n")
        self.assertIn("5 L X+51 Y+52 R0 FMAX M99", lines)
        self.assertIn("  Q224=+30 ;ANGLE OF ROTATION ~", lines)
        self.assertIn("  Q367=+1 ;POCKET POSITION ~", lines)

    def test_nc2_the_data_marks_the_angle_and_side_parameters(self) -> None:
        codes = {e["code"]: e for e in helpers.resolved_codes("heidenhain")}
        marked = {code: sorted(p["address"] for p in codes[code].get("params", []) if p.get("inPlane")) for code in ("CYCL DEF 251", "CYCL DEF 253", "CYCL DEF 256", "CYCL DEF 257")}
        self.assertEqual(marked, {
            "CYCL DEF 251": ["Q224", "Q367"],
            "CYCL DEF 253": ["Q367", "Q374"],
            "CYCL DEF 256": ["Q224", "Q367", "Q437"],
            "CYCL DEF 257": ["Q376"],
        })

    # -- NC-4: a pole set above the selection ------------------------------------------------

    def test_nc4_moves_around_a_pole_set_above_the_selection_are_refused(self) -> None:
        preceding = ["0 BEGIN PGM P MM", "1 TOOL CALL 1 Z S3000", "2 L X+0 Y+0 Z+5 R0 FMAX", "3 CC X+50 Y+50"]
        text = "4 LP PR+10 PA+30 R0 FMAX\n5 LP PA+60\n6 CP IPA+90 DR+\n7 C X+50 Y+40 DR-"
        for script, params in (("translate", {"dx": 1, "dy": 2}), ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                result = run_geo(script, text, "heidenhain-klartext", params, preceding)
                self.assertEqual(result["text"], text)
                self.assertEqual(errors(result), [(5, "pole-unknown"), (6, "pole-unknown"), (7, "pole-unknown"), (8, "pole-unknown")])
        # The pole set inside the selection moves with it.
        whole = run_geo("translate", "\n".join(preceding[2:]) + "\n" + text, "heidenhain-klartext", {"dx": 1, "dy": 2}, preceding[:2])
        self.assertEqual(errors(whole), [])

    # -- NC-5: jumps, loops and block skip ---------------------------------------------------

    def test_nc5_a_jump_target_reached_from_another_position_refuses_a_block_that_needs_it(self) -> None:
        cases = [
            ("fanuc-gcode", "is-b", "%\nO1000\nG90 G17 G21\nG0 X10. Y10. Z5.\nGOTO 100\nG0 X50. Y50.\nN100 G1 X20. F100.\nM30\n%", 7),
            ("fanuc-gcode", "is-b", "%\nO1000\nG90 G17 G21\nG0 X10. Y10. Z5.\nIF[#1EQ1]GOTO100\nG0 X50. Y50.\nN100 G1 X20. F100.\nM30\n%", 7),
            ("sinumerik-mill", None, "G90 G17 G71\nG0 X10 Y10 Z5\nGOTOF MARK1\nG0 X50 Y50\nMARK1:\nG1 X20 F100\nM30", 6),
            ("heidenhain-klartext", None, "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nL X+10 Y+10 Z+5 R0 FMAX\nFN 9: IF +0 EQU +0 GOTO LBL 1\nL X+50 Y+50 R0 FMAX\nLBL 1\nL X+20 R0 F100\nEND PGM P MM", 7),
        ]
        for profile_id, preset, text, line in cases:
            with self.subTest(profile=profile_id, text=text):
                result = run_geo("rotate", text, profile_id, ROTATE90[1], preset=preset)
                self.assertEqual(result["text"], text)
                self.assertIn((line, "position-unknown"), errors(result))
                # Translate is local per word: the jump changes nothing it writes.
                moved = run_geo("translate", text, profile_id, {"dx": 1, "dy": 2}, preset=preset)
                self.assertEqual(errors(moved), [], moved.get("findings"))
                self.assertNotEqual(moved["text"], text)

    def test_nc5_a_target_block_that_writes_both_axes_is_turned(self) -> None:
        text = "G90 G17 G71\nG0 X10 Y10 Z5\nGOTOF MARK1\nG0 X50 Y50\nMARK1:\nG1 X20 Y20 F100\nM30"
        result = run_geo("rotate", text, "sinumerik-mill", ROTATE90[1])
        self.assertEqual(errors(result), [])
        self.assertIn("G1 X-20 Y20 F100", result["text"].split("\n"))

    def test_nc5_after_a_loop_the_position_is_not_known(self) -> None:
        cases = [
            ("fanuc-gcode", "is-b", "%\nO1000\nG90 G17 G21\nG0 X10. Y10. Z5.\n#1=0\nWHILE[#1LT2]DO1\nG91 G1 X5. F100.\n#1=#1+1\nEND1\nG90 G1 Y20.\nM30\n%", 10),
            ("sinumerik-mill", None, "G90 G17 G71\nG0 X10 Y10 Z5\nMARK1:\nG91 G1 X5 F100\nREPEAT MARK1 P=2\nG90 G1 Y20\nM30", 6),
            ("sinumerik-mill", None, "G90 G17 G71\nG0 X10 Y10 Z5\nWHILE R1<2\nG91 G1 X5 F100\nG90\nR1=R1+1\nENDWHILE\nG1 Y20\nM30", 8),
        ]
        for profile_id, preset, text, line in cases:
            with self.subTest(profile=profile_id, text=text):
                result = run_geo("rotate", text, profile_id, ROTATE90[1], preset=preset)
                self.assertEqual(result["text"], text)
                self.assertIn((line, "position-unknown"), errors(result))

    def test_nc5_a_loop_whose_blocks_need_their_start_is_refused_at_its_end(self) -> None:
        # The body writes only X; on its second run it starts where the first run ended.
        text = "G90 G17 G71\nG0 X10 Y10 Z5\nWHILE R1<2\nG1 X20 F100\nG1 Y30\nR1=R1+1\nENDWHILE\nM30"
        result = run_geo("rotate", text, "sinumerik-mill", ROTATE90[1])
        self.assertIn((7, "position-unknown"), errors(result))
        # A body that writes both axes runs the same every time.
        text = "G90 G17 G71\nG0 X10 Y10 Z5\nWHILE R1<2\nG1 X20 Y10 F100\nG1 X20 Y30\nR1=R1+1\nENDWHILE\nG0 X0 Y0\nM30"
        self.assertEqual(errors(run_geo("rotate", text, "sinumerik-mill", ROTATE90[1])), [])

    def test_nc5_a_block_that_may_be_skipped_leaves_its_axes_unknown(self) -> None:
        text = "%\nO1000\nG90 G17 G21\nG0 X10. Y10. Z5.\n/G0 Y50.\nG1 X20. F100.\nM30\n%"
        result = run_geo("rotate", text, "fanuc-gcode", ROTATE90[1], preset="is-b")
        self.assertEqual(errors(result), [(6, "position-unknown")])
        # A skippable block that moves nothing changes nothing.
        text = "%\nO1000\nG90 G17 G21\nG0 X10. Y10. Z5.\n/N10 M1\nG1 X20. F100.\nM30\n%"
        self.assertEqual(errors(run_geo("rotate", text, "fanuc-gcode", ROTATE90[1], preset="is-b")), [])

    def test_nc5_a_jump_over_a_change_of_the_distance_mode_is_refused_by_every_operation(self) -> None:
        text = "%\nO1000\nG90 G17 G21\nG0 X10. Y10. Z5.\nGOTO 100\nG91\nN100 G1 X5. Y5. F100.\nM30\n%"
        for script, params in (("translate", {"dx": 1}), ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                result = run_geo(script, text, "fanuc-gcode", params, preset="is-b")
                self.assertEqual(result["text"], text)
                self.assertIn((7, "jump"), errors(result))

    def test_nc5_a_jump_whose_target_cannot_be_followed_is_refused(self) -> None:
        text = "%\nO1000\nG90 G17 G21\nG0 X10. Y10. Z5.\nGOTO#1\nG1 X20. Y20. F100.\nM30\n%"
        result = run_geo("translate", text, "fanuc-gcode", {"dx": 1}, preset="is-b")
        self.assertIn((5, "jump"), errors(result))

    # -- NC-6: probing, unknown keywords, system data ----------------------------------------

    def test_nc6_unknown_keywords_and_system_writes_are_refused(self) -> None:
        cases = [
            ("heidenhain-klartext", None, "TCH PROBE 400 BASIC ROTATION ~\n  Q263=+10 ;1ST POINT 1ST AXIS ~\n  Q264=+3.5 ;1ST POINT 2ND AXIS", "unknown-code"),
            ("heidenhain-klartext", None, "FUNCTION PARAX MODE X=U", "unknown-code"),
            ("heidenhain-klartext", None, "FUNCTION MODE TURN", "unknown-code"),
            ("heidenhain-klartext", None, 'DECLARE STRING QS1 = "A"', "unknown-code"),
            ("heidenhain-klartext", None, "FN 17: SYSWRITE ID 990 NR6 = +1", "coordinate-shift"),
            ("fanuc-gcode", "is-b", "#5221=10.", "coordinate-shift"),
            ("okuma-osp", "okuma-1um", "VZOFZ[1]=100.", "coordinate-shift"),
            ("sinumerik-mill", None, "$P_UIFR[1,X,TR]=10", "coordinate-shift"),
        ]
        heads = {
            "heidenhain-klartext": ("BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nL X+0 Y+0 Z+50 R0 FMAX", "L X+20 Y+20 R0 FMAX\nEND PGM P MM"),
            "fanuc-gcode": ("%\nO1000\nG90 G17 G21\nG0 X0. Y0. Z50.", "G0 X20. Y20.\nM30\n%"),
            "okuma-osp": ("G90 G18\nG0 X40. Z2.", "G0 X20. Z5.\nM02"),
            "sinumerik-mill": ("G90 G17 G71\nG0 X0 Y0 Z50", "G0 X20 Y20\nM30"),
        }
        for profile_id, preset, block, reason in cases:
            head, tail = heads[profile_id]
            text = "%s\n%s\n%s" % (head, block, tail)
            line = head.count("\n") + 2
            ops = [("translate", {"dx": 1})] + ([LATHE_Z] if profile_id == "okuma-osp" else [ROTATE90, MIRROR_X])
            for script, params in ops:
                with self.subTest(profile=profile_id, block=block, script=script):
                    result = run_geo(script, text, profile_id, params, preset=preset)
                    self.assertEqual(result["text"], text)
                    self.assertIn((line, reason), errors(result))

    def test_nc6_a_q_parameter_assignment_is_no_unknown_cycle(self) -> None:
        # `FN 9` to `FN 12` are numbered entries; `FN 0` is still no cycle nobody reviewed.
        text = "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nFN0:Q2=768 ;FEED\nL X+10 Y+10 Z+5 R0 FMAX\nEND PGM P MM"
        self.assertEqual(errors(run_geo("translate", text, "heidenhain-klartext", {"dx": 1})), [])

    def test_nc6_reading_a_system_variable_or_comparing_it_is_no_write(self) -> None:
        text = "G90 G17 G71\nG0 X0 Y0 Z50\nR1=$P_UIFR[1,X,TR]\nIF $P_SEARCH==1 GOTOF ENDE\nG0 X20 Y20\nENDE:\nM30"
        self.assertEqual(errors(run_geo("translate", text, "sinumerik-mill", {"dx": 1})), [])
        text = "%\nO1000\nG90 G17 G21\nG0 X0. Y0. Z50.\n#100=10.\n#1=#5221\nG0 X20. Y20.\nM30\n%"
        self.assertEqual(errors(run_geo("translate", text, "fanuc-gcode", {"dx": 1}, preset="is-b")), [])

    # -- NC-7: the Fanuc lathe's angle and other words under the Z mirror ---------------------

    def test_nc7_a_lathe_word_of_a_return_code_is_no_offset_number(self) -> None:
        for block in ("G1 X40. A30. F0.2", "G0 B45.", "G1 X20. V3. F0.2"):
            text = "%\nO1000\nG18 G21 G99\nG0 X50. Z5.\nG1 X20. Z0. F0.2\n" + block + "\nG1 Z-30.\nM30\n%"
            with self.subTest(block=block):
                result = run_geo("mirror", text, "fanuc-lathe", LATHE_Z[1], preset="is-b")
                self.assertIn((6, "word-unknown"), errors(result))
        # The offset register of the compensation group stays a number of its own.
        text = "%\nO1000\nG90 G17 G21\nG0 X0. Y0. Z5.\nG1 X10. D2 F100.\nM30\n%"
        result = run_geo("rotate", text, "fanuc-gcode", ROTATE90[1], preset="is-b")
        self.assertEqual(errors(result), [])
        self.assertIn("G1 X0. Y10. D2 F100.", result["text"].split("\n"))

    # -- NC-8: the Okuma chamfer and corner round ---------------------------------------------

    def test_nc8_an_okuma_chamfer_is_refused_by_the_z_mirror(self) -> None:
        text = "N10 G90 G40\nN20 G0 X20. Z2.\nN30 G1 Z0. F0.2\nN40 G1 X60. G75 L-2.\nN50 G1 Z-40. G76 L4.\nN60 X100.\nM02"
        result = run_geo("mirror", text, "okuma-osp", LATHE_Z[1], preset="okuma-1um")
        self.assertEqual(result["text"], text)
        self.assertEqual(errors(result), [(4, "chamfer-sign"), (5, "chamfer-sign")])
        self.assertEqual(errors(run_geo("translate", text, "okuma-osp", {"dz": -1}, preset="okuma-1um")), [])

    # -- NC-9: a cut at an axis position never written -----------------------------------------

    def test_nc9_a_cut_before_the_shifted_axis_is_written_is_refused(self) -> None:
        text = "%\nO1000\nG90 G17 G21\nG0 X0. Z5.\nG1 Z-1. F100.\nX50.\nG0 Z5.\nG0 X10. Y20.\nG1 Z-1.\nX60.\nM30\n%"
        result = run_geo("translate", text, "fanuc-gcode", {"dy": 5}, preset="is-b")
        self.assertEqual(result["text"], text)
        self.assertIn((5, "axis-unwritten"), errors(result))
        result = run_geo("mirror", text, "fanuc-gcode", MIRROR_Y[1], preset="is-b")
        self.assertIn((5, "position-unknown"), errors(result))
        # A shift along an axis the program has written cuts where it should.
        self.assertEqual(errors(run_geo("translate", text, "fanuc-gcode", {"dx": 5}, preset="is-b")), [])

    def test_nc9_rapids_machine_positions_and_blocks_that_move_nothing_are_no_cut(self) -> None:
        # Klartext writes the rapid as FMAX or as F MAX; M91 moves in machine coordinates;
        # a block that moves no axis cuts nothing, whatever motion is in force.
        text = (
            "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nL Z+100 R0 F MAX\nL Z-30 R0 F500 M91\nL Z+50 R0 FMAX\n"
            "M138 A C\nL X+10 Y+10 R0 FMAX\nL Z-1 F100\nEND PGM P MM"
        )
        self.assertEqual(errors(run_geo("translate", text, "heidenhain-klartext", {"dx": 1, "dy": 2})), [])
        # Nor is a block that only turns the rotary axes, at the feed.
        turned = text.replace("M138 A C", "L B+0 C+0 R0 F2000")
        self.assertEqual(errors(run_geo("translate", turned, "heidenhain-klartext", {"dx": 1, "dy": 2})), [])
        cut = text.replace("L Z+50 R0 FMAX", "L Z+50 R0 F500")
        self.assertIn((5, "axis-unwritten"), errors(run_geo("translate", cut, "heidenhain-klartext", {"dx": 1, "dy": 2})))

    # -- NC-11: rotary axes a frame code turned ----------------------------------------------

    def test_nc11_rotary_axes_turned_by_a_frame_code_are_not_known_afterwards(self) -> None:
        preceding = ["BEGIN PGM P MM", "TOOL CALL 1 Z S5000", "L B+0 C+0 R0 FMAX", "PLANE SPATIAL SPA+0 SPB+45 SPC+0 TURN MB MAX FMAX", "PLANE RESET STAY"]
        text = "L X+10 Y+10 Z+5 R0 FMAX\nL Z-1 F100\nL X+50"
        for script, params, reason in (("translate", {"dx": 1, "dy": 2}, "rotary-turned"), ROTATE90 + ("rotary-word",), MIRROR_X + ("rotary-word",)):
            with self.subTest(script=script):
                result = run_geo(script, text, "heidenhain-klartext", params, preceding)
                self.assertEqual(result["text"], text)
                self.assertIn((6, reason), errors(result))
        # STAY never turned them: a tilt that leaves the axes keeps what the program wrote.
        stay = list(preceding)
        stay[3] = "PLANE SPATIAL SPA+0 SPB+45 SPC+0 STAY"
        self.assertEqual(errors(run_geo("translate", text, "heidenhain-klartext", {"dx": 1, "dy": 2}, stay)), [])
        # An absolute rotary word makes them known again.
        again = preceding + ["L B+0 C+0 R0 FMAX"]
        self.assertEqual(errors(run_geo("translate", text, "heidenhain-klartext", {"dx": 1, "dy": 2}, again)), [])

    def test_t010_a_plane_at_zero_angles_with_turn_refuses_nothing(self) -> None:
        # v1.2.0 (T010): the angles at zero turn no rotary axis, whatever word ends the PLANE.
        text = "L X+10 Y+10 Z+5 R0 FMAX\nL Z-1 F100\nL X+50"
        for plane in ("PLANE SPATIAL SPA+0 SPB+0 SPC+0 TURN MB MAX FMAX", "PLANE SPATIAL SPA+0 SPB+0 SPC+0 MOVE DIST50 F2000", "PLANE RESET TURN FMAX"):
            preceding = ["BEGIN PGM P MM", "TOOL CALL 1 Z S5000", "L B+0 C+0 R0 FMAX", plane]
            for script, params in (("translate", {"dx": 1, "dy": 2}), ROTATE90, MIRROR_X):
                with self.subTest(plane=plane, script=script):
                    self.assertEqual(errors(run_geo(script, text, "heidenhain-klartext", params, preceding)), [])
        # Not at zero, it still turns them.
        preceding = ["BEGIN PGM P MM", "TOOL CALL 1 Z S5000", "L B+0 C+0 R0 FMAX", "PLANE SPATIAL SPA+0 SPB+Q5 SPC+0 TURN MB MAX FMAX", "PLANE RESET STAY"]
        self.assertIn((6, "rotary-word"), errors(run_geo("rotate", text, "heidenhain-klartext", {"cx": 0, "cy": 0, "angle": 90}, preceding)))

    def test_fz4_a_drilling_cycle_after_an_arc_is_no_arc_for_the_transforms(self) -> None:
        # v1.2.0 (FZ-4): no helix warning for the cycle block, and its R moves with a Z shift.
        text = "G21 G17 G90\nG0 X0. Y0. Z10.\nG3 X20. Y0. I10. J0. F100.\nG81 X20. Y10. Z-5. R5. F100.\nG80\nM30"
        result = run_geo(*MIRROR_X[:1], text, "fanuc-gcode", MIRROR_X[1])
        self.assertEqual([(f["line"], f["reason"]) for f in result["findings"]], [(3, "climb-milling")])
        result = run_geo("translate", text, "fanuc-gcode", {"dx": 1, "dy": 2, "dz": 3})
        self.assertEqual(errors(result), [])
        self.assertEqual(result["text"].split("\n")[3], "G81 X21. Y12. Z-2. R8. F100.")

    def test_nc11_cycle800_turns_the_axes_unless_its_direction_is_0(self) -> None:
        swivel = 'CYCLE800(1,"TABLE",200000,57,0,0,0,0,45,0,0,0,0,%s,100,1)'
        text = "G90 G17 G71\nG0 B0 C0\n%s\nCYCLE800()\nG0 X10 Y10 Z5\nG1 Z-1 F100\nX50\nM30"
        result = run_geo("translate", text % (swivel % "1"), "sinumerik-mill", {"dx": 1, "dy": 2})
        self.assertIn((5, "rotary-turned"), errors(result))
        result = run_geo("translate", text % (swivel % "0"), "sinumerik-mill", {"dx": 1, "dy": 2})
        self.assertEqual([r for r in errors(result) if r[1] == "rotary-turned"], [])

    # -- NC-12: the workpiece blank (owner decision Q-D) ------------------------------------

    BLANK = (
        "BEGIN PGM P MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 1 Z S5000\n"
        "L X+0 Y+0 Z+5 R0 FMAX\nL X+10 Y+10 R0 F100\nEND PGM P MM"
    )

    def test_nc12_the_blank_is_left_as_written_with_one_row(self) -> None:
        for script, params in (ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                result = run_geo(script, self.BLANK, "heidenhain-klartext", params)
                self.assertEqual(errors(result), [])
                lines = result["text"].split("\n")
                self.assertEqual(lines[1:3], self.BLANK.split("\n")[1:3])
                self.assertEqual(lines[5], "L X-10 Y+10 R0 F100")
                rows = [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "info"]
                self.assertEqual(rows, [(2, "blank")])
        moved = run_geo("translate", self.BLANK, "heidenhain-klartext", {"dx": 1})
        self.assertEqual([f["reason"] for f in moved["findings"]], [])

    # -- NC-15: scaling reset by the factor 1 -----------------------------------------------

    def test_nc15_a_scaling_reset_by_the_factor_1_is_no_frame(self) -> None:
        text = (
            "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nCYCL DEF 11.0 SCALING\nCYCL DEF 11.1 SCL1\n"
            "CYCL DEF 26.0 AXIS-SPEC. SCALING\nCYCL DEF 26.1 X1 Y1 CCX+0 CCY+0\nL X+10 Y+10 Z+5 R0 FMAX\nEND PGM P MM"
        )
        for script, params in (("translate", {"dx": 1}), ROTATE90):
            with self.subTest(script=script):
                self.assertEqual(errors(run_geo(script, text, "heidenhain-klartext", params)), [])
        scaled = text.replace("SCL1", "SCL0.5")
        self.assertIn((7, "frame"), errors(run_geo("translate", scaled, "heidenhain-klartext", {"dx": 1})))

    # -- NC-17: the Sinumerik cutting edge --------------------------------------------------

    def test_nc17_a_cutting_edge_number_is_left_as_written(self) -> None:
        text = "G90 G17 G71\nG0 X10 Y10 Z5\nG1 X20 Y10 D2 F100\nSUPA G0 Z300 D0\nM30"
        for script, params in (ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                result = run_geo(script, text, "sinumerik-mill", params)
                self.assertEqual(errors(result), [])
        self.assertIn("G1 X-10 Y20 D2 F100", run_geo("rotate", text, "sinumerik-mill", ROTATE90[1])["text"].split("\n"))

    # -- NC-19: the rule items --------------------------------------------------------------

    def test_nc19_a_mirror_at_45_degrees_keeps_the_words_form(self) -> None:
        text = "%\nO1000\nG90 G17 G21\nG0 X10. Y0. Z5.\nG1 X20. Y5. F100.\nM30\n%"
        result = run_geo("mirror", text, "fanuc-gcode", {"about": "line", "px": 0, "py": 0, "angle": 45}, preset="is-b")
        self.assertEqual(result["text"].split("\n")[3:5], ["G0 X0. Y10. Z5.", "G1 X5. Y20. F100."])
        self.assertEqual([f["reason"] for f in result["findings"] if f["reason"] == "rounded"], [])

    def test_nc19_a_datum_shift_of_zero_is_no_shift(self) -> None:
        text = "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nTRANS DATUM AXIS X+0 Y+0 Z+0\nL X+10 Y+10 Z+5 R0 FMAX\nEND PGM P MM"
        self.assertEqual(errors(run_geo("translate", text, "heidenhain-klartext", {"dx": 1})), [])
        shifted = text.replace("X+0 Y+0", "X+5 Y+0")
        self.assertIn((3, "coordinate-shift"), errors(run_geo("translate", shifted, "heidenhain-klartext", {"dx": 1})))


class NormalAngleTest(unittest.TestCase):
    """CODE-11: the polar angle is brought back by the remainder, with the old answers."""

    @staticmethod
    def looped(value):
        full = D(360)
        while value > full:
            value -= full
        while value < -full:
            value += full
        return value

    def test_the_same_answers_as_the_loop(self) -> None:
        for text in ("0", "360", "-360", "360.5", "720", "721", "-720", "-721.25", "1080", "45", "-45", "359.999", "3600.001"):
            with self.subTest(value=text):
                self.assertEqual(_nc_geom._normal_angle(D(text)), self.looped(D(text)))

    def test_a_huge_angle_takes_no_time(self) -> None:
        self.assertEqual(_nc_geom._normal_angle(D("9999999999")), D("9999999999") - D(360) * 27777777)
        self.assertEqual(_nc_geom._normal_angle(D("-1E+30")), self.looped(D("-1E+30") % D(360) - D(720)))


class LatheYTest(unittest.TestCase):
    """Owner decision Q-B (2026-10-16, NC-14): under the Z mirror Y changes sign about 0."""

    def test_y_and_j_change_sign(self) -> None:
        op = _nc_geom.LatheZMirror(D(5))
        self.assertEqual(_nc_geom.transform("point", {"X": D(20), "Y": D("10.5"), "Z": D(2)}, op), ({"X": D(20), "Y": D("-10.5"), "Z": D(8)}, True))
        self.assertEqual(_nc_geom.transform("point-inc", {"Y": D(-3)}, op), ({"Y": D(3)}, True))
        self.assertEqual(_nc_geom.transform("centre-inc", {"Z": D(-10), "Y": D(4)}, op), ({"Z": D(10), "Y": D(-4)}, True))
        self.assertEqual(_nc_geom.LATHE_MIRROR_AXES, ("Z", "Y"))

    def test_a_y_word_is_read_and_judged_under_the_z_mirror(self) -> None:
        # The word is one the run changes now: an expression in it refuses, as one in Z does.
        text = "G90 G18 G71\nG0 X40 Z2\nG1 Y=R1 F0.2"
        _, tracker, steps = walk(text, "sinumerik")
        context = helpers.effective_context("sinumerik")
        step = steps[2]
        reasons = [r.reason for r in _nc_geom.refusals_of(step, _nc_geom.roles_of(step, tracker), tracker, LATHE, context)]
        self.assertIn("expression", reasons)


class FastWriteTest(unittest.TestCase):
    """P4a fix batch B6 (CODE-1): a word is written back through what is worked out once for its
    kind (a written 1, whether the presets write alike, a read as written), with the answers of
    ``write_back`` itself."""

    LITERALS = ("10.", "10.5", "-3.25", "0.", ".5", "-.5", "7.12345", "1000", "1000.", "-1", "+4.5", "12345.6789")
    TARGETS = ("0", "10", "-10", "8.660254037844", "-8.6605", "0.0005", "-0.00049", "10.0001", "12345.678912", "1E+2", "-0.5", "99999.99999")

    def contexts(self):
        for profile_id in helpers.profile_ids():
            yield helpers.effective_context(profile_id)
            declared = (((helpers.load_profile(profile_id).get("machineParams") or {}).get("numberInput") or {}).get("presets")) or []
            for preset in declared:
                yield helpers.effective_context(profile_id, preset=preset["id"])

    def test_the_fast_write_is_the_write_back(self) -> None:
        compared = fast = 0
        for context in self.contexts():
            tracker = _nc_path.PathTracker(context, gedit_nc.compile_profile(context["profile"]))
            data = _nc_geom._data(tracker)
            machines = [data.machine_of(context)] + list(data.presets)
            for machine in machines:
                for text in self.LITERALS:
                    literal = gedit_nc.parse_number(text)
                    for cls in ("length", "increment", "angle", "feedPerMin"):
                        for units in ("mm", "inch"):
                            if data.reads_as_written(bool(literal.has_point), cls, machine, units):
                                fast += 1
                            for target in self.TARGETS:
                                for exact in (True, False):
                                    want = _nc_geom._write_value(D(target), literal, cls, machine, units, exact, data.fmt, None)
                                    got = _nc_geom._write_value(D(target), literal, cls, machine, units, exact, data.fmt, data)
                                    self.assertEqual(got, want, (context["profile"].get("id"), machine.get("id"), text, cls, units, target, exact))
                                    compared += 1
        self.assertGreater(compared, 20000)
        self.assertGreater(fast, 100)  # the fast reading is the one most words take

    def test_a_klartext_decimal_comma_is_kept_by_the_fast_write(self) -> None:
        context = helpers.effective_context("heidenhain-klartext")
        tracker = _nc_path.PathTracker(context, gedit_nc.compile_profile(context["profile"]))
        data = _nc_geom._data(tracker)
        literal = gedit_nc.NumericLiteral(raw="+0,5", sign="+", int_part="0", frac_part="5", has_point=True)
        machine = data.machine_of(context)
        for target in ("0.25", "-0.125", "10", "0.3333333"):
            for exact in (True, False):
                want = _nc_geom._write_value(D(target), literal, "length", machine, "mm", exact, data.fmt, None)
                self.assertEqual(_nc_geom._write_value(D(target), literal, "length", machine, "mm", exact, data.fmt, data), want)
        self.assertEqual(_nc_geom._write_value(D("0.25"), literal, "length", machine, "mm", True, data.fmt, data)[0], "+0,25")

    def test_a_long_run_asks_the_machine_about_a_kind_of_word_once(self) -> None:
        # 300 words with a point and no machine chosen: the written 1 and the presets' agreement are
        # worked out for the first, not for each (value_of is the machine's reading of a number).
        text = "G90 G17 G21\n" + "\n".join("G1 X%d.5 Y%d.25 F800." % (i, i) for i in range(300))
        context, tracker, steps = walk(text, "fanuc-gcode")
        calls = []
        real = gedit_nc.value_of

        def counting(*args, **kwargs):
            calls.append(args[1])
            return real(*args, **kwargs)

        gedit_nc.value_of = counting
        try:
            for step in steps[1:]:
                for role in _nc_geom.roles_of(step, tracker):
                    if role.role == "point":
                        written = _nc_geom.write_word(role, D("1.125"), tracker, "mm", False, context)
                        self.assertIsInstance(written, _nc_geom.Written)
        finally:
            gedit_nc.value_of = real
        self.assertLess(len(calls), 20, len(calls))

    def with_presets(self, presets):
        context = helpers.effective_context("fanuc-gcode")
        context["profile"]["machineParams"]["numberInput"]["presets"] = presets
        tracker = _nc_path.PathTracker(context, gedit_nc.compile_profile(context["profile"]))
        return context, tracker, _nc_geom._data(tracker)

    @staticmethod
    def preset(name, mode, millimetres):
        return {"id": name, "label": name, "source": "test", "value": {"mode": mode, "incrementMm": millimetres, "incrementInch": "0.0001"}, "verify": True}

    def test_presets_that_count_in_the_same_increment_write_alike(self) -> None:
        literal = gedit_nc.parse_number("10000")
        same = [self.preset("a", "increment", "0.001"), self.preset("b", "increment", "0.001")]
        context, tracker, data = self.with_presets(same)
        machine = data.machine_of(context)
        self.assertTrue(data.writes_alike(False, "length", machine, "mm"))
        for target in ("10.5", "10.0005", "-3"):
            results = {repr(_nc_geom._write_value(D(target), literal, "length", m, "mm", False, data.fmt, None)) for m in [machine] + data.presets}
            self.assertEqual(len(results), 1)

    def test_presets_that_count_differently_do_not_write_alike(self) -> None:
        for presets in (
            [self.preset("a", "increment", "0.001"), self.preset("b", "increment", "0.0001")],
            [self.preset("a", "increment", "0.001"), self.preset("b", "calculator", "0.001")],
            [self.preset("a", "calculator", "0.001"), self.preset("b", "scale", "1")],
        ):
            context, tracker, data = self.with_presets(presets)
            machine = data.machine_of(context)
            with self.subTest(presets=[p["id"] + p["value"]["mode"] + p["value"]["incrementMm"] for p in presets]):
                self.assertFalse(data.writes_alike(False, "length", machine, "mm"))

    def test_an_increment_that_is_one_is_not_taken_for_a_reading_as_written(self) -> None:
        # Counting in whole millimetres and reading as written both give a written 1 the value 1,
        # but a word without a point is written back differently: the presets are compared one by one.
        presets = [self.preset("a", "calculator", "1"), self.preset("b", "increment", "1")]
        context, tracker, data = self.with_presets(presets)
        self.assertFalse(data.writes_alike(False, "length", data.machine_of(context), "mm"))
        literal = gedit_nc.parse_number("10")
        refused = _nc_geom.write_word(
            _nc_geom.WordRole(gedit_nc.Token(kind="word", start=0, end=3, text="X10", address="X", value_text="10", value=literal), "point", "X", "length", None),
            D("10.5"), tracker, "mm", False, context,
        )
        self.assertIsInstance(refused, _nc_geom.Refusal)
        self.assertEqual(refused.reason, "machine-dependent")


class FindingTextTest(unittest.TestCase):
    """P4a fix batch B6: two refusal texts that said less (position-unknown) or more (coordinate-shift)
    than the refusals that use them."""

    def test_a_work_offset_write_is_not_called_a_coordinate_shift_only(self) -> None:
        # v1.2 T013: a tool offset (`G10 L10`) is no longer refused at all (`ToolOffsetWriteTest`);
        # the text still covers the data settings that write a work offset.
        result = run_geo("translate", "G90 G21 G17\nG0 X0. Y0.\nG10 L2 P1 X-200. Y-100.\nG1 X1. Y1. F100.", "fanuc-gcode", {"dx": 1})
        self.assertEqual(errors(result), [(3, "coordinate-shift")])
        message = result["findings"][0]["message"]
        self.assertTrue(message.startswith("G10 L2 P1 X-200. Y-100.: this sets or shifts the coordinate system or writes offsets"), message)
        self.assertNotIn("in another system", message)

    def test_a_start_that_is_not_known_names_the_jump_and_the_loop(self) -> None:
        text = _nc_geom.REASONS["position-unknown"][1]
        self.assertIn("a jump or a loop", text)
        self.assertIn("an axis not written yet", text)
        # The end of a loop whose body needs its start is refused with this reason (plan §7 #313) and says so.
        text = "G90 G17 G71\nG0 X10 Y10 Z5\nWHILE R1<2\nG1 X20 F100\nG1 Y30\nR1=R1+1\nENDWHILE\nM30"
        result = run_geo("rotate", text, "sinumerik-mill", {"cx": 0, "cy": 0, "angle": 90})
        row = next(f for f in result["findings"] if f["reason"] == "position-unknown")
        self.assertIn("a jump or a loop that brings the tool here from another place or runs this block again", row["message"])


class ToolOffsetWriteTest(unittest.TestCase):
    """v1.2 NC fix round (T013): `G10 L1`, `L10`-`L13` write a tool offset (`CodeParam.
    toolOffsetValues` on `L` of Fanuc `G10`), no coordinate system, so the geometry transforms
    pass them; a work offset (`L2`, `L20`), a variable or a missing `L` still refuses."""

    HEAD = "G90 G21 G17\nG0 X0. Y0.\n"
    TAIL = "\nG1 X10. Y0. F100.\nM30"

    def check(self, profile, block, refused):
        for script, params in (("translate", {"dx": 1}), ROTATE90, MIRROR_X):
            with self.subTest(profile=profile, block=block, script=script):
                result = run_geo(script, self.HEAD + block + self.TAIL, profile, params)
                self.assertEqual(errors(result), [(3, "coordinate-shift")] if refused else [])
                lines = result["text"].split("\n")
                self.assertEqual(lines[2], block)  # the data setting itself is never changed

    def test_a_tool_length_or_radius_offset_passes(self) -> None:
        for block in ("G10 L10 P1 R12.5", "G10 L11 P1 R-0.02", "G10 L12 P1 R5.", "G10 L13 P1 R0.01", "G10 L1 P1 R12.5", "G10 L01 P1 R12.5"):
            self.check("fanuc-gcode", block, refused=False)

    def test_a_work_offset_or_an_unknown_table_still_refuses(self) -> None:
        for block in ("G10 L2 P1 X-200. Y-100.", "G10 L20 P1 X-200. Y-100.", "G10 L#1 P1 R12.5", "G10 P1 R12.5", "G10 L3 P1"):
            self.check("fanuc-gcode", block, refused=True)

    def test_the_tool_offset_is_read_on_the_lathe_too(self) -> None:
        # The lathe inherits G10 from the mill database. Its own form without L (`G10 P1 X… Z…`,
        # P0 being the workpiece shift) is not told apart and stays refused.
        head, tail = "G18 G21 G99\nG0 X50. Z5.\n", "\nG1 X40. Z-10. F0.2\nM30"
        for block, refused in (("G10 L11 P1 R0.4", False), ("G10 P1 X0.1 Z0.05", True), ("G10 P0 X0. Z-0.5", True)):
            with self.subTest(block=block):
                result = run_geo("translate", head + block + tail, "fanuc-lathe", {"dz": -1})
                self.assertEqual(errors(result), [(3, "coordinate-shift")] if refused else [])


class NcfcThreadPassTest(unittest.TestCase):
    """v1.2.0 NC fix round, NCF-C: the threading passes G92 (system A) and G78 (system B) are
    whole passes (`path: 'cycle'`). Under the lathe Z mirror a taper thread is refused as a
    thread alone; its taper R is part of the thread, not a second reason."""

    @staticmethod
    def reasons(text, line, variant=None):
        context = helpers.effective_context("fanuc-lathe", variant=variant) if variant else helpers.effective_context("fanuc-lathe")
        tracker = _nc_path.PathTracker(context, gedit_nc.compile_profile(context["profile"]))
        state = None
        for number, written in enumerate(text.split("\n")[:line], 1):
            state, step = tracker.line(written, number, state, True)
        return [r.reason for r in _nc_geom.refusals_of(step, _nc_geom.roles_of(step, tracker), tracker, LATHE, context)]

    def test_a_taper_thread_pass_is_refused_as_a_thread(self) -> None:
        for variant, code in ((None, "G92"), (("gcodeSystem", "B"), "G78")):
            text = "G18 G21\nG0 X44. Z6.\n%s X39.2 Z-20. R-2.5 F1.5\nX38.6 R-2.\nM30" % code
            with self.subTest(code=code):
                self.assertEqual([r for r in self.reasons(text, 3, variant) if r != "distance-assumed"], ["thread"])
                self.assertEqual([r for r in self.reasons(text, 4, variant) if r != "distance-assumed"], ["thread"])
        # A turning pass with a taper keeps its own reason.
        self.assertEqual(
            [r for r in self.reasons("G18 G21\nG0 X52. Z2.\nG90 X40. Z-20. R-2. F0.2\nM30", 3) if r != "distance-assumed"],
            ["single-pass-taper"],
        )


class FuzzOverRefusalTest(unittest.TestCase):
    """v1.2 NC fix round, NCF-A (the fuzz review's FZ-6, FZ-7, FZ-9): words the transforms refused
    as `word-unknown` although they keep their value under every transform."""

    def test_fz6_klartext_approach_and_departure_lengths_and_angles(self) -> None:
        # LEN, the arc radius R and the centre angle CCA (measured along the arc, so it does not
        # turn) of APPR/DEP LT, LN, CT, LCT keep their values.
        text = "\n".join([
            "0 BEGIN PGM A MM", "1 TOOL CALL 1 Z S3000", "2 L X+0 Y+0 Z+5 R0 FMAX",
            "3 APPR LT X+10 Y+20 LEN15 RR F100", "4 L X+30 Y+20", "5 DEP LT LEN12.5 F100",
            "6 APPR CT X+10 Y+20 CCA90 R+5 RL F100", "7 L X+30 Y+20", "8 DEP CT CCA180 R+8 F100",
            "9 APPR LN X+10 Y+20 LEN15 RR F100", "10 L X+30 Y+20", "11 DEP LN LEN+20 F100", "12 END PGM A MM",
        ])
        for script, params in (ROTATE90, MIRROR_X, ("translate", {"dx": 1})):
            with self.subTest(script=script):
                result = run_geo(script, text, "heidenhain-klartext", params)
                self.assertEqual(errors(result), [])
                lines = result["text"].split("\n")
                self.assertIn("LEN15", lines[3])
                self.assertIn("CCA90 R+5", lines[6])
                self.assertIn("LEN12.5", lines[5])

    def test_fz7_sinumerik_corner_rounding_and_chamfer(self) -> None:
        text = "N10 G17 G90 G71\nN20 G0 X0 Y0 Z5\nN30 G1 X10 Y0 RND=2 F200\nN40 G1 X10 Y10 CHR=1\nN50 G1 X0 Y10 CHF=1.5\nN60 G1 X0 Y0 RNDM=0.5\nN70 M30"
        for script, params in (("translate", {"dx": 1}), ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                result = run_geo(script, text, "sinumerik-mill", params)
                self.assertEqual(errors(result), [])
                lines = result["text"].split("\n")
                for line, word in zip(lines[2:6], ("RND=2", "CHR=1", "CHF=1.5", "RNDM=0.5")):
                    self.assertIn(" %s" % word, line)

    def test_ncfc_sinumerik_chamfer_and_rounding_feeds(self) -> None:
        # v1.2.0 (NCF-C): FRC= and FRCM= are feeds of the chamfer or rounding (no length): every
        # transform keeps them as written instead of refusing them as unknown words.
        text = "N10 G17 G90 G71\nN20 G0 X0 Y0 Z5\nN30 G1 X10 Y0 CHF=1 FRC=200 F500\nN40 G1 X10 Y10 RNDM=2 FRCM=50\nN50 G1 X0 Y10 RNDM=0 FRCM=0\nN60 M30"
        for script, params in (("translate", {"dx": 1}), ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                result = run_geo(script, text, "sinumerik-mill", params)
                self.assertEqual(errors(result), [])
                lines = result["text"].split("\n")
                for line, word in zip(lines[2:5], ("FRC=200", "FRCM=50", "FRCM=0")):
                    self.assertIn(" %s" % word, line)

    def test_fz9_a_length_offset_number_without_its_code(self) -> None:
        # `H1` without `G43` is the length offset number (§7 #304), as `D2` is the radius one;
        # only the axis words of the group's codes (`Z` of `G43`) and every word of a code that
        # takes positions (`G28`) stay unknown without their code (#320).
        for block in ("Z37.7 H1", "G1 X5. D2 F100."):
            text = "G21 G17 G90\nG0 X1. Y1. Z5.\n%s\nG1 X5. Y2. F100.\nM30" % block
            for script, params in (ROTATE90, MIRROR_X):
                with self.subTest(block=block, script=script):
                    result = run_geo(script, text, "fanuc-gcode", params)
                    self.assertEqual(errors(result), [])
                    self.assertTrue(result["text"].split("\n")[2].endswith(block.split()[-1] if "H1" in block else "F100."))

    def test_sinumerik_rounding_distances_and_arc_radius_keep_their_values(self) -> None:
        # v1.2 NC fix round: ADIS= and ADISPOS= are path-smoothing distances (no size of the
        # part) and CR= the radius of an arc: every transform keeps them as written.
        text = "N10 G17 G90 G71\nN20 G0 X0 Y0 Z5 ADISPOS=1\nN30 G641 ADIS=0.5\nN40 G1 X10 Y0 F200\nN50 G2 X20 Y0 CR=5\nN60 M30"
        for script, params in (("translate", {"dx": 1}), ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                result = run_geo(script, text, "sinumerik-mill", params)
                self.assertEqual(errors(result), [])
                lines = result["text"].split("\n")
                self.assertIn("ADISPOS=1", lines[1])
                self.assertIn("ADIS=0.5", lines[2])
                self.assertIn("CR=5", lines[4])


class Fb2ToolDirectionTest(unittest.TestCase):
    """v1.2.0 review round X, FB-2: under Fanuc `G43.5`, `G41.6` and `G42.6` I, J and K are the
    tool direction, in the block that writes the code and in the blocks it governs. A turn or a
    mirror of the path would have to turn it too, which gEdit does not do: those blocks are
    refused (before FB-2 the `G43.5` block itself went through with its direction unturned).
    A shift leaves the direction alone, as it should."""

    TEXT = "\n".join([
        "G90 G17 G21 G54 G0 X0. Y0.", "G43.5 X10. Y0. Z10. I1. J0. K1. H1", "G1 X10. Y5. I1. J0. K1. F500.",
        "G49", "G41.6 X5. Y5. I0. J0. K1. D1", "G1 X10. I0. J1. K0.", "G40 G1 X20.",
    ])

    def test_a_turn_or_a_mirror_refuses_a_turned_tool_direction(self):
        for script, params in (ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                found = errors(run_geo(script, self.TEXT, "fanuc-gcode", params))
                self.assertIn((2, "word-unknown"), found)
                self.assertIn((3, "word-unknown"), found)
                self.assertIn((6, "word-unknown"), found)
                # I0. J0. points along the tool axis: a turn in the plane leaves it as it is.
                self.assertNotIn((5, "word-unknown"), found)

    def test_a_shift_leaves_the_tool_direction_alone(self):
        result = run_geo("translate", self.TEXT, "fanuc-gcode", {"dx": 5, "dy": 0, "dz": 0})
        self.assertEqual(errors(result), [])
        self.assertEqual(result["text"].split("\n")[2], "G1 X15. Y5. I1. J0. K1. F500.")
        self.assertEqual([f for f in result.get("findings", []) if f["reason"] == "word-left"], [])


class ManualCheckB5Test(unittest.TestCase):
    """v1.2.0 manual-check fix round, batch B5 (owner decisions D6-1, D6-5, D6-6, D6-7, D1-3 of
    2026-10-25): what the Sinumerik and Klartext manuals say about frames, the swivel to the home
    position, cycle 19 positioning the rotary axes itself and SD42440, through the scripts."""

    SWIVEL_HOME = 'CYCLE800(1,"",0,57,0,0,0,0,0,0,0,0,0,1,0,1)'

    def test_d6_1_a_frame_along_the_tool_above_the_selection_refuses_the_shift(self):
        # TOROT, TOFRAME, ROTS, AROTS, CROTS and PAROT turn the workpiece coordinate system;
        # before D6-6 TOROT was a subprogram call, and nothing above the selection refused.
        text = "G0 X10 Y10 Z5\nG1 X50 F100"
        for code in ("TOROT", "TOROTX", "TOFRAME", "ROTS X30 Y45", "AROTS X10", "CROTS Y20", "PAROT"):
            with self.subTest(code=code):
                result = run_geo("translate", text, "sinumerik-mill", {"dx": 1, "dy": 2}, ["G90 G17 G71", "G0 X0 Y0 Z50", code])
                self.assertEqual(result["text"], text)
                self.assertEqual(errors(result), [(4, "frame"), (5, "frame")])
        # ROT or TRANS alone clears the programmable frame, PAROTOF the alignment on the workpiece.
        for code, end in (("TOROT", "TOROTOF"), ("ROTS X30", "TRANS"), ("PAROT", "PAROTOF")):
            with self.subTest(code=code, end=end):
                result = run_geo("translate", text, "sinumerik-mill", {"dx": 1, "dy": 2}, ["G90 G17 G71", "G0 X0 Y0 Z50", code, end])
                self.assertEqual(errors(result), [])
        # ROT alone ends it on the control too; gEdit waits for TOROTOF, the safe reading.
        result = run_geo("translate", text, "sinumerik-mill", {"dx": 1, "dy": 2}, ["G90 G17 G71", "G0 X0 Y0 Z50", "TOROT", "ROT"])
        self.assertEqual(errors(result), [(5, "frame"), (6, "frame")])

    def test_d6_5_the_swivel_to_the_home_position_leaves_no_frame(self):
        # The Siemens operating manual starts every program on a machine with swivelling by
        # swivelling to the home position: a new swivel with every angle and reference point 0.
        text = "G90 G17 G71\nT1 D1\nM6\nG54\n%s\nG0 X10 Y10 Z5\nG1 Z-1 F100\nX50\nM30"
        for script, params in (("translate", {"dx": 1, "dy": 2}), ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                found = errors(run_geo(script, text % self.SWIVEL_HOME, "sinumerik-mill", params))
                self.assertEqual([r for r in found if r[1] == "frame"], [])
        # The data set name "0" deselects the swivel whatever the angles say.
        found = errors(run_geo("translate", text % 'CYCLE800(1,"0",0,57,0,0,0,0,30,0,0,0,0,1,0,1)', "sinumerik-mill", {"dx": 1, "dy": 2}))
        self.assertEqual([r for r in found if r[1] == "frame"], [])
        # An angle, a swivel on top of the active one (_ST ones digit 1) or a variable keep it.
        for swivel in ('CYCLE800(1,"",0,57,0,0,0,0,30,0,0,0,0,1,0,1)', 'CYCLE800(1,"",1,57,0,0,0,0,0,0,0,0,0,1,0,1)', 'CYCLE800(1,"",0,57,0,0,0,0,R1,0,0,0,0,1,0,1)'):
            with self.subTest(swivel=swivel):
                found = errors(run_geo("translate", text % swivel, "sinumerik-mill", {"dx": 1, "dy": 2}))
                self.assertIn((6, "frame"), found)

    def test_d6_6_cycle_19_with_a_feed_turns_the_rotary_axes_itself(self):
        # TNC 640 cycles manual (cycle 19): with a feed (and a set-up clearance) in 19.1 the
        # machine positions the rotary axes; the reset afterwards leaves them where they went.
        text = (
            "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nL B+0 C+0 R0 FMAX\nCYCL DEF 19.0 WORKING PLANE\nCYCL DEF 19.1 B+45 F5000\n"
            "CYCL DEF 19.0 WORKING PLANE\nCYCL DEF 19.1\nL X+10 Y+10 Z+5 R0 FMAX\nL Z-1 F100\nL X+50\nEND PGM P MM"
        )
        result = run_geo("translate", text, "heidenhain-klartext", {"dx": 1, "dy": 2})
        self.assertEqual(result["text"], text)
        self.assertIn((8, "rotary-turned"), errors(result))
        # An absolute rotary word makes them known again.
        again = text.replace("CYCL DEF 19.1\n", "CYCL DEF 19.1\nL B+0 C+0 R0 FMAX\n")
        self.assertEqual([r for r in errors(run_geo("translate", again, "heidenhain-klartext", {"dx": 1, "dy": 2})) if r[1] == "rotary-turned"], [])

    SD42440 = "G90 G17 G71\nG0 X0 Y0 Z50\n%s\nG91 G1 X5 F100\nG90 G1 X20 Y10\nG91 X5\nM30"

    def test_d6_7_an_increment_after_a_shift_is_not_turned_or_mirrored(self):
        # SD42440 at 1: the first incremental move of an axis after TRANS, ATRANS or a work offset
        # code travels the change of the shift as well, which a turn or a mirror cannot follow.
        for shift in ("TRANS X10", "ATRANS Y5", "G55", "TRANS"):
            for script, params in (ROTATE90, MIRROR_X):
                with self.subTest(shift=shift, script=script):
                    result = run_geo(script, self.SD42440 % shift, "sinumerik-mill", params)
                    found = errors(result)
                    self.assertIn((4, "shift-increment"), found)
                    message = [f["message"] for f in result["findings"] if f["reason"] == "shift-increment"][0]
                    self.assertIn("SD42440", message)
                    # Once X and Y are written absolutely, an increment is a plain increment.
                    self.assertNotIn((6, "shift-increment"), found)
        # A shift of the program moves every block alike: translate is not concerned.
        found = errors(run_geo("translate", self.SD42440 % "G55", "sinumerik-mill", {"dx": 1, "dy": 2}))
        self.assertNotIn((4, "shift-increment"), found)
        # The same block in a selection below the shift is refused as the whole program is.
        result = run_geo("rotate", "G91 G1 X5 F100\nG90 G1 X20 Y10", "sinumerik-mill", ROTATE90[1], ["G90 G17 G71", "G0 X0 Y0 Z50", "G55"])
        self.assertIn((4, "shift-increment"), errors(result))
        result = run_geo("rotate", "G91 G1 X5 F100\nG90 G1 X20 Y10", "sinumerik-mill", ROTATE90[1], ["G90 G17 G71", "G55", "G0 X0 Y0 Z50"])
        self.assertNotIn((4, "shift-increment"), errors(result))
        # A Fanuc increment after G55 moves by the increment only.
        fanuc = "G90 G17 G21\nG0 X0. Y0. Z50.\nG55\nG91 G1 X5. F100.\nM30"
        self.assertNotIn((4, "shift-increment"), errors(run_geo("rotate", fanuc, "fanuc-gcode", ROTATE90[1])))

    def test_d1_3_cycle82_arguments_10_to_14_are_described_and_still_refused(self):
        # The 2019 and 2020 programming manuals give CYCLE82 14 arguments; the last five
        # (pre-drilling and drilling through) are described now, as modes: left out or 0 they
        # are the cycle of nine arguments, any other value is refused as before.
        context = helpers.effective_context("sinumerik-mill")
        entry = next(e for e in context["codes"] if e.get("code") == "CYCLE82")
        self.assertEqual([p["address"] for p in entry["params"]][9:], ["_VARI", "S_ZA", "S_FA", "S_ZD", "S_FD"])
        base = "G90 G17 G71\nG0 X10 Y10 Z50\n%s\nM30"
        for call in ("CYCLE82(10,0,2,-5,,1,0,0,0,10000,-2,50,0,0)", "CYCLE82(10,0,2,-5,,1,0,0,0,0,0,0,0,30)"):
            with self.subTest(call=call):
                result = run_geo("translate", base % call, "sinumerik-mill", {"dx": 1, "dy": 2})
                self.assertIn((3, "cycle-not-reviewed"), errors(result))
        for call in ("CYCLE82(10,0,2,-5,,1,0,0,0,0,0,0,0,0)", "CYCLE82(10,0,2,-5,,1,0,0,0,,,,,)"):
            with self.subTest(call=call):
                result = run_geo("translate", base % call, "sinumerik-mill", {"dx": 1, "dy": 2})
                self.assertEqual(errors(result), [])

    def test_d1_3_the_extents_expand_cycle82_only_with_the_five_at_0(self):
        from tests.python import test_extents as ext

        w = ext.walk("G17 G90 G0 X0 Y0 Z50\nCYCLE82(10,0,2,-5,,1,0,0,0,0,0,0,0,0)\nM30", "sinumerik-mill")
        self.assertEqual(ext.extent(w, "Z"), ("-5", "50", 0))
        w = ext.walk("G17 G90 G0 X0 Y0 Z50\nCYCLE82(10,0,2,-5,,1,0,0,0,10000,-2,50,0,0)\nM30", "sinumerik-mill")
        self.assertNotEqual(ext.extent(w, "Z"), ("-5", "50", 0))


class ManualCheckLapChangePointTest(unittest.TestCase):
    """v1.2.0 manual-check fix round, D5-1 (with batch B3, which marks the Okuma LAP ``G84``
    change points in ``codes/okuma.json``): a cycle parameter that is a coordinate of an axis
    (``CodeParam.axis``: ``XA=``/``XB=`` of X, ``ZA=``/``ZB=`` of Z) moves with its axis under a
    known absolute mode, as a diameter on a diameter axis, and is refused in incremental mode or
    with the mode not known. The marks are set here if the database does not carry them yet."""

    LAP = ["G90 G00 X100. Z5.", "G85 NAT01 D4. F0.3 U0.4 W0.2", "$ G84 ZA=-20.", "NAT01 G81", "G01 X40. Z0.", "Z-30.", "X80.", "G80", "G00 X200. Z100.", "M30"]

    def run_translate(self, lines, params):
        context = helpers.effective_context("okuma-osp", preset="okuma-1mm")
        for entry in context["codes"]:
            if entry.get("code") == "G84":
                for param in entry.get("params") or []:
                    if param["address"] in ("XA", "XB", "ZA", "ZB"):
                        param.setdefault("axis", param["address"][0])
        context["params"] = params
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        out = helpers.run_script("translate.py", stdin="\n".join(lines), context=context)
        if not out.ok:
            raise AssertionError(out.stderr)
        return out.json()

    def test_a_z_shift_moves_za_with_the_contour(self):
        report = self.run_translate(self.LAP, {"dz": -10})
        lines = report["text"].split("\n")
        self.assertEqual(lines[2], "$ G84 ZA=-30.")
        self.assertEqual(lines[4], "G01 X40. Z-10.")
        # Nothing about the line's `$`: it continues the block, it is no word gEdit left alone.
        self.assertEqual(report.get("findings") or [], [])

    def test_an_x_shift_moves_xa_as_a_diameter(self):
        lines = [line.replace("ZA=-20.", "XA=60.") for line in self.LAP]
        report = self.run_translate(lines, {"dx": 4})
        self.assertEqual(report["text"].split("\n")[2], "$ G84 XA=64.")
        self.assertEqual(report["text"].split("\n")[0], "G90 G00 X104. Z5.")

    def test_incremental_mode_refuses_the_change_point(self):
        lines = ["G91 G00 X0 Z0"] + self.LAP[1:]
        report = self.run_translate(lines, {"dz": -10})
        self.assertIn((3, "cycle-position"), [(f["line"], f["reason"]) for f in report.get("findings") or []])
        self.assertEqual(report["text"].split("\n")[2], "$ G84 ZA=-20.")


class ManualCheckB5PathTest(unittest.TestCase):
    """v1.2.0 manual-check fix round, the `_nc_path` half of D6-5 and D6-6 (`turns_rotary`): the
    swivel to the home position and a zero cycle 19 keep what was known about the rotary axes
    (as T010 does for PLANE), and cycle 19 turns them only when its 19.1 writes F or ABST."""

    def test_d6_5_the_swivel_to_the_home_position_keeps_the_rotary_axes(self):
        text = 'G90 G17 G71\nG0 B0 C0\nCYCLE800(1,"",0,57,0,0,0,0,0,0,0,0,0,1,0,1)\nG0 X10 Y10 Z5\nG1 Z-1 F100\nX50\nM30'
        for script, params in (("translate", {"dx": 1, "dy": 2}), ROTATE90, MIRROR_X):
            with self.subTest(script=script):
                self.assertEqual(errors(run_geo(script, text, "sinumerik-mill", params)), [])
        # A swivel with an angle still turns them.
        turned = text.replace("0,0,0,0,0,0,0,0,0,1,0,1", "0,0,0,0,30,0,0,0,0,1,0,1")
        self.assertIn((8, "rotary-turned"), errors(run_geo("translate", turned.replace("X50\nM30", "X50\nCYCLE800()\nX60\nM30"), "sinumerik-mill", {"dx": 1, "dy": 2})))

    def test_d6_6_cycle_19_turns_the_rotary_axes_only_with_a_feed_or_a_clearance(self):
        head = "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nL B+0 C+0 R0 FMAX\nCYCL DEF 19.0 WORKING PLANE\n"
        tail = "CYCL DEF 19.0 WORKING PLANE\nCYCL DEF 19.1\nL X+10 Y+10 Z+5 R0 FMAX\nL Z-1 F100\nL X+50\nEND PGM P MM"
        for one, turned in (("CYCL DEF 19.1 B+45 F5000", True), ("CYCL DEF 19.1 B+45 ABST50", True), ("CYCL DEF 19.1 B+45", False)):
            with self.subTest(block=one):
                found = errors(run_geo("translate", head + one + "\n" + tail, "heidenhain-klartext", {"dx": 1, "dy": 2}))
                self.assertEqual((8, "rotary-turned") in found, turned)
        # All angles at 0 with a feed: no tilt, the axes keep what was known (T010).
        text = head + "CYCL DEF 19.1 B+0 C+0 F5000\nL X+10 Y+10 Z+5 R0 FMAX\nL Z-1 F100\nL X+50\nEND PGM P MM"
        self.assertEqual(errors(run_geo("translate", text, "heidenhain-klartext", {"dx": 1, "dy": 2})), [])


def run_patched(script, text, context, params):
    """One run of a geometry script on an inline program with a context made by the test."""
    import json as _json

    context = _json.loads(_json.dumps(context))
    context["params"] = params
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    out = helpers.run_script(script + ".py", stdin=text, context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


def source_profile(profile_id):
    """A profile as the data folder ships it (before the resolved fixtures are written again)."""
    import json as _json

    return _json.loads((helpers.REPO_ROOT / "src" / "lib" / "data" / "profiles" / ("%s.json" % profile_id)).read_text(encoding="utf-8"))


def with_syntax(context, **members):
    """``context`` with members put into its profile's ``syntax`` (the shipped value, so the test
    does not wait for the resolved fixtures)."""
    import json as _json

    context = _json.loads(_json.dumps(context))
    context["profile"].setdefault("syntax", {}).update(members)
    return context


def with_variant(context, name, value):
    """``context`` with a machine that makes the variant ``name`` the choice ``value``."""
    import json as _json

    context = _json.loads(_json.dumps(context))
    machine = gedit_nc.machine_params(context)
    variants = dict(machine["params"].get("variants") or {})
    variants[name] = value
    context["machine"] = {
        "id": "review-g",
        "name": "Review G lathe",
        "choice": "document",
        "params": dict(machine["params"], variants=variants),
        "source": dict(machine["source"], variants={k: "machine" for k in variants}),
    }
    return context


class ReviewRoundGTest(unittest.TestCase):
    """v1.2.0 review round, batch G: NC-1 with SK-1 (D6-7, SD42440), D6-4 (the table coordinate
    system under tool centre point control), D5-7 (the counter spindle's Y) and NC-9 (the
    drilling R of a lathe set to the Series 15 format). Synthetic programs, written for gEdit."""

    def test_nc_1_a_work_offset_written_with_an_absolute_move_has_been_travelled(self):
        # `G54 G0 X0 Y0 Z100` goes to an absolute point in the new zero point: the increments
        # after it travel nothing extra, so they are turned and mirrored.
        text = "N10 G17 G90 G54 G0 X0 Y0 Z100\nN20 G91 G1 X5 Y5 F100\nN30 G90 X20\nN40 M30"
        for script, params in (ROTATE90, MIRROR_X, MIRROR_Y):
            with self.subTest(script=script, params=params):
                result = run_geo(script, text, "sinumerik-mill", params)
                self.assertEqual(errors(result), [])
                self.assertNotEqual(result["text"], text)
        rotated = run_geo("rotate", text, "sinumerik-mill", ROTATE90[1])
        self.assertEqual(rotated["text"].split("\n")[1], "N20 G91 G1 X-5 Y5 F100")
        # A shift written as data (`TRANS X10`) is no move: the increment after it still refuses.
        trans = "G17 G90 G0 X0 Y0 Z100\nTRANS X10\nG91 G1 X5 F100\nM30"
        self.assertIn((3, "shift-increment"), errors(run_geo("rotate", trans, "sinumerik-mill", ROTATE90[1])))
        # Only the axes the offset block wrote absolutely are travelled: Y is still pending.
        y_first = "G17 G90 G0 X0 Y0 Z100\nG55 G0 X10\nG91 G1 %s F100\nM30"
        self.assertIn((3, "shift-increment"), errors(run_geo("mirror", y_first % "Y5", "sinumerik-mill", MIRROR_Y[1])))
        self.assertNotIn((3, "shift-increment"), errors(run_geo("mirror", y_first % "X5", "sinumerik-mill", MIRROR_X[1])))
        # A rotation turns X into Y, so with Y pending an increment along X refuses too.
        self.assertIn((3, "shift-increment"), errors(run_geo("rotate", y_first % "X5", "sinumerik-mill", ROTATE90[1])))

    def test_sk_1_an_offset_change_in_the_incremental_block_itself_refuses(self):
        # `G55 G91 G1 X5 Y5`: the block that changes the offset moves incrementally, so it
        # travels the change too (SD42440 = 1); a turn would leave that part unturned.
        for text in (
            "N10 G17 G90 G0 X0 Y0 Z100\nN20 G55 G91 G1 X5 Y5 F100\nN30 M30",
            "N10 G17 G90 G54 G0 X0 Y0 Z100\nN20 G55 G91 G1 X5 F100\nN30 M30",
        ):
            for script, params in (ROTATE90, MIRROR_X):
                with self.subTest(text=text, script=script):
                    result = run_geo(script, text, "sinumerik-mill", params)
                    self.assertIn((2, "shift-increment"), errors(result))
                    self.assertEqual(result["text"], text)
        # The same block with an absolute move is a plain move to the new zero point.
        absolute = "N10 G17 G90 G0 X0 Y0 Z100\nN20 G55 G90 G1 X5 Y5 F100\nN30 G91 X5\nN40 M30"
        self.assertEqual(errors(run_geo("rotate", absolute, "sinumerik-mill", ROTATE90[1])), [])

    TCP = "G90 G54 G0 X0. Y0. Z100. B0.\nG43.4 H1\nG1 X10. Y10. B30. F500.\nX20.\nG0 B0.\nG49\nM30"

    def test_d6_4_a_shift_under_tcp_says_it_assumes_the_table_coordinate_system(self):
        self.assertIs(source_profile("fanuc-gcode")["syntax"].get("tcpTableCoordinates"), True)
        context = with_syntax(helpers.effective_context("fanuc-gcode", preset="is-b"), tcpTableCoordinates=True)
        result = run_patched("translate", self.TCP, context, {"dx": 5})
        self.assertEqual(errors(result), [])
        notes = [(f["line"], f["severity"]) for f in result["findings"] if f["reason"] == "tcp-table"]
        self.assertEqual(notes, [(3, "info")])  # once, at the first block moved under G43.4
        message = [f["message"] for f in result["findings"] if f["reason"] == "tcp-table"][0]
        self.assertIn("table coordinate system (parameter 19696 bit 5 = 0)", message)
        self.assertIn("Check your machine", message)
        self.assertIn("assumes the table coordinate system (parameter 19696 bit 5 = 0)", result["message"])
        self.assertIn("X15.", result["text"])
        # Without tool centre point control, or on a profile that does not declare it: no note.
        plain = run_patched("translate", "G90 G54 G0 X0. Y0. Z100.\nG1 X10. Y10. F500.\nM30", context, {"dx": 5})
        self.assertEqual([f for f in plain["findings"] if f["reason"] == "tcp-table"], [])
        self.assertNotIn("19696", plain["message"])
        off = run_patched("translate", self.TCP, with_syntax(context, tcpTableCoordinates=False), {"dx": 5})
        self.assertEqual([f for f in off["findings"] if f["reason"] == "tcp-table"], [])

    MIRROR = "G18 G90 G0 X50. Y5. Z2.\nG1 Z-20. Y-3. F0.2\nM30"

    def test_d5_7_the_counter_spindle_y_turns_by_default_and_stays_with_the_other_choice(self):
        for profile_id in ("fanuc-lathe", "okuma-osp", "sinumerik"):
            with self.subTest(profile=profile_id):
                variant = next(v for v in source_profile(profile_id)["machineParams"]["variants"] if v["id"] == "counterSpindleY")
                self.assertEqual(variant["default"], "turns")
                self.assertEqual([c["value"] for c in variant["choices"]], ["turns", "stays"])
                self.assertIn("verify", variant["choices"][0]["label"])
        self.assertNotIn("counterSpindleY", [v["id"] for v in source_profile("sinumerik-mill")["machineParams"]["variants"]])
        programs = {"fanuc-lathe": self.MIRROR, "sinumerik": "G18 G90 G0 X50 Y5 Z2\nG1 Z-20 Y-3 F0.2\nM30"}
        flipped = {"fanuc-lathe": "G18 G90 G0 X50. Y-5. Z-2.\nG1 Z20. Y3. F0.2\nM30", "sinumerik": "G18 G90 G0 X50 Y-5 Z-2\nG1 Z20 Y3 F0.2\nM30"}
        kept = {"fanuc-lathe": "G18 G90 G0 X50. Y5. Z-2.\nG1 Z20. Y-3. F0.2\nM30", "sinumerik": "G18 G90 G0 X50 Y5 Z-2\nG1 Z20 Y-3 F0.2\nM30"}
        for profile_id, text in programs.items():
            with self.subTest(profile=profile_id):
                context = helpers.effective_context(profile_id)
                default = run_patched("mirror", text, context, LATHE_Z[1])
                self.assertEqual(errors(default), [])
                self.assertEqual(default["text"], flipped[profile_id])
                turns = run_patched("mirror", text, with_variant(context, "counterSpindleY", "turns"), LATHE_Z[1])
                self.assertEqual(turns["text"], flipped[profile_id])
                stays = run_patched("mirror", text, with_variant(context, "counterSpindleY", "stays"), LATHE_Z[1])
                self.assertEqual(errors(stays), [])
                self.assertEqual(stays["text"], kept[profile_id])
        # The operation itself: Y, an incremental Y and J are left as written.
        op = _nc_geom.LatheZMirror(D(5), False)
        self.assertEqual(_nc_geom.transform("point", {"X": D(20), "Y": D("10.5"), "Z": D(2)}, op), ({"X": D(20), "Y": D("10.5"), "Z": D(8)}, True))
        self.assertEqual(_nc_geom.transform("centre-inc", {"Z": D(-10), "Y": D(4)}, op), ({"Z": D(10), "Y": D(4)}, True))
        self.assertEqual(_nc_geom.lathe_mirror_axes(op), ("Z",))
        self.assertEqual(_nc_geom.lathe_mirror_axes(_nc_geom.LatheZMirror(D(5))), ("Z", "Y"))

    DRILL = "G18 G97 S1000 M3\nG00 X0. Z5.\nG83 Z-20. R2. Q5000 F0.1\nG80\nM30"

    def test_nc_9_the_drilling_r_on_a_series_15_lathe_carries_a_note(self):
        self.assertEqual(source_profile("fanuc-lathe")["syntax"].get("cycleRAbsoluteWith"), ["series-15", "both"])
        base = with_syntax(helpers.effective_context("fanuc-lathe", preset="is-b"), cycleRAbsoluteWith=["series-15", "both"])
        for choice in ("series-15", "both"):
            with self.subTest(choice=choice):
                result = run_patched("translate", self.DRILL, helpers.with_pointless_feeds(base, choice), {"dz": -10})
                self.assertEqual(errors(result), [])
                self.assertIn("G83 Z-30. R2. Q5000 F0.1", result["text"])  # R as written
                notes = [(f["line"], f["severity"]) for f in result["findings"] if f["reason"] == "cycle-r-left"]
                self.assertEqual(notes, [(3, "info")])
                message = [f["message"] for f in result["findings"] if f["reason"] == "cycle-r-left"][0]
                self.assertIn("Series 15 format", message)
                self.assertIn("parameter 5102 bit 6", message)
                self.assertIn("1 drilling R point (Series 15 format)", result["message"])
        # The standard format, calculator-type input and no machine: R is incremental, no note.
        for context in (
            helpers.with_pointless_feeds(base, "standard"),
            with_syntax(helpers.effective_context("fanuc-lathe", preset="calculator"), cycleRAbsoluteWith=["series-15", "both"]),
            with_syntax(helpers.effective_context("fanuc-lathe"), cycleRAbsoluteWith=["series-15", "both"]),
        ):
            result = run_patched("translate", self.DRILL, context, {"dz": -10})
            self.assertEqual([f for f in result["findings"] if f["reason"] == "cycle-r-left"], [])
        # A shift of nothing moves no block, and adds no note either.
        result = run_patched("translate", self.DRILL, helpers.with_pointless_feeds(base, "series-15"), {"dx": 0, "dz": 0})
        self.assertEqual([f for f in result["findings"] if f["reason"] == "cycle-r-left"], [])


class LaterVersionTest(unittest.TestCase):
    """Wave Y, BL-NC-geometry: the later-version transforms in the rules. Each test fails
    without its change."""

    def refusals(self, profile_id, text, line, op):
        context, tracker, steps = walk(text, profile_id, upto=line)
        step = steps[line - 1]
        return [r.reason for r in _nc_geom.refusals_of(step, _nc_geom.roles_of(step, tracker), tracker, op, context)]

    def roles(self, profile_id, text, line):
        _, tracker, steps = walk(text, profile_id, upto=line)
        return [(r.role, r.token.text.strip()) for r in _nc_geom.roles_of(steps[line - 1], tracker)]

    def test_t018_the_polar_approach_and_departure_codes(self) -> None:
        # TNC 640 Klartext manual (2019): p.148 lists APPR PLT, PLN, PCT, PLCT and DEP PLCT as the
        # polar forms of the contour point, p.171 writes them with PR and PA about CC.
        text = "0 BEGIN PGM P MM\n1 CC X+50 Y+50\n2 LP PR+60 PA+180 R0 FMAX\n3 APPR PLCT PR+45 PA+180 R5 RL F250\n4 DEP PLCT PR+60 PA+180 R5 F1000\n5 END PGM P MM"
        self.assertEqual(
            self.roles("heidenhain-klartext", text, 4),
            [("polar-radius", "PR+45"), ("polar-angle", "PA+180"), ("radius", "R5"), ("code-comp", "RL"), ("untouched", "F250")],
        )
        for op in (TRANSLATE, ROTATE, MIRROR, _nc_geom.Rotate((D(0), D(0)), D(30))):
            with self.subTest(op=op):
                self.assertEqual(self.refusals("heidenhain-klartext", text, 4, op), [])
                self.assertEqual(self.refusals("heidenhain-klartext", text, 5, op), [])
        plt = "0 BEGIN PGM P MM\n1 CC X+50 Y+50\n2 L X+0 Y+0 R0 FMAX\n3 APPR PLT PR+45 PA+180 LEN12 RL F250\n4 END PGM P MM"
        self.assertEqual(self.roles("heidenhain-klartext", plt, 4)[2], ("length", "LEN12"))
        # Without the pole the polar contour point is not known.
        nopole = plt.replace("1 CC X+50 Y+50\n", "1 L Z+5 FMAX\n")
        self.assertIn("pole-unknown", self.refusals("heidenhain-klartext", nopole, 4, ROTATE))

    def test_t016_tangential_arcs_and_arcs_through_a_point_turn_under_the_exact_operations(self) -> None:
        cip = "G90 G17 G71\nG0 X0 Y0\nG1 X5 Y0 F100\nCIP X10 Y0 I1=5 J1=5"
        ct = "0 BEGIN PGM P MM\n1 L X+0 Y+0 R0 FMAX\n2 L X+5 Y+0 F100\n3 CT X+10 Y+10\n4 END PGM P MM"
        for op in (ROTATE, MIRROR, _nc_geom.Rotate((D(1), D(2)), D(270)), _nc_geom.Mirror((D(3), D(0)), D(0))):
            with self.subTest(op=op):
                self.assertNotIn("arc-tangential", self.refusals("sinumerik-mill", cip, 4, op))
                self.assertNotIn("arc-tangential", self.refusals("heidenhain-klartext", ct, 4, op))
        for op in (ROTATE_30, MIRROR_30, _nc_geom.Mirror((D(0), D(0)), D(45))):
            with self.subTest(op=op):
                self.assertIn("arc-tangential", self.refusals("sinumerik-mill", cip, 4, op))
        turning = "G18 G90 G71\nG0 X20 Z2\nG1 X30 Z-5 F0.2\nCT X40 Z-10"
        self.assertNotIn("arc-tangential", self.refusals("sinumerik", turning, 4, LATHE))


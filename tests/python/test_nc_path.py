"""`_nc_path.py`, the path tracker (Phase 4 plan §6.1, AD-48; P4.1).

The prelude wrote these cases as the ones P4.1 must make pass; P4.1 made them run and added
the rest. The tracker on hand-written blocks for every arc form the plan names (F111: a
centre incremental and absolute, ``R`` above and below 180°, ``CR=``, Klartext ``CC`` with
``C``, ``CR``, ``LP``, ``CP``, ``AC()``/``IC()``), each reason a position is not known, the
arc direction read from data, the events of a step in the order the extents count them, and
the one extents reading that changed (``AR=`` with no end point, plan §7 #294).

The guard of P4.1 is not here: it is ``tests/python/test_extents.py`` (every extents golden
byte for byte) and the owner-public extents run, unchanged.

The programs are synthetic, written for gEdit.
"""

from __future__ import annotations

import copy
import unittest
from decimal import Decimal

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()
import _nc_path  # noqa: E402  (the bundled folder is on sys.path from here on)
import extents  # noqa: E402

D = Decimal


def walk(text, profile_id="fanuc-gcode", codes=None, preset=None, profile=None):
    """The tracker after ``text`` and the steps of its lines, with the effective profile
    (``profile`` changes members of it for one test)."""
    context = helpers.effective_context(profile_id, preset=preset) if preset else helpers.effective_context(profile_id)
    if codes is not None:
        context["codes"] = codes
    if profile is not None:
        context["profile"] = profile(copy.deepcopy(context["profile"]))
    cp = gedit_nc.compile_profile(context["profile"])
    tracker = _nc_path.PathTracker(context, cp)
    state = None
    steps = []
    for number, line in enumerate(text.strip("\n").split("\n"), 1):
        state, step = tracker.line(line, number, state, True)
        steps.append(step)
    return tracker, steps


def kinds(step):
    return [e.kind for e in step.events if isinstance(e, _nc_path.Unknown)]


def events(step):
    """The events of a step, short: ``('reach', axis, value)`` and ``(kind, axes)``."""
    return [
        ("reach", e.axis, e.value) if isinstance(e, _nc_path.Reach) else (e.kind, e.axes)
        for e in step.events
    ]


class ExtractionTest(unittest.TestCase):
    """AD-48: the geometry lives in ``_nc_path`` only, and ``extents.py`` uses it."""

    def test_extents_keeps_no_copy_of_the_vocabulary(self) -> None:
        # The direction table retired (§6.2: the direction is data); the rest moved.
        for name in ("ARC_CODES", "DIRECTION_WORD", "CENTRE_AXIS", "RADIUS_WORDS", "POLAR_RADIUS",
                     "POLAR_ANGLE", "UNRESOLVED_ARCS", "TURNS_WORD", "VALUE_FUNCTIONS", "PLANE_AXES",
                     "PLANE_NORMAL", "CHORD_SLACK", "INCH", "COMPUTED", "Axes", "Written"):
            with self.subTest(name=name):
                self.assertFalse(hasattr(extents, name))
        self.assertFalse(hasattr(_nc_path, "ARC_CODES"))
        self.assertFalse(hasattr(_nc_path, "DIRECTION_WORD"))

    def test_extents_uses_the_helpers_and_the_tracker_of_the_module(self) -> None:
        for name in ("literal_of", "rounded"):
            with self.subTest(name=name):
                self.assertIs(getattr(extents, name), getattr(_nc_path, name))
        # CODE-12: the arc geometry is read from `_nc_path`; `extents` no longer re-exports it for a test.
        for name in ("centre_from_radius", "polar_point", "within"):
            with self.subTest(name=name):
                self.assertFalse(hasattr(extents, name))
        context = helpers.effective_context("fanuc-gcode")
        walker = extents.Extents(context, gedit_nc.compile_profile(context["profile"]))
        self.assertIsInstance(walker.tracker, _nc_path.PathTracker)
        self.assertIs(walker.axes, walker.tracker.axes)
        self.assertIs(walker.interp, walker.tracker.interp)

    def test_the_unknown_kinds_are_the_extents_finding_kinds(self) -> None:
        # `rotary` and `selection` stay the extents' own: the held rotary positions and a
        # selection without the lines above it are not questions of the path; nor is `call`
        # (Wave Y, T110), a subprogram call the extents' walk does not follow.
        own = [k for k in extents.KINDS if k not in ("rotary", "selection", "call")]
        self.assertEqual(sorted(_nc_path.UNKNOWN_KINDS), sorted(own))

    def test_the_number_helpers(self) -> None:
        # The answers `extents.py` gave before the move (they were held to its copies).
        cases = [
            ((D(0), D(0), D(10), D(0), D(5), "cw"), (D(5), D(0))),
            ((D(0), D(0), D(10), D(10), D(10), "cw"), (D(10), D(0))),
            ((D(0), D(0), D(10), D(10), D(-10), "cw"), (D(0), D(10))),
            ((D(0), D(0), D(10), D(10), D(10), "ccw"), (D(0), D(10))),
            ((D(0), D(0), D(10), D(0), D("4.999"), "cw"), (D(5), D(0))),  # inside the chord slack
            ((D(0), D(0), D(10), D(0), D(4), "cw"), None),  # no such arc
            ((D(0), D(0), D(0), D(0), D(4), "cw"), None),  # no chord
        ]
        for args, want in cases:
            with self.subTest(case=args):
                self.assertEqual(_nc_path.centre_from_radius(*args), want)
        self.assertEqual(_nc_path.polar_point(D(10), D(0)), (D(10), D(0)))
        self.assertEqual(_nc_path.polar_point(D(5), D(-270)), (D(0), D(5)))
        self.assertEqual(_nc_path.polar_point(D(2), D(30)), (D("1.732051"), D("1.000000")))
        self.assertTrue(_nc_path.within(0.0, 90.0, 45.0))
        self.assertTrue(_nc_path.within(0.0, -90.0, 315.0))
        self.assertTrue(_nc_path.within(350.0, 20.0, 0.0))
        self.assertFalse(_nc_path.within(10.0, 360.0, 10.0))  # an end point is no extreme of its own
        self.assertEqual(_nc_path.distance(D(3), D(4)), D("5.000000"))
        self.assertEqual(_nc_path.angle_of(D(-1), D(0)), 270.0)

    def test_literal_of_reads_a_value_function(self) -> None:
        cp = gedit_nc.compile_profile(helpers.load_profile("sinumerik-mill"))
        tokens, _ = gedit_nc.tokenize_line("G1 X=AC(10) Y=IC(-2.5) Z=R1", cp, None)
        words = {t.address.upper(): t for t in tokens if t.kind == "word" and t.address}
        self.assertEqual(_nc_path.literal_of(words["X"])[1], "absolute")
        self.assertEqual(_nc_path.literal_of(words["Y"])[1], "incremental")
        self.assertEqual(_nc_path.literal_of(words["Z"]), (None, None))

    def test_the_stub_error_is_gone(self) -> None:
        # CODE-12: nothing raised it since P4.1.
        self.assertFalse(hasattr(_nc_path, "PathNotImplemented"))


class ArcFormsTest(unittest.TestCase):
    """Every arc form of F111, its centre, start and end in absolute coordinates."""

    def arc_of(self, text, profile_id="fanuc-gcode", line=None):
        _, steps = walk(text, profile_id)
        step = steps[-1] if line is None else steps[line - 1]
        self.assertIsNotNone(step.arc, kinds(step))
        return step.arc

    def test_an_incremental_centre(self) -> None:
        arc = self.arc_of("G90 G17 G21\nG0 X0. Y0. Z5.\nG2 X10. Y0. I5. J0.")
        self.assertEqual((arc.direction, arc.form, arc.plane), ("cw", "centre", ("X", "Y")))
        self.assertEqual((arc.centre, arc.start, arc.end), ((D(5), D(0)), (D(0), D(0)), (D(10), D(0))))
        self.assertFalse(arc.full)

    def test_a_centre_word_left_out_is_an_offset_of_zero(self) -> None:
        arc = self.arc_of("G90 G17 G21\nG0 X0. Y0.\nG3 X10. I5.")
        self.assertEqual((arc.direction, arc.centre, arc.end), ("ccw", (D(5), D(0)), (D(10), D(0))))

    def test_an_absolute_centre_by_a_value_function(self) -> None:
        arc = self.arc_of("G90 G17 G71\nG0 X0 Y0\nG2 X10 Y0 I=AC(5) J=AC(0)", "sinumerik-mill")
        self.assertEqual(arc.centre, (D(5), D(0)))

    def test_a_radius_below_and_above_180_degrees(self) -> None:
        small = self.arc_of("G90 G17 G21\nG0 X0. Y0.\nG2 X10. Y10. R10.")
        large = self.arc_of("G90 G17 G21\nG0 X0. Y0.\nG2 X10. Y10. R-10.")
        self.assertEqual((small.form, small.centre), ("radius", (D(10), D(0))))
        self.assertEqual((large.form, large.centre), ("radius", (D(0), D(10))))

    def test_a_sinumerik_radius_word(self) -> None:
        arc = self.arc_of("G90 G17 G71\nG0 X0 Y0\nG2 X10 Y0 CR=5", "sinumerik-mill")
        self.assertEqual((arc.form, arc.centre), ("radius", (D(5), D(0))))

    def test_the_lathe_plane_and_a_diameter_column(self) -> None:
        # ZX plane: the first axis is Z; the end point's X is a diameter in the column and a
        # radius in the arc.
        tracker, steps = walk("G18 G21 G99\nG0 X20. Z0.\nG3 X40. Z-10. K-10. I0.", "fanuc-lathe")
        arc = steps[-1].arc
        self.assertEqual((arc.plane, arc.direction), (("Z", "X"), "ccw"))
        self.assertEqual((arc.start, arc.end, arc.centre), ((D(0), D(10)), (D(-10), D(20)), (D(-10), D(10))))
        self.assertEqual(tracker.pos["X"], D(40))
        self.assertEqual(tracker.geo_pos("X"), D(20))

    def test_klartext_arcs_around_the_pole(self) -> None:
        text = (
            "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CC X+5 Y+0\n3 L X+0 Y+0 R0 FMAX\n"
            "4 C X+10 Y+0 DR-\n5 CR X+0 Y+0 R+5 DR-\n6 END PGM P MM"
        )
        _, steps = walk(text, "heidenhain-klartext")
        c, cr = steps[4].arc, steps[5].arc
        self.assertEqual((c.form, c.direction, c.centre, c.end), ("pole", "cw", (D(5), D(0)), (D(10), D(0))))
        self.assertEqual((cr.form, cr.direction, cr.centre), ("radius", "cw", (D(5), D(0))))

    def test_klartext_polar_moves(self) -> None:
        text = (
            "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CC X+0 Y+0\n3 LP PR+10 PA+90 R0 FMAX\n"
            "4 LP PA+0\n5 CP PA+180 DR+\n6 LP IPA+90\n7 END PGM P MM"
        )
        tracker, steps = walk(text, "heidenhain-klartext")
        self.assertEqual((steps[3].after["X"], steps[3].after["Y"]), (D(0), D(10)))
        self.assertEqual((steps[3].polar.radius, steps[3].polar.angle, steps[3].polar.arc), (D(10), D(90), False))
        self.assertEqual((steps[4].after["X"], steps[4].after["Y"]), (D(10), D(0)))
        cp = steps[5]
        self.assertTrue(cp.polar.arc)
        self.assertEqual((cp.arc.direction, cp.arc.form, cp.arc.end), ("ccw", "polar", (D(-10), D(0))))
        self.assertEqual((steps[6].after["X"], steps[6].after["Y"]), (D(0), D(-10)))

    def test_value_functions_override_the_distance_mode(self) -> None:
        _, steps = walk("G17 G71\nG90 G0 X0 Y0\nG91 G0 X=AC(10) Y=IC(5)\nG90 G1 X=IC(2) Y=AC(1)", "sinumerik-mill")
        self.assertEqual((steps[2].after["X"], steps[2].after["Y"]), (D(10), D(5)))
        self.assertEqual((steps[3].after["X"], steps[3].after["Y"]), (D(12), D(1)))
        reads = {r.address: r for r in steps[2].reads}
        self.assertEqual((reads["X"].incremental, reads["X"].function), (False, "absolute"))
        self.assertEqual((reads["Y"].incremental, reads["Y"].function), (True, "incremental"))

    def test_a_helix_carries_its_third_axis(self) -> None:
        arc = self.arc_of("G90 G17 G21\nG0 X0. Y0. Z0.\nG3 X0. Y0. I5. J0. Z-2.")
        self.assertTrue(arc.full)
        self.assertEqual(arc.helix, {"Z": (D(0), D(-2))})

    def test_the_extremes_of_an_arc(self) -> None:
        arc = self.arc_of("G90 G17 G21\nG0 X0. Y0.\nG2 X10. Y0. I5. J0.")
        # Clockwise from (0, 0) about (5, 0): through the top of the circle only.
        self.assertEqual(_nc_path.arc_extremes(arc), [("Y", D(5))])
        self.assertEqual(_nc_path.arc_radii(arc), (D(5), D(5)))

    def test_an_absolute_centre_by_the_profile(self) -> None:
        # `arcCenterMode: 'absolute'`: I and J are the centre itself, `IC()` makes one word an
        # offset from the start again, and a centre word left out is missing, not zero.
        def absolute(profile):
            profile["addresses"]["arcCenterMode"] = "absolute"
            return profile

        _, steps = walk("G90 G17 G71\nG0 X10 Y10\nG2 X20 Y0 I10 J=IC(-10)\nG2 X10 Y10 I10", "sinumerik-mill", profile=absolute)
        arc = steps[2].arc
        self.assertEqual((arc.form, arc.centre, arc.start, arc.end), ("centre", (D(10), D(0)), (D(10), D(10)), (D(20), D(0))))
        self.assertIsNone(steps[3].arc)
        self.assertEqual(kinds(steps[3]), ["arc"])
        # The same words under the incremental convention of the shipped profile.
        _, steps = walk("G90 G17 G71\nG0 X10 Y10\nG2 X20 Y0 I=IC(0) J-10", "sinumerik-mill")
        self.assertEqual(steps[2].arc.centre, (D(10), D(0)))

    def test_the_large_and_the_small_arc_by_cr_and_r(self) -> None:
        small = self.arc_of("G90 G17 G71\nG0 X0 Y0\nG3 X10 Y10 CR=10", "sinumerik-mill")
        large = self.arc_of("G90 G17 G71\nG0 X0 Y0\nG3 X10 Y10 CR=-10", "sinumerik-mill")
        self.assertEqual((small.direction, small.centre), ("ccw", (D(0), D(10))))
        self.assertEqual((large.direction, large.centre), ("ccw", (D(10), D(0))))
        # Clockwise over 180° from (0, 0) to (10, 10) about (0, 10): through the top and the left.
        cw = self.arc_of("G90 G17 G21\nG0 X0. Y0.\nG2 X10. Y10. R-10.")
        self.assertEqual(_nc_path.arc_extremes(cw), [("Y", D(20)), ("X", D(-10))])

    def test_a_full_circle_reaches_all_four_quadrant_points(self) -> None:
        arc = self.arc_of("G90 G17 G21\nG0 X0. Y0.\nG2 I5. J0.")
        self.assertTrue(arc.full)
        self.assertEqual(_nc_path.arc_extremes(arc), [("X", D(10)), ("Y", D(5)), ("X", D(0)), ("Y", D(-5))])
        sinumerik = self.arc_of("G90 G17 G71\nG0 X0 Y0\nG2 X10 Y0 I5 J0 TURN=1", "sinumerik-mill")
        self.assertTrue(sinumerik.full)

    def test_the_klartext_pole_absolute_incremental_and_at_the_position(self) -> None:
        text = (
            "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 L X+10 Y+0 R0 FMAX\n3 CC IX+5 IY+0\n"
            "4 CP IPA+180 DR+\n5 CC\n6 LP IPR+5 PA+0\n7 CC X+0 Y+0\n8 END PGM P MM"
        )
        _, steps = walk(text, "heidenhain-klartext")
        self.assertEqual(steps[3].kind, "pole")
        self.assertEqual(steps[3].pole, {"X": D(15), "Y": D(0)})
        # `CP IPA+180` about (15, 0) from (10, 0), counter-clockwise: through the bottom.
        cp = steps[4]
        self.assertEqual((cp.arc.form, cp.arc.sweep, cp.polar.arc), ("polar", 180.0, True))
        self.assertEqual(events(cp), [("reach", "Y", D(-5)), ("reach", "X", D(20)), ("reach", "Y", D(0))])
        # `CC` alone: the pole is where the tool is; `IPR` adds to the last polar radius.
        self.assertEqual(steps[5].pole, {"X": D(20), "Y": D(0)})
        self.assertIn("polar", kinds(steps[6]))  # no polar move since the new pole
        self.assertEqual(steps[7].pole, {"X": D(0), "Y": D(0)})

    def test_an_incremental_polar_radius(self) -> None:
        text = "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CC X+0 Y+0\n3 LP PR+10 PA+0 R0 FMAX\n4 LP IPR+5\n5 END PGM P MM"
        _, steps = walk(text, "heidenhain-klartext")
        self.assertEqual((steps[4].polar.radius, steps[4].polar.angle), (D(15), D(0)))
        self.assertEqual((steps[4].after["X"], steps[4].after["Y"]), (D(15), D(0)))


class DirectionFromDataTest(unittest.TestCase):
    """The arc direction is the database's and the profile's (§6.2), not a code list."""

    def test_a_motion_code_without_the_flag_is_no_arc(self) -> None:
        codes = [dict(e) for e in helpers.resolved_codes("fanuc")]
        for e in codes:
            if e.get("code") == "G2":
                e["sets"] = {k: v for k, v in e["sets"].items() if k != "arcDirection"}
        _, steps = walk("G90 G17 G21\nG0 X0. Y0.\nG2 X10. Y0. I5. J0.", codes=codes)
        self.assertIsNone(steps[-1].arc)

    def test_a_flagged_code_of_another_name_is_an_arc(self) -> None:
        codes = [dict(e) for e in helpers.resolved_codes("fanuc")]
        codes.append({"code": "G202", "group": "motion", "modal": True, "label": "Arc",
                      "sets": {"motion": "feed", "path": "arc", "arcDirection": "ccw"}})
        _, steps = walk("G90 G17 G21\nG0 X0. Y0.\nG202 X10. Y0. I5. J0.", codes=codes)
        self.assertEqual(steps[-1].arc.direction, "ccw")

    def test_the_klartext_direction_word_comes_from_the_profile(self) -> None:
        tracker, _ = walk("0 BEGIN PGM P MM\n1 END PGM P MM", "heidenhain-klartext")
        self.assertEqual(tracker.axes.direction_words, {"DR+": "ccw", "DR-": "cw"})
        tracker, _ = walk("G90", "fanuc-gcode")
        self.assertEqual(tracker.axes.direction_words, {})

    def test_a_direction_word_is_the_address_and_its_sign_alone(self) -> None:
        text = "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CC X+5 Y+0\n3 L X+0 Y+0 R0 FMAX\n4 C X+10 Y+0 DR-1\n5 C X+0 Y+0 DR+\n6 END PGM P MM"
        _, steps = walk(text, "heidenhain-klartext")
        self.assertIsNone(steps[4].arc)
        self.assertEqual(steps[5].arc.direction, "ccw")

    def test_g2_and_g3_read_from_the_flags_on_every_database(self) -> None:
        for profile_id in ("fanuc-gcode", "fanuc-lathe", "sinumerik", "sinumerik-mill"):
            plane = "G18" if profile_id in ("fanuc-lathe", "sinumerik") else "G17"
            first, centre = ("Z", "K") if plane == "G18" else ("X", "I")
            with self.subTest(profile=profile_id):
                text = "G90 %s\nG0 X10. Y10. Z10.\nG2 %s20. %s5.\nG3 %s10. %s-5." % (plane, first, centre, first, centre)
                _, steps = walk(text, profile_id)
                self.assertEqual((steps[2].arc.direction, steps[3].arc.direction), ("cw", "ccw"))
        # The Okuma database says the same; its `G102`/`G103` carry no direction (§7 #297).
        tracker, _ = walk("G90", "okuma-osp", preset="okuma-1mm")
        found = {code: gedit_nc.arc_direction_of(tracker.interp.entry(code)) for code in ("G2", "G3", "G102", "G103")}
        self.assertEqual(found, {"G2": "cw", "G3": "ccw", "G102": None, "G103": None})


class UnknownPositionTest(unittest.TestCase):
    """Each reason a position is not known (``_nc_path.UNKNOWN_KINDS``)."""

    def test_each_reason(self) -> None:
        cases = [
            ("fanuc-gcode", "G17 G21\nG0 X0. Y0.", 2, "distance-unknown"),
            ("fanuc-gcode", "G90 G17 G21\nG1 X#1 F100.", 2, "expression"),
            ("fanuc-gcode", "G90 G17 G21\nG0 X1000", 2, "machine-dependent"),
            ("fanuc-gcode", "G91 G17 G21\nG0 X5.", 2, "incremental-start"),
            ("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG68 X0. Y0. R30.\nG1 X10.", 4, "frame"),
            ("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG123 X5.", 3, "unknown-code"),
            ("sinumerik-mill", "G90 G17 G71\nG0 X0 Y0\nCIP X10 Y0 I1=5 J1=5", 3, "arc"),
            ("heidenhain-klartext", "0 BEGIN PGM P MM\n1 L X+0 Y+0 R0 FMAX\n2 LP PR+10 PA+0\n3 END PGM P MM", 3, "polar"),
            ("fanuc-lathe", "G18 G21\nG0 X40. Z2.\nG71 U2. R0.5\nG71 P10 Q20 U0.4 W0.1 F0.3", 4, "multi-pass"),
            # A cycle written as a call: its depth is a parameter, not an axis word.
            ("sinumerik-mill", "G90 G17 G71\nG0 X0 Y0 Z10\nCYCLE81(10,0,2,-5)", 3, "cycle"),
            # The axis words of a cycle call are the cycle's positions, not the tool's.
            ("heidenhain-klartext", "0 BEGIN PGM P MM\n1 TOOL CALL 1 Z S3000\n2 CYCL DEF 200 DRILLING ~\n  Q200=2 ~\n  Q201=-10\n3 CYCL CALL POS X+30 Y+10 Z+0 FMAX\n4 END PGM P MM", 6, "cycle-position"),
            # A data block's information row names no axis.
            ("fanuc-gcode", "G90 G17 G21\nG0 X10. Y0.\nG92 X500. Y500.", 3, "data"),
        ]
        for profile_id, text, line, kind in cases:
            with self.subTest(kind=kind):
                _, steps = walk(text, profile_id)
                self.assertIn(kind, kinds(steps[line - 1]))
        # With `called-program` and `diameter-unknown` below, every reason has its case.
        self.assertEqual(sorted({c[3] for c in cases} | {"called-program", "diameter-unknown"}), sorted(_nc_path.UNKNOWN_KINDS))

    def test_a_diameter_word_before_the_distance_mode_is_known(self) -> None:
        # `DIAM90` makes X a diameter under G90 and a radius under G91: with no distance mode
        # at power-on, the reading of X is not known.
        def no_distance(profile):
            profile["modal"]["initial"].pop("distance", None)
            return profile

        _, steps = walk("G18 G71\nDIAM90\nG0 X40 Z2", "sinumerik", profile=no_distance)
        self.assertEqual(kinds(steps[2]), ["diameter-unknown", "distance-unknown"])
        reads = {r.address: r for r in steps[2].reads}
        self.assertEqual((reads["X"].value, reads["X"].unknown), (None, "diameter-unknown"))
        self.assertIsNone(steps[2].after["X"])
        # The shipped profile powers on in G90: a diameter.
        _, steps = walk("G18 G71\nDIAM90\nG0 X40 Z2", "sinumerik")
        self.assertEqual((steps[2].after["X"], steps[2].reads[0].reading), (D(40), "diameter"))

    def test_each_word_says_why_it_has_no_value(self) -> None:
        cases = [
            ("fanuc-gcode", "G17 G21\nG0 X0.", 2, "distance-unknown"),
            ("fanuc-gcode", "G90 G17 G21\nG1 X#1 F100.", 2, "expression"),
            ("fanuc-gcode", "G90 G17 G21\nG0 X1000", 2, "machine-dependent"),
            ("fanuc-gcode", "G91 G17 G21\nG0 X5.", 2, "incremental-start"),
            ("fanuc-gcode", "O1\nG90 G17 G21\nG0 X0.\nM30\nO2\nG91 G1 X5. F100.", 6, "called-program"),
            ("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG68 X0. Y0. R30.\nG1 X10.", 4, "frame"),
            ("fanuc-gcode", "G90 G17 G21\nG0 X0. Y0.\nG123 X5.", 3, "unknown-code"),
        ]
        for profile_id, text, line, kind in cases:
            with self.subTest(kind=kind):
                _, steps = walk(text, profile_id)
                read = next(r for r in steps[line - 1].reads if r.address == "X")
                self.assertEqual((read.value, read.unknown), (None, kind))

    def test_a_machine_position_and_a_data_block_forget_what_they_move(self) -> None:
        _, steps = walk("G90 G17 G21\nG0 X10. Y5.\nG53 X-400.\nG92 Y500.")
        self.assertEqual((steps[2].kind, steps[2].after["X"], steps[2].after["Y"]), ("machine", None, D(5)))
        self.assertEqual(steps[2].events, [])  # the extents list it in rows of their own
        self.assertEqual((steps[3].kind, steps[3].after["Y"]), ("data", None))
        self.assertEqual(events(steps[3]), [("data", ())])

    def test_a_program_after_the_first_starts_where_its_caller_left_the_tool(self) -> None:
        tracker, steps = walk("O1\nG90 G17 G21\nG0 X0. Y0.\nM30\nO2\nG91 G1 X5. F100.")
        self.assertIn("called-program", kinds(steps[-1]))
        self.assertIsNone(steps[-1].after["X"])

    def test_an_unknown_axis_stays_unknown_until_written_absolutely(self) -> None:
        _, steps = walk("G90 G17 G21\nG1 X#1 Y0. F100.\nG91 X5.\nG90 X2.")
        self.assertIsNone(steps[1].after["X"])
        self.assertIsNone(steps[2].after["X"])
        self.assertEqual(steps[3].after["X"], D(2))


class StepTest(unittest.TestCase):
    """Contract items 1–3: what a step holds, and its events in the order the extents count them."""

    def test_the_events_of_a_block_in_order(self) -> None:
        # The word that was not resolved, then the arc, then the end points.
        _, steps = walk("G90 G17 G21\nG0 X0. Y0.\nG2 X#1 Y10. I5.")
        self.assertEqual(events(steps[2]), [("expression", ("X",)), ("arc", ("X", "Y")), ("reach", "Y", D(10))])
        # The extremes of an arc come before its end points.
        _, steps = walk("G90 G17 G21\nG0 X0. Y0.\nG2 X10. Y0. I5. J0.")
        self.assertEqual(events(steps[2]), [("reach", "Y", D(5)), ("reach", "X", D(10)), ("reach", "Y", D(0))])
        # What a cycle leaves unknown comes last.
        _, steps = walk("G90 G17 G71\nG0 X0 Y0 Z10\nMCALL CYCLE81(10,0,2,-5)\nX20 Y0", "sinumerik-mill")
        self.assertEqual([e[0] for e in events(steps[3])], ["reach", "reach", "cycle"])

    def test_before_and_after(self) -> None:
        _, steps = walk("G90 G17 G21\nG0 X0. Y0. Z5.\nG1 X10. F100.")
        self.assertEqual(steps[2].before, steps[1].after)
        self.assertEqual((steps[2].before["X"], steps[2].after["X"], steps[2].after["Z"]), (D(0), D(10), D(5)))
        self.assertEqual((steps[2].kind, steps[0].kind), ("move", "none"))
        self.assertEqual(steps[2].units, "mm")

    def test_a_lathe_twin_is_an_increment_of_its_axis(self) -> None:
        _, steps = walk("G18 G21\nG0 X40. Z2.\nG1 U2. W-1. F0.2", "fanuc-lathe")
        reads = {r.address: r for r in steps[2].reads}
        self.assertEqual((reads["U"].axis, reads["U"].incremental, reads["U"].value), ("X", True, D(42)))
        self.assertEqual((reads["W"].axis, reads["W"].incremental, reads["W"].value), ("Z", True, D(1)))
        self.assertEqual((reads["U"].reading, steps[2].after["X"]), ("diameter", D(42)))

    def test_priming_lines_move_the_path_and_fix_no_units(self) -> None:
        context = helpers.effective_context("fanuc-gcode")
        tracker = _nc_path.PathTracker(context, gedit_nc.compile_profile(context["profile"]))
        state, _ = tracker.line("G90 G20", 1, None, False)
        state, step = tracker.line("G0 X1.", 2, state, False)
        self.assertEqual((tracker.pos["X"], tracker.report_units), (D(1), None))
        state, step = tracker.line("G21 G0 X10.", 3, state, True)
        self.assertEqual((tracker.report_units, tracker.units_switched, step.after["X"]), ("mm", False, D(10)))
        state, step = tracker.line("G20 G0 X1.", 4, state, True)
        self.assertEqual((tracker.units_switched, step.after["X"]), (True, D("25.4")))

    def test_forget_all(self) -> None:
        tracker, _ = walk("G90 G17 G21\nG0 X0. Y0.")
        tracker.forget_all()
        self.assertEqual(set(tracker.pos.values()), {None})
        self.assertIsNone(tracker.geo_pos("X"))
        # The next line starts from what was forgotten, not from the line before it.
        _, step = tracker.line("M8", 3, None, True)
        self.assertEqual((step.before["X"], step.after["X"]), (None, None))

    def test_a_line_that_writes_nothing_keeps_the_positions(self) -> None:
        _, steps = walk("G90 G17 G21\nG0 X1. Y2.\n(A COMMENT)\n\nG1 X3. F100.")
        self.assertEqual([s.kind for s in steps[2:4]], ["none", "none"])
        self.assertEqual(steps[3].after, {**steps[1].after})
        self.assertEqual((steps[4].before["X"], steps[4].after["X"], steps[3].after["X"]), (D(1), D(3), D(1)))


class OpeningAngleTest(unittest.TestCase):
    """Plan §7 #294: an arc by its centre and its opening angle, with no end point."""

    def test_its_end_is_not_known_and_it_is_no_full_circle(self) -> None:
        tracker, steps = walk("G90 G17 G71\nG0 X67.5 Y80.211\nG3 I-17.5 J-30.211 AR=140.134 F500", "sinumerik-mill")
        step = steps[-1]
        self.assertIsNone(step.arc)
        self.assertIn("arc", kinds(step))
        self.assertIsNone(step.after["X"])
        self.assertIsNone(step.after["Y"])
        # The next incremental move starts from a position that is not known.
        _, steps = walk("G90 G17 G71\nG0 X67.5 Y80.211\nG3 I-17.5 J-30.211 AR=140.134 F500\nG91 G1 X5", "sinumerik-mill")
        self.assertIn("incremental-start", kinds(steps[-1]))

    def test_an_arc_by_its_end_point_and_its_angle_keeps_its_end(self) -> None:
        _, steps = walk("G90 G17 G71\nG0 X0 Y0\nG2 X10 Y0 AR=180", "sinumerik-mill")
        step = steps[-1]
        self.assertIsNone(step.arc)
        self.assertEqual(events(step), [("arc", ("X", "Y")), ("reach", "X", D(10)), ("reach", "Y", D(0))])
        self.assertEqual(step.after["X"], D(10))

    def test_the_extents_no_longer_report_the_whole_circle(self) -> None:
        context = helpers.effective_context("sinumerik-mill")
        program = "G90 G17 G71\nG0 X67.5 Y80.211 Z0\nG3 I-17.5 J-30.211 AR=140.134 F500\nM30\n"
        report = helpers.run_script("extents.py", stdin=program, context=context).json()
        x = next(r for r in report["rows"] if r["axisId"] == "X" and r["scope"] == "program")
        # Before P4.1: X 15.0865 to 84.9135, the whole circle. Now the arc is not resolved.
        self.assertNotEqual((x["min"], x["max"]), ("15.0865", "84.9135"))
        self.assertGreaterEqual(x["unresolved"], 1)


if __name__ == "__main__":
    unittest.main()


class FlowTest(unittest.TestCase):
    """P4a fix B1 (NC-5, NC-9, NC-11; plan §7 #312, #313, #315): what the straight walk does
    not see, kept beside the positions (which stay those of the straight walk, AD-48)."""

    def test_a_jump_target_compares_both_ways_in(self) -> None:
        text = "G90 G17 G21\nG0 X10. Y10. Z5.\nGOTO 100\nG0 X50. Y10.\nN100 G1 X20. F100.\nM30"
        _, steps = walk(text, preset="is-b")
        self.assertEqual(steps[4].before["X"], D(50))  # the straight walk, unchanged
        self.assertEqual(steps[4].unsure, frozenset({"X"}))  # Y is 10 both ways
        self.assertEqual(steps[5].unsure, frozenset())  # N100 wrote X
        self.assertEqual(steps[4].flow, ())

    def test_a_target_reached_with_another_distance_mode_says_so(self) -> None:
        text = "G90 G17 G21\nG0 X10. Y10. Z5.\nGOTO 100\nG91\nN100 G1 X5. F100.\nM30"
        _, steps = walk(text, preset="is-b")
        self.assertEqual([(e.kind, e.line) for e in steps[4].flow], [("modal", 3)])

    def test_a_loop_end_reports_the_blocks_that_run_again(self) -> None:
        text = "G90 G17 G71\nG0 X10 Y10 Z5\nWHILE R1<2\nG91 G1 X5 F100\nG90\nENDWHILE\nG1 Y20"
        _, steps = walk(text, "sinumerik-mill")
        self.assertEqual([(e.kind, e.line, e.axes) for e in steps[5].flow], [("reentry", 4, ("X",))])
        self.assertEqual(steps[6].unsure, frozenset({"X"}))

    def test_a_backward_jump_to_a_block_number_runs_everything_from_it_again(self) -> None:
        text = "G90 G17 G21\nN10 G0 X10. Y10. Z5.\nG91 G1 X5. F100.\nG90\nIF[#1LT5]GOTO10\nG1 Y20."
        _, steps = walk(text, preset="is-b")
        kinds_and_lines = [(e.kind, e.line) for e in steps[4].flow]
        self.assertIn(("reentry", 2), kinds_and_lines)
        self.assertTrue({"X", "Y"} <= steps[5].unsure)

    def test_a_computed_jump_cannot_be_followed(self) -> None:
        _, steps = walk("G90 G17 G21\nG0 X10. Y10.\nGOTO#1\nM30", preset="is-b")
        self.assertEqual([e.kind for e in steps[2].flow], ["target"])

    def test_a_block_that_may_be_skipped_leaves_its_axes_unsure(self) -> None:
        _, steps = walk("G90 G17 G21\nG0 X10. Y10. Z5.\n/G0 Y50.\nG1 X20. F100.\nG1 Y5.", preset="is-b")
        self.assertEqual(steps[3].unsure, frozenset({"Y"}))
        self.assertEqual(steps[4].unsure, frozenset({"Y"}))
        self.assertEqual(steps[4].after["Y"], D(5))

    def test_the_axes_never_written(self) -> None:
        _, steps = walk("G90 G17 G21\nG0 X0. Z5.\nG1 Z-1. F100.\nG0 Y10.\nG28 Z0.\nG1 X5.", preset="is-b")
        self.assertIn("Y", steps[2].unwritten)
        self.assertNotIn("Y", steps[4].unwritten)
        self.assertIn("Z", steps[5].unwritten)  # a move to a machine position
        # An increment from a start nobody knows leaves the axis unwritten.
        _, steps = walk("G90 G17 G21\nG0 Z5.\nG91 G1 X10. F100.\nG90 X20.", preset="is-b")
        self.assertIn("X", steps[3].unwritten)

    def test_a_code_that_turns_the_rotary_axes(self) -> None:
        text = "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nL B+0 C+0 R0 FMAX\nPLANE SPATIAL SPA+0 SPB+45 SPC+0 TURN MB MAX FMAX\nPLANE RESET STAY\nL X+10 Y+10 Z+5 R0 FMAX\nL B+0 C+0 R0 FMAX\nL X+20"
        _, steps = walk(text, "heidenhain-klartext")
        self.assertTrue({"B", "C"} <= steps[5].unsure)
        self.assertEqual(steps[5].before["B"], D(0))  # what the program last wrote, unchanged
        self.assertEqual(steps[7].unsure, frozenset())  # written back; A was never written

    def test_the_line_that_set_the_pole(self) -> None:
        _, steps = walk("BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nL X+0 Y+0 R0 FMAX\nCC X+50 Y+50\nLP PR+10 PA+30", "heidenhain-klartext")
        self.assertEqual([s.pole_line for s in steps], [0, 0, 0, 4, 4])

    def test_the_extents_do_not_see_any_of_it(self) -> None:
        # The flow reading adds members to a step and changes none of the old ones.
        text = "G90 G17 G21\nG0 X10. Y10. Z5.\nGOTO 100\nG0 X50. Y50.\nN100 G1 X20. F100.\n/G0 Y5.\nM30"
        _, steps = walk(text, preset="is-b")
        self.assertEqual([s.after.get("X") for s in steps], [None, D(10), D(10), D(50), D(20), D(20), D(20)])


class V12FixTest(unittest.TestCase):
    """v1.2.0 NC fix round, batch NCF-B: one regression test per triage row, each failing
    without its fix."""

    KLARTEXT = "BEGIN PGM P MM\nTOOL CALL 1 Z S5000\nL B+0 C+0 R0 FMAX\n%s\nL X+10 Y+10 Z+5 R0 FMAX\nL X+20"

    # -- T010: angles at zero turn no rotary axis ----------------------------------------------

    def test_t010_a_plane_at_zero_angles_turns_no_rotary_axis(self) -> None:
        for plane in (
            "PLANE SPATIAL SPA+0 SPB+0 SPC+0 TURN MB MAX FMAX",
            "PLANE SPATIAL SPA+0 SPB-0.000 SPC+0 MOVE DIST50 F2000",
            "PLANE PROJECTED PROPR+0 PROMIN+0 ROT+0 TURN FMAX",
            "PLANE EULER EULPR+0 EULNU+0 EULROT+0 TURN FMAX",
            "PLANE RESET TURN FMAX",
            "PLANE SPATIAL SPA+0 SPB+0 SPC+0 ~\n  TURN MB MAX FMAX",
        ):
            with self.subTest(plane=plane):
                _, steps = walk(self.KLARTEXT % plane, "heidenhain-klartext")
                self.assertEqual(steps[-2].unsure, frozenset())
                self.assertEqual(steps[-2].before["B"], D(0))

    def test_t010_angles_not_at_zero_still_turn_them_and_stay_never_does(self) -> None:
        for plane, turned in (
            ("PLANE SPATIAL SPA+0 SPB+45 SPC+0 TURN MB MAX FMAX", True),
            ("PLANE SPATIAL SPA+0 SPB+Q5 SPC+0 TURN MB MAX FMAX", True),  # not a plain 0
            ("PLANE SPATIAL SPA+0 SPB+30 SPC+0 ~\n  MOVE DIST50 F2000", True),
            ("PLANE VECTOR BX1 BY0 BZ0 NX0 NY0 NZ1 TURN FMAX", True),  # no angles to read
            ("PLANE SPATIAL SPA+0 SPB+45 SPC+0 STAY", False),
        ):
            with self.subTest(plane=plane):
                _, steps = walk(self.KLARTEXT % plane, "heidenhain-klartext")
                self.assertEqual({"B", "C"} <= steps[-2].unsure, turned)
        # A zero plane after a real tilt does not make the turned axes known again.
        text = self.KLARTEXT % "PLANE SPATIAL SPA+0 SPB+45 SPC+0 TURN MB MAX FMAX\nPLANE SPATIAL SPA+0 SPB+0 SPC+0 TURN MB MAX FMAX"
        _, steps = walk(text, "heidenhain-klartext")
        self.assertTrue({"B", "C"} <= steps[-2].unsure)

    # -- T111: a single-pass lathe cycle goes back to its start ---------------------------------

    def test_t111_a_single_pass_cycle_ends_where_it_started(self) -> None:
        text = "G21 G40 G99\nG0 X50. Z2.\nG90 X40. Z-30. F0.2\nX36.\nG0 X100. Z50.\nM30"
        _, steps = walk(text, "fanuc-lathe")
        self.assertEqual((steps[2].after["X"], steps[2].after["Z"]), (D(50), D(2)))
        self.assertEqual((steps[3].after["X"], steps[3].after["Z"]), (D(50), D(2)))
        reached = [(e.axis, e.value) for e in steps[2].events if isinstance(e, _nc_path.Reach)]
        self.assertEqual(reached, [("X", D(40)), ("Z", D(-30))])  # the end point is still reached
        # An increment of the next pass counts from the start point (G94: W from Z2).
        _, steps = walk("G21 G40 G99\nG0 X50. Z2.\nG94 X10. Z-1. F0.2\nW-3.\nG0 W5.\nM30", "fanuc-lathe")
        self.assertEqual([e.value for e in steps[3].events if isinstance(e, _nc_path.Reach)], [D(-1)])
        self.assertEqual(steps[4].after["Z"], D(7))
        # System B writes them G77/G79.
        context = helpers.effective_context("fanuc-lathe", variant=("gcodeSystem", "B"))
        cp = gedit_nc.compile_profile(context["profile"])
        tracker = _nc_path.PathTracker(context, cp)
        state = None
        after = []
        for number, line in enumerate("G21 G40 G90 G95\nG0 X50. Z2.\nG77 X40. Z-30. F0.2\nG79 X10. Z-1.\nM30".split("\n"), 1):
            state, step = tracker.line(line, number, state, True)
            after.append((step.after["X"], step.after["Z"]))
        self.assertEqual(after[2:4], [(D(50), D(2)), (D(50), D(2))])

    def test_ncfc_the_threading_passes_end_where_they_started(self) -> None:
        # v1.2.0 (NCF-C): G92 (system A) and G78 (system B) are whole passes too (`path: 'cycle'`).
        _, steps = walk("G21 G40 G99\nG0 X44. Z6.\nG92 X39.2 Z-20. F1.5\nX38.6\nG0 U2.\nM30", "fanuc-lathe")
        self.assertEqual([(s.after["X"], s.after["Z"]) for s in steps[2:5]], [(D(44), D(6)), (D(44), D(6)), (D(46), D(6))])
        reached = [(e.axis, e.value) for e in steps[2].events if isinstance(e, _nc_path.Reach)]
        self.assertEqual(reached, [("X", D("39.2")), ("Z", D(-20))])
        context = helpers.effective_context("fanuc-lathe", variant=("gcodeSystem", "B"))
        tracker = _nc_path.PathTracker(context, gedit_nc.compile_profile(context["profile"]))
        state = None
        after = []
        for number, line in enumerate("G21 G40 G90 G95\nG0 X44. Z6.\nG78 X39.2 Z-20. F1.5\nX38.6\nM30".split("\n"), 1):
            state, step = tracker.line(line, number, state, True)
            after.append((step.after["X"], step.after["Z"]))
        self.assertEqual(after[2:4], [(D(44), D(6)), (D(44), D(6))])

    def test_ncfc_a_taper_pass_reaches_its_taper_start(self) -> None:
        # The first move of a taper pass ends at the end coordinate plus R (a radius) along the
        # axis R lies along (`lengthAlong`): X for G90/G92 (twice R in the diameter column), Z
        # for G94. Reached after the end point; the tool still ends at the start point.
        _, steps = walk("G21 G40 G99\nG0 X62. Z2.\nG90 X56. Z-30. R-4. F0.25\nR-6.\nM30", "fanuc-lathe")
        self.assertEqual([(e.axis, e.value) for e in steps[2].events if isinstance(e, _nc_path.Reach)], [("X", D(56)), ("Z", D(-30)), ("X", D(48))])
        self.assertEqual([(e.axis, e.value) for e in steps[3].events if isinstance(e, _nc_path.Reach)], [("X", D(44))])
        self.assertEqual((steps[3].after["X"], steps[3].after["Z"]), (D(62), D(2)))
        _, steps = walk("G21 G40 G99\nG0 X64. Z3.\nG94 X20. Z-1. R-5. F0.2\nM30", "fanuc-lathe")
        self.assertEqual([(e.axis, e.value) for e in steps[2].events if isinstance(e, _nc_path.Reach)], [("X", D(20)), ("Z", D(-1)), ("Z", D(-6))])

    def test_t111_any_other_feed_move_ends_at_its_end_point(self) -> None:
        _, steps = walk("G21 G40 G99\nG0 X50. Z2.\nG1 X40. Z-30. F0.2\nG32 X40. Z-50. F1.5\nM30", "fanuc-lathe")
        self.assertEqual((steps[2].after["X"], steps[2].after["Z"]), (D(40), D(-30)))
        self.assertEqual(steps[3].after["Z"], D(-50))

    # -- T011 (NC-18): the level a drilling cycle leaves the tool axis at -----------------------

    def test_t011_a_cycle_leaves_z_at_a_level_the_program_wrote(self) -> None:
        text = "G90 G17 G21\nG0 X0. Y0. Z50.\nG98 G81 X10. Y10. Z-5. R2. F100.\nX20.\nG80\nG91 G99 G81 X10. Y10. Z-5. R-48.\nG80\nG0 Z10.\nG90 G0 Z50.\nM30"
        _, steps = walk(text)
        self.assertEqual(steps[2].levels, frozenset())
        self.assertIsNone(steps[3].before["Z"])
        self.assertEqual([s.levels for s in steps[3:8]], [frozenset({"Z"})] * 5)  # an increment from it too
        self.assertEqual(steps[8].levels, frozenset({"Z"}))
        self.assertEqual(steps[9].levels, frozenset())  # written absolutely: known again

    def test_t011_a_cycle_started_from_a_level_nobody_knows_leaves_none(self) -> None:
        for above in ("G0 X0. Y0.", "G0 X0. Y0. Z50.\nG28 G91 Z0.\nG90"):
            with self.subTest(above=above):
                _, steps = walk("G90 G17 G21\n%s\nG98 G81 X10. Y10. Z-5. R2. F100.\nG80\nM30" % above)
                self.assertEqual(steps[-1].levels, frozenset())

    def test_t011_where_two_ways_meet_the_level_must_hold_on_both(self) -> None:
        text = "G90 G17 G21\nG0 X0. Y0. Z50.\nGOTO 100\nG98 G81 X10. Y10. Z-5. R2. F100.\nG80\nN100 G0 X5.\nM30"
        _, steps = walk(text, preset="is-b")
        self.assertEqual(steps[4].levels, frozenset({"Z"}))
        self.assertEqual(steps[5].levels, frozenset({"Z"}))  # the jump comes with Z at 50: known, so the level holds
        text = "G90 G17 G21\nG0 X0. Y0. Z50.\nG28 G91 Z0.\nG90\nGOTO 100\nG0 Z50.\nG98 G81 X10. Y10. Z-5. R2. F100.\nG80\nN100 G0 X5.\nM30"
        _, steps = walk(text, preset="is-b")
        self.assertEqual(steps[7].levels, frozenset({"Z"}))
        self.assertEqual(steps[8].levels, frozenset())  # the jump comes from a machine position


class FuzzFixTest(unittest.TestCase):
    """v1.2.0, the fuzz review (FZ-4): a drilling cycle written as a word is no arc."""

    def test_fz4_a_drilling_cycle_after_an_arc_is_no_arc(self) -> None:
        text = "G21 G17 G90\nG0 X0. Y0. Z10.\nG3 X20. Y0. I10. J0. F100.\nG81 X20. Y10. Z-5. R5. F100.\nX30. Y5.\nG80\nM30"
        _, steps = walk(text)
        self.assertIsNotNone(steps[2].arc)
        self.assertEqual([steps[3].arc, steps[4].arc], [None, None])
        self.assertEqual([e for e in steps[3].events if isinstance(e, _nc_path.Unknown) and e.kind == "arc"], [])
        self.assertEqual((steps[3].after["X"], steps[3].after["Y"]), (D(20), D(10)))
        # After G80 the motion code in force is an arc again.
        _, steps = walk("G21 G17 G90\nG0 X0. Y0. Z10.\nG3 X20. Y0. I10. J0. F100.\nG81 X20. Y10. Z-5. R5. F100.\nG80\nG3 X40. Y10. I10. J0.\nM30")
        self.assertIsNotNone(steps[5].arc)

    def test_fz4_a_cycle_called_with_its_arguments_still_runs_after_an_arc(self) -> None:
        # Sinumerik MCALL: the positioning block is an ordinary move, an arc too.
        _, steps = walk("G71 G17 G90\nG0 X0 Y0 Z10\nMCALL CYCLE81(10,0,2,-5)\nG2 X20 Y0 I10 J0 F100\nMCALL\nM30", "sinumerik-mill")
        self.assertIsNotNone(steps[3].arc)


class D2FixTest(unittest.TestCase):
    """v1.2.0 NC fix round, batch D2 (path and geometry): the tracker's part of NCR-2, NCR-9 and
    NCR-10. Each test fails without its fix."""

    def walk_b(self, text):
        context = helpers.effective_context("fanuc-lathe", variant=("gcodeSystem", "B"))
        tracker = _nc_path.PathTracker(context, gedit_nc.compile_profile(context["profile"]))
        state = None
        for number, line in enumerate(text.split("\n"), 1):
            state, _ = tracker.line(line, number, state, True)
        return tracker

    # -- NCR-2: the taper the passes share, and when it is not known ------------------------------

    def test_ncr2_the_taper_in_force_and_what_clears_it(self) -> None:
        tracker, _ = walk("G18 G21\nG0 X60. Z2.\nG94 X20. Z-5. R-1. F0.2\nG0 X60. Z2.", "fanuc-lathe")
        self.assertEqual(tracker.pass_taper("R")[0], D(-1))  # a G00 does not clear it
        tracker, _ = walk("G18 G21\nG0 X60. Z2.\nG94 X20. Z-5. R-1. F0.2\nG04 X1.\nG0 X60. Z2.", "fanuc-lathe")
        self.assertEqual(tracker.pass_taper("R")[0], D(-1))  # nor does a dwell
        tracker, _ = walk("G18 G21\nG0 X60. Z2.\nG94 X20. Z-5. R-1. F0.2\nG18\nG0 X60. Z2.", "fanuc-lathe")
        self.assertIsNone(tracker.pass_taper("R"))  # a plane code does
        tracker, _ = walk("G18 G21\nG0 X60. Z2.\nG94 X20. Z-5. R0. F0.2", "fanuc-lathe")
        self.assertEqual(tracker.pass_taper("R")[0], D(0))

    def test_ncr2_forget_all_and_a_subprogram_call_leave_the_taper_not_known(self) -> None:
        for between in ("M98 P100", "G65 P9010 A1.", "M30\nO2"):
            with self.subTest(between=between):
                tracker, _ = walk("O1\nG18 G21\nG0 X60. Z2.\nG94 X20. Z-5. F0.2\n%s\nG0 X60. Z2." % between, "fanuc-lathe")
                found = tracker.pass_taper("R")
                self.assertIsNotNone(found)  # not "no taper"
                self.assertIsNone(found[0])
                self.assertEqual(found[2], "unknown")
        # A block that writes the taper makes it known again; a one-shot code clears it.
        tracker, _ = walk("G18 G21\nM98 P100\nG0 X60. Z2.\nG94 X20. Z-5. R-2. F0.2", "fanuc-lathe")
        self.assertEqual(tracker.pass_taper("R")[0], D(-2))
        tracker, _ = walk("G18 G21\nM98 P100\nG50 S2000\nG0 X60. Z2.", "fanuc-lathe")
        self.assertIsNone(tracker.pass_taper("R"))
        # System B: the same in G79.
        tracker = self.walk_b("G18 G21 G90\nG0 X60. Z2.\nG79 X20. Z-5. R-1. F0.2\nG0 X60. Z2.")
        self.assertEqual(tracker.pass_taper("R")[0], D(-1))

    def test_ncr2_a_pass_after_a_call_has_no_known_taper_start(self) -> None:
        # The extents: the taper start of a G90 after M98 is not known (the subprogram may have
        # written R), so X is not resolved there; the end point is still reached.
        _, steps = walk("G18 G21\nG0 X62. Z2.\nM98 P100\nG0 X62. Z2.\nG90 X56. Z-30. F0.25\nM30", "fanuc-lathe")
        self.assertEqual(events(steps[4]), [("reach", "X", D(56)), ("reach", "Z", D(-30)), ("cycle", ("X",))])
        _, steps = walk("G18 G21\nG0 X62. Z2.\nG90 X56. Z-30. F0.25\nM30", "fanuc-lathe")
        self.assertEqual(events(steps[2]), [("reach", "X", D(56)), ("reach", "Z", D(-30))])

    # -- NCR-10: a tool offset write keeps the positions -----------------------------------------

    def test_ncr10_a_tool_offset_write_keeps_the_positions(self) -> None:
        text = "G90 G17 G21\nG0 X0. Y0. Z50.\n%s\nG91 G1 X10. F100"
        _, steps = walk(text % "G10 L11 P1 R0.1")
        self.assertEqual(steps[3].before["X"], D(0))
        self.assertEqual(steps[3].after["X"], D(10))
        for setting in ("G10 L2 P1 X10. Y0 Z0", "G10 L20 P1 X10.", "G10 L3 P1 R0.1", "G10 L50", "G10 P1 R0.1", "G10 L#1 P1 R0.1"):
            with self.subTest(setting=setting):
                _, steps = walk(text % setting)
                self.assertIsNone(steps[3].before["X"])
        # The lathe G10 has no L: it still clears them.
        _, steps = walk("G18 G21\nG0 X50. Z2.\nG10 P1 X0.2 Z0.1\nG1 W-5. F0.2", "fanuc-lathe")
        self.assertIsNone(steps[3].before["Z"])

    def test_ncr10_the_two_modules_ask_the_same_predicate(self) -> None:
        import _nc_geom

        tracker, steps = walk("G90 G17 G21\nG10 L11 P1 R0.1")
        block = _nc_geom._block_of(steps[1], tracker)
        entry = block.entries[0]
        self.assertTrue(_nc_geom._writes_tool_offset(block, entry))
        self.assertTrue(_nc_path.writes_tool_offset(entry, block.tokens, block.codes))

    # -- NCR-9: an empty level is no level the program wrote --------------------------------------

    def test_ncr9_the_levels_of_a_cycle_come_from_its_parameters(self) -> None:
        text = "G17 G90 G71\nG0 X0 Y0 Z50\nX10 Y10\n%s\nG91 G0 Z10\nM30"
        for cycle, levels in (
            ("CYCLE81(10,0,2,-10)", {"Z"}),
            ("CYCLE81(,0,2,-10)", set()),  # an empty RTP is 0, which nobody wrote
            ("CYCLE81(10,,2,-10)", set()),
            ("CYCLE81(10,0,2,,5)", {"Z"}),  # DP empty, its twin DPR written
            ("CYCLE81(10,0,2)", set()),  # DP and DPR left out
        ):
            with self.subTest(cycle=cycle):
                _, steps = walk(text % cycle, "sinumerik-mill")
                self.assertEqual(steps[4].levels, frozenset(levels))
        # MCALL: the parameters of the line that made the cycle modal.
        for call, levels in (("MCALL CYCLE81(10,0,2,-10)", {"Z"}), ("MCALL CYCLE81(,0,2,-10)", set())):
            with self.subTest(call=call):
                _, steps = walk("G17 G90 G71\nG0 X0 Y0 Z50\n%s\nX10 Y10\nMCALL\nG91 G0 Z10\nM30" % call, "sinumerik-mill")
                self.assertEqual(steps[5].levels, frozenset(levels))

    def test_ncr9_a_klartext_definition_gives_its_levels_on_its_own_lines(self) -> None:
        define = "CYCL DEF 200 DRILLING ~\n  Q200=+2 ;SET-UP ~\n  Q201=-20 ;DEPTH ~\n%s  Q204=+50 ;2ND SET-UP"
        text = "BEGIN PGM T MM\nTOOL CALL 1 Z S3000\nL X+0 Y+0 Z+50 R0 FMAX\n%s\nL X+10 Y+10 R0 FMAX M99\nL IZ+10 FMAX\nEND PGM T MM"
        _, steps = walk(text % (define % "  Q203=+0 ;SURFACE ~\n"), "heidenhain-klartext")
        self.assertEqual(steps[-2].levels, frozenset({"Z"}))
        for missing in ("", "  Q203=+Q5 ;SURFACE ~\n"):
            with self.subTest(missing=missing):
                _, steps = walk(text % (define % missing), "heidenhain-klartext")
                self.assertEqual(steps[-2].levels, frozenset())

    def test_ncr9_empty_levels(self) -> None:
        context = helpers.effective_context("sinumerik-mill")
        cp = gedit_nc.compile_profile(context["profile"])
        interp = gedit_nc.ModalInterpreter(cp, context["codes"])
        entry = interp.entry("CYCLE83")
        for call, empty in (
            ("CYCLE83(10,0,2,-20,,-5,,2,1,1,1,0)", []),
            ("CYCLE83(10,0,2,,20,,5,2,1,1,1,0)", []),  # DP and FDEP empty, their twins written
            ("CYCLE83(,0,2,-20,,,5)", ["RTP"]),  # FDEP empty, FDPR written
            ("CYCLE83(,0,2,-20,,,)", ["RTP", "FDEP"]),
            ("CYCLE83(10,0,2,-20)", ["FDEP"]),
            ("CYCLE83()", ["RTP", "RFP", "DP", "FDEP"]),
        ):
            with self.subTest(call=call):
                tokens, _ = gedit_nc.tokenize_line(call, cp, None)
                token = next(t for t in tokens if t.kind == "call")
                self.assertEqual(_nc_path.empty_levels(token, entry), empty)


class PerformanceTest(unittest.TestCase):
    """P4a fix batch B6 (CODE-1): what a long program asks the tracker again and again is worked
    out once for the kind of word, with the same answers as before."""

    LITERALS = ("0", "0.", "-0.0", "1", "1.", "12", "12.5", "-12.5", "+3.", "0.001", ".5", "-.5", "1000", "1000.", "123456.789", "0.0000001", "-5", "7.125", "99999999999999999999.99999")
    CLASSES = ("length", "increment", "angle", "feedPerMin", "dwell", "count", None)

    def contexts(self):
        for profile_id in helpers.profile_ids():
            yield helpers.effective_context(profile_id)
            declared = (((helpers.load_profile(profile_id).get("machineParams") or {}).get("numberInput") or {}).get("presets")) or []
            for preset in declared:
                yield helpers.effective_context(profile_id, preset=preset["id"])

    def test_readings_are_what_resolve_value_gives(self) -> None:
        # Every profile, with no machine chosen (the presets must agree) and with each preset as
        # the machine, for words with and without a point, in both units.
        literals = [gedit_nc.parse_number(text) for text in self.LITERALS]
        literals.append(gedit_nc.NumericLiteral(raw="0,5", sign="", int_part="0", frac_part="5", has_point=True))
        compared = 0
        for context in self.contexts():
            machine = gedit_nc.machine_params(context)
            readings = _nc_path.Readings(machine, context["profile"])
            for literal in literals:
                for cls in self.CLASSES:
                    for units in ("mm", "inch"):
                        want = gedit_nc.resolve_value(literal, cls, machine, context["profile"], units)
                        self.assertEqual(readings.get(literal, cls, units), want, (context["profile"].get("id"), literal.raw, cls, units))
                        compared += 1
        self.assertGreater(compared, 4000)

    def test_a_walk_resolves_the_kinds_of_word_not_every_number(self) -> None:
        # 400 different coordinates with a point: one reading per class and unit, not one per number.
        lines = ["G90 G17 G21"] + ["G1 X%d.%03d Y-%d.%03d F800." % (i, i % 997, i + 1, (i * 7) % 991) for i in range(400)]
        calls = []
        real = gedit_nc.resolve_value

        def counting(*args, **kwargs):
            calls.append(args[1])
            return real(*args, **kwargs)

        gedit_nc.resolve_value = counting
        try:
            _, steps = walk("\n".join(lines))
        finally:
            gedit_nc.resolve_value = real
        self.assertEqual(steps[-1].after["X"], D("399.399"))
        self.assertLess(len(calls), 12, calls[:20])

    def test_numbers_that_differ_by_machine_are_still_asked_for_each(self) -> None:
        # Point-less words on a profile whose presets disagree (IS-B, IS-C, as written): no value, and the readings.
        tracker, steps = walk("G90 G17 G21\nG1 X1000 Y2000 F100.")
        self.assertIsNone(steps[1].after["X"])
        self.assertTrue(any(e.kind == "machine-dependent" for e in steps[1].events if isinstance(e, _nc_path.Unknown)))

    def test_a_walk_can_leave_out_the_reaches_and_the_flow(self) -> None:
        text = "G90 G17 G21\nG0 X10. Y0.\nG3 X0. Y10. I-10. J0. F100.\n/G1 Y20.\nG1 X5."
        context = helpers.effective_context("fanuc-gcode")
        cp = gedit_nc.compile_profile(context["profile"])
        full = _nc_path.PathTracker(context, cp)
        light = _nc_path.PathTracker(context, cp, reach=False, flow=False)
        state_full = state_light = None
        reached = 0
        for number, line in enumerate(text.split("\n"), 1):
            state_full, a = full.line(line, number, state_full, True)
            state_light, b = light.line(line, number, state_light, True)
            self.assertEqual((a.before, a.after, a.kind, a.arc), (b.before, b.after, b.kind, b.arc), line)
            reached += sum(1 for e in a.events if isinstance(e, _nc_path.Reach))
            self.assertEqual([e for e in a.events if not isinstance(e, _nc_path.Reach)], b.events, line)
            self.assertEqual(b.unsure, frozenset())
            self.assertEqual(b.flow, ())
        self.assertGreater(reached, 3)  # the full walk lists them (the arc's extremes among them)
        self.assertEqual(a.unsure, frozenset({"Y"}))  # and knows what a skipped block leaves unsure


class LaterVersionTest(unittest.TestCase):
    """Wave Y, BL-NC-geometry: what the tracker computes for the later-version transforms. Each
    test fails without its change."""

    def test_t112_an_okuma_arc_by_its_l_radius_is_computed(self) -> None:
        # OSP-P300 programming manual (LG33-019-R22, p.44-46): G2/G3 with the radius L, X and Z
        # both written, the arc of at most 180 degrees. X is a diameter: from (Z0, X r20) to
        # (Z-20, X r40) with the radius 20 counter-clockwise.
        _, steps = walk("G90 G18\nG0 X40. Z0.\nG3 X80. Z-20. L20.", "okuma-osp", preset="okuma-1mm")
        arc = steps[2].arc
        self.assertIsNotNone(arc)
        self.assertEqual((arc.plane, arc.form, arc.direction), (("Z", "X"), "radius", "ccw"))
        self.assertEqual(tuple(round(float(v), 6) for v in arc.centre), (-20.0, 20.0))

    def test_t112_what_stays_not_resolved(self) -> None:
        for block in ("G3 X80. Z-20. L20. CALRG", "G3 X80. Z-20. L20. I10.", "G3 X80. L20.", "G3 X80. Z-20. L-20."):
            with self.subTest(block=block):
                _, steps = walk("G90 G18\nG0 X40. Z0.\n" + block, "okuma-osp", preset="okuma-1mm")
                self.assertIsNone(steps[2].arc)
                self.assertIn("arc", [e.kind for e in steps[2].events if isinstance(e, _nc_path.Unknown)])

    def test_t112_okuma_arcs_by_their_centre_are_in_the_turning_plane(self) -> None:
        # The Okuma plane codes choose the compensation plane only; the turning plane is ZX.
        _, steps = walk("G90\nG0 X40. Z0.\nG3 X80. Z-20. I20. K0.", "okuma-osp", preset="okuma-1mm")
        self.assertEqual(steps[2].arc.plane if steps[2].arc else None, ("Z", "X"))


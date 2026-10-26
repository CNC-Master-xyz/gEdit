"""The contract of ``_nc_cycles.py`` (Phase 4 plan §6.3, §6.4; the P4b prelude).

The vocabulary and the readers are final and tested here; the expansion of a block into holes
(P4.7) has its goldens in ``tests/fixtures/scripts/expand_cycles/`` and its cases in
``tests/python/test_expand_cycles.py``; :class:`ExpansionTest` holds the contract around them.
"""

from __future__ import annotations

import re
import unittest
from decimal import Decimal

from tests.python import helpers

helpers.import_gedit_nc()  # puts the bundled scripts on sys.path
import _nc_cycles  # noqa: E402

EXPAND_TS = helpers.REPO_ROOT / "src" / "lib" / "core" / "codes" / "expand.ts"


def ts_list(name: str) -> list:
    """A `const NAME = [ ... ]` string list of `expand.ts`, in order."""
    text = EXPAND_TS.read_text(encoding="utf-8")
    match = re.search(r"export const %s = \[(.*?)\]" % re.escape(name), text, re.S)
    assert match is not None, name
    return re.findall(r"'([^']+)'", match.group(1))


class VocabularyTest(unittest.TestCase):
    """The Python lists are the TypeScript loader's, in the same order."""

    def test_the_lists_are_the_loaders(self) -> None:
        for name, value in (
            ("EXPAND_ROLES", _nc_cycles.EXPAND_ROLES),
            ("EXPAND_KINDS", _nc_cycles.EXPAND_KINDS),
            ("EXPAND_LEVELS", _nc_cycles.EXPAND_LEVELS),
            ("EXPAND_STEPS", _nc_cycles.EXPAND_STEPS),
            ("PECK_MODES", _nc_cycles.PECK_MODES),
            ("PECK_FIELDS", _nc_cycles.PECK_FIELDS),
            ("FEED_OUT_ZERO", _nc_cycles.FEED_OUT_ZERO),
        ):
            with self.subTest(name=name):
                self.assertEqual(list(value), ts_list(name))

    def test_every_reason_has_a_plain_text(self) -> None:
        for reason, text in list(_nc_cycles.REASONS.items()) + list(_nc_cycles.INFO.items()):
            with self.subTest(reason=reason):
                self.assertRegex(reason, r"^[a-z]+(-[a-z]+)*$")
                self.assertTrue(text and text[0].islower() and not text.endswith("."))

    def test_the_peck_fields_are_the_form_ids_of_the_script(self) -> None:
        # The two peck fields, then the units they are given in (fix batch 1, NC-11).
        header = (helpers.SCRIPTS_DIR / "expand_cycles.py").read_text(encoding="utf-8")
        ids = re.findall(r'^# id = "([^"]+)"', header, re.M)
        self.assertEqual(ids, list(_nc_cycles.PECK_FIELDS) + ["motionUnits"])

    def test_the_module_imports_gedit_nc_only(self) -> None:
        # program_checks.py reads machine_limits without loading the geometry modules (§6.4).
        source = (helpers.SCRIPTS_DIR / "_nc_cycles.py").read_text(encoding="utf-8")
        imports = re.findall(r"^(?:import|from) ([A-Za-z_][A-Za-z0-9_]*)", source, re.M)
        self.assertEqual(sorted(set(imports) - {"__future__", "decimal", "typing"}), ["gedit_nc"])


class ReaderTest(unittest.TestCase):
    """The readers of a loaded entry and of the context."""

    SCHEMA = {
        "kind": "drill",
        "steps": [{"step": "rapid", "to": "r-plane"}, {"step": "feed", "to": "depth"}, {"step": "rapid", "to": "return"}],
        "returnBy": "code",
        "leaves": {"motion": "before", "feed": "cycle"},
    }

    def test_a_schema_and_a_role_read_as_loaded(self) -> None:
        entry = {"code": "G81", "expand": self.SCHEMA, "params": [{"address": "R", "label": "R", "expandRole": "r-plane"}, {"address": "Q", "label": "Q", "expandRole": "nonsense"}]}
        self.assertIs(_nc_cycles.expand_of(entry), self.SCHEMA)
        self.assertEqual(_nc_cycles.roles_of(entry), {"R": "r-plane"})
        self.assertIsNone(_nc_cycles.expand_of({"code": "G84"}))
        self.assertIsNone(_nc_cycles.expand_of(None))

    def test_a_schema_with_cases_picks_by_the_value_as_written(self) -> None:
        cases = {"by": "VARI", "cases": {"0": self.SCHEMA, "1": dict(self.SCHEMA, kind="peck")}}
        self.assertEqual(_nc_cycles.schema_for(cases, "1")["kind"], "peck")
        self.assertIsNone(_nc_cycles.schema_for(cases, "2"))
        self.assertIsNone(_nc_cycles.schema_for(cases, None))
        self.assertIs(_nc_cycles.schema_for(self.SCHEMA, None), self.SCHEMA)

    def test_the_peck_fields_a_schema_needs(self) -> None:
        g73 = dict(self.SCHEMA, steps=[{"step": "pecks", "mode": "chip-break", "retract": {"form": "peckRetract"}}])
        g83 = dict(self.SCHEMA, steps=[{"step": "pecks", "mode": "full-retract", "back": "r-plane", "reentry": {"form": "peckClearance"}}])
        self.assertEqual(_nc_cycles.needs_peck_values(g73), (True, False))
        self.assertEqual(_nc_cycles.needs_peck_values(g83), (False, True))
        self.assertEqual(_nc_cycles.needs_peck_values({"by": "VARI", "cases": {"0": g73, "1": g83}}), (True, True))
        self.assertEqual(_nc_cycles.needs_peck_values(self.SCHEMA), (False, False))

    def test_the_cycle_return_and_the_dwell_form(self) -> None:
        self.assertEqual(_nc_cycles.cycle_return_of({"sets": {"cycleReturn": "initial"}}), "initial")
        self.assertIsNone(_nc_cycles.cycle_return_of({"sets": {"cycleReturn": "up"}}))
        self.assertEqual(_nc_cycles.dwell_form_of({"dwell": {"increments": "P"}}), {"increments": "P"})
        self.assertIsNone(_nc_cycles.dwell_form_of({"code": "G1"}))

    def test_the_machine_blocks_are_absent_unless_the_context_has_them(self) -> None:
        motion = {"units": "mm", "rapid": {"X": 30000}, "toolChange": 4}
        ctx = {"machine": {"id": "m1", "params": {}, "motion": motion}}
        self.assertIs(_nc_cycles.machine_motion(ctx), motion)
        self.assertIsNone(_nc_cycles.machine_limits(ctx))
        self.assertIsNone(_nc_cycles.machine_motion({"machine": {"id": None}}))
        self.assertIsNone(_nc_cycles.machine_motion({}))

    def test_the_data_types(self) -> None:
        pecks = _nc_cycles.PeckValues(retract=Decimal("0.5"))
        self.assertIsNone(pecks.clearance)
        move = _nc_cycles.HoleMove("rapid", {"Z": Decimal("2")})
        self.assertIn(move.kind, _nc_cycles.MOVE_KINDS)


class DefaultTest(unittest.TestCase):
    """A ``'default'`` parameter at its value, or at one of a list of values the manuals prove
    equivalent (the owner, 2026-10-20; plan §6.3 rule 1)."""

    def test_one_value_compared_as_a_number(self) -> None:
        for text in ("0", "0.0", "+0", "-0", ".0", "0.", "", "  ", None):
            with self.subTest(text=text):
                self.assertTrue(_nc_cycles.at_default(text, "0"))
        for text in ("1", "0.5", "-1", "R1", "abc"):
            with self.subTest(text=text):
                self.assertFalse(_nc_cycles.at_default(text, "0"))

    def test_a_list_of_equivalent_values(self) -> None:
        # Sinumerik CYCLE83: FRF 0 means 100 %, _AXN 0 and 3 both name the third axis.
        for text in ("1", "1.0", "0", "0.000", ""):
            with self.subTest(text=text):
                self.assertTrue(_nc_cycles.at_default(text, ["1", "0"]))
        for text in ("0.5", "2", "-1"):
            with self.subTest(text=text):
                self.assertFalse(_nc_cycles.at_default(text, ["1", "0"]))
        self.assertTrue(_nc_cycles.at_default("3", ["0", "3"]))
        self.assertFalse(_nc_cycles.at_default("1", ["0", "3"]))
        self.assertEqual(_nc_cycles.default_values([" 0", "3 "]), ["0", "3"])
        self.assertEqual(_nc_cycles.default_values(" 1 "), ["1"])

    def test_no_value_in_the_data_understands_only_empty(self) -> None:
        self.assertTrue(_nc_cycles.at_default("", None))
        self.assertFalse(_nc_cycles.at_default("0", None))
        self.assertFalse(_nc_cycles.at_default("0", []))


class PeckOriginTest(unittest.TestCase):
    """Where the pecks are measured from (plan §6.3 rule 3, settled at the Wave A integration):
    the surface where the entry has one, otherwise the feed start (FANUC's R point)."""

    def test_from_the_feed_start_without_a_surface(self) -> None:
        # FANUC G83 R2. Q5. Z-12.: Q counts from the R point.
        bottoms = _nc_cycles.peck_bottoms(Decimal("2"), Decimal("-12"), {"peck": Decimal("5")}, {})
        self.assertEqual(bottoms, [Decimal("-3"), Decimal("-8"), Decimal("-12")])

    def test_from_the_surface(self) -> None:
        # Klartext 200 Q200=2 Q202=5 Q201=-10 Q203=+0: one pass when Q202 equals the depth, so
        # the first peck ends 5 below the surface, not 5 below the set-up clearance.
        values = {"peck": Decimal("5"), "surface": Decimal("0")}
        self.assertEqual(_nc_cycles.peck_bottoms(Decimal("2"), Decimal("-12"), values, {}), [Decimal("-5"), Decimal("-10"), Decimal("-12")])
        self.assertEqual(_nc_cycles.peck_bottoms(Decimal("2"), Decimal("-5"), values, {}), [Decimal("-5")])

    def test_the_first_drilling_depth_sets_the_stroke(self) -> None:
        # SINUMERIK CYCLE83 RFP=0 SDIS=2 FDPR=5 DP=-15: the strokes after the first are its 5.
        values = {"first-peck": Decimal("-5"), "surface": Decimal("0")}
        self.assertEqual(_nc_cycles.peck_bottoms(Decimal("2"), Decimal("-15"), values, {}), [Decimal("-5"), Decimal("-10"), Decimal("-15")])

    def test_a_first_peck_above_the_surface_refuses(self) -> None:
        values = {"first-peck": Decimal("1"), "surface": Decimal("0")}
        with self.assertRaises(_nc_cycles.CycleError) as caught:
            _nc_cycles.peck_bottoms(Decimal("2"), Decimal("-15"), values, {})
        self.assertEqual(caught.exception.reason, "value-missing")

    def test_decrement_and_minimum(self) -> None:
        # The decrement example of the TNC 640 cycles manual (cycle 203): 5, 4, 3, then 3.
        values = {"peck": Decimal("5"), "peck-decrement": Decimal("1"), "peck-minimum": Decimal("3"), "surface": Decimal("0")}
        bottoms = _nc_cycles.peck_bottoms(Decimal("2"), Decimal("-20"), values, {})
        self.assertEqual(bottoms, [Decimal(v) for v in ("-5", "-9", "-12", "-15", "-18", "-20")])


class ExpansionTest(unittest.TestCase):
    """The expansion of P4.7 (plan §6.3): its goldens are ``tests/fixtures/scripts/expand_cycles/``
    and its cases ``tests/python/test_expand_cycles.py``; these hold the contract around them."""

    def test_every_schema_has_goldens(self) -> None:
        # Every cycle the shipped data gives a schema (P4.6) is written in some golden.
        from tests.python import test_expand_cycles as expand

        written = "\n".join(case.input_text() for case in expand.cases())
        for dialect in ("fanuc", "heidenhain", "sinumerik"):
            codes = [e["code"] for e in helpers.resolved_codes(dialect) if _nc_cycles.expand_of(e) is not None]
            self.assertTrue(codes, dialect)
            for code in codes:
                with self.subTest(dialect=dialect, code=code):
                    self.assertRegex(written, r"(?<![A-Z0-9])%s(?![0-9])" % re.escape(code))

    def test_the_extents_equality(self) -> None:
        # X23 on one golden here; every written golden in test_expand_cycles.GoldenTest.
        from tests.python import test_expand_cycles as expand

        case = next(c for c in expand.cases() if c.name == "fanuc-g81-g98-g99")
        context = expand.case_context(case)
        problems, skipped = expand.extents_problems(expand.extents_of(case.input_text(), context), expand.extents_of(case.expected_text(), context))
        self.assertEqual((problems, skipped), ([], 0))

    def test_the_peck_values(self) -> None:
        # Q4-9: a G83 without the form's clearance refuses; with it the pecks come back at the clearance.
        from tests.python import test_expand_cycles as expand

        text = expand.FANUC_DRILL.replace("G81 X10. Y10. Z-5. R2. F150.", "G98 G83 X10. Y10. Z-14. R2. Q8. F150.")
        context = expand.plain_context("fanuc-gcode", text)
        walk = expand.Walk(text, context, _nc_cycles.PeckValues())
        self.assertEqual([r.reason for r in walk.refusals], ["peck-clearance-missing"])
        walk = expand.Walk(text, context, _nc_cycles.PeckValues(clearance=Decimal("1.5")))
        (hole,) = walk.holes
        self.assertEqual([m.to.get("Z") for m in hole.moves if "Z" in m.to], [Decimal(v) for v in ("2", "-6", "2", "-4.5", "-14", "20")])

    def test_a_block_without_a_cycle_answers_nothing(self) -> None:
        from tests.python import test_expand_cycles as expand

        text = expand.FANUC_DRILL.replace("G81 X10. Y10. Z-5. R2. F150.", "G1 X10. F100.")
        walk = expand.Walk(text, expand.plain_context("fanuc-gcode", text), _nc_cycles.PeckValues())
        self.assertEqual((walk.holes, walk.refusals), ([], []))


if __name__ == "__main__":
    unittest.main()

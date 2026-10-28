"""How the control reads numbers, the Python half (plan §7.15, AD-31, WP6.9).

The point of this file is **parity**. Every case in
``tests/fixtures/machines/numbers.json`` is run by `src/lib/core/machines/numbers.test.ts`
as well, so a difference between the two implementations shows up here or there rather
than in a customer's program. When one of them has to change, the fixture changes with it
and both sides are re-run — never one side alone.

The cases below the table are about the module's own edges: the fallback that lets a
context written before M6 keep working, and the two ways a script can hand a machine in.
"""

from __future__ import annotations

import dataclasses
import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

# The reason strings, which `gedit_nc` does not re-export: the golden set names the case
# ("rounded"), and the module says what the sentence for it is.
import _nc_machine  # noqa: E402  (importable only once helpers has set sys.path)

KEEP = {"decimals": "keep", "trailingZeros": "keep", "keepPoint": True, "plusSign": "keep"}


def literal(raw):
    """A golden literal as the tokenizer would have produced it.

    A comma is read the way the Klartext tokenizer reads its decimal comma (2026-09): the
    strict parse first, then the comma retried as the point, ``raw`` kept as written.
    Mirrors ``literalOf`` in ``numbers.test.ts``.
    """
    parsed = gedit_nc.parse_number(raw)
    if parsed is None and "," in raw:
        alt = gedit_nc.parse_number(raw.replace(",", "."))
        parsed = None if alt is None else dataclasses.replace(alt, raw=raw)
    if parsed is None:
        raise AssertionError("%r does not parse" % (raw,))
    return parsed


class GoldenCases(unittest.TestCase):
    """The table both languages answer, case for case."""

    @classmethod
    def setUpClass(cls):
        cls.golden = helpers.load_json(helpers.FIXTURES_DIR / "machines" / "numbers.json")

    # -- the golden set's own vocabulary --------------------------------------

    def input_of(self, name):
        """One ``NumberInput`` of the golden set, or ``None`` for a profile without one."""
        if name is None:
            return None
        inputs = self.golden["inputs"]
        self.assertIn(name, inputs)
        entry = inputs[name]
        if "preset" in entry:
            return self.shipped_preset(entry["preset"])
        return entry

    def shipped_preset(self, ref):
        """T206: a preset the golden set names (``fanuc-gcode/is-b``), read from the shipped profile.

        The golden set used to copy the presets, and the copies drifted from the data the app
        ships. Mirrors ``shippedPreset`` in ``numbers.test.ts``.
        """
        profile_id, preset_id = ref.split("/")
        number_input = helpers.resolved_profile(profile_id)["machineParams"]["numberInput"]
        found = [preset["value"] for preset in number_input["presets"] if preset["id"] == preset_id]
        self.assertEqual(len(found), 1, "no preset %s in the shipped profiles" % ref)
        return found[0]

    def params_of(self, name):
        """The machine parameters a case describes; only ``numberInput`` matters here."""
        return {
            "numberInput": self.input_of(name),
            "units": "mm",
            "diameter": None,
            "variants": {},
            "modalInitial": {},
        }

    def profile_of(self, name):
        """A built-in profile as the app uses it, or one the golden set writes itself."""
        entry = self.golden["profiles"][name]
        if "profile" in entry:
            return helpers.resolved_profile(entry["profile"])
        return entry["inline"]

    def decl_profile_of(self, name):
        """A profile that carries the declaration a case names.

        ``readings_of`` and ``resolve_value`` take the profile, not the declaration, so a
        declaration the golden set writes itself (none since T206 reads the Okuma presets
        from ``okuma-osp``) is wrapped in a profile here.
        """
        entry = self.golden["decls"][name]
        if "profile" in entry:
            return helpers.resolved_profile(entry["profile"])
        written = entry.get("numberInput")
        if written is None:
            return {}
        presets = [
            {"id": preset["id"], "label": preset["label"], "value": self.input_of(preset["input"])}
            for preset in written["presets"]
        ]
        return {"machineParams": {"numberInput": {"default": written["default"], "presets": presets}}}

    # -- the table ------------------------------------------------------------

    def test_the_table_holds_the_cases_the_plan_asks_for(self):
        total = sum(len(self.golden[section]) for section in ("class", "value", "writeBack", "readings", "resolve"))
        self.assertGreaterEqual(total, 80)

    def test_every_word_gets_the_class_typescript_gives_it(self):
        for number, case in enumerate(self.golden["class"], 1):
            with self.subTest(case=number, note=case["note"]):
                profile = self.profile_of(case["profile"])
                # FB-2: what the modes in force lend, as `arc_centre_modes` adds it
                # (`inForceEntries` in TypeScript).
                lent = [e for e in (gedit_nc.arc_centre_entry(m, profile) for m in case.get("modes", [])) if e is not None]
                in_force = case.get("inForce")
                if lent:
                    in_force = list(in_force or []) + lent
                self.assertEqual(
                    gedit_nc.number_class_of(
                        case["address"],
                        profile,
                        case["feedUnit"],
                        case["codes"],
                        case.get("pitchFeed", False),
                        in_force,
                        case.get("cycleBlock"),
                    ),
                    case["expected"],
                )

    def test_every_literal_has_the_value_typescript_reads_out_of_it(self):
        for number, case in enumerate(self.golden["value"], 1):
            with self.subTest(case=number, note=case["note"]):
                self.assertEqual(
                    gedit_nc.value_of(
                        literal(case["literal"]), case["class"], self.params_of(case["input"]), case["units"]
                    ),
                    case["expected"],
                )

    def test_every_value_goes_back_into_the_word_the_way_typescript_writes_it(self):
        for number, case in enumerate(self.golden["writeBack"], 1):
            with self.subTest(case=number, note=case["note"]):
                text, rounded, error = gedit_nc.write_back(
                    case["value"],
                    literal(case["original"]),
                    case["class"],
                    self.params_of(case["input"]),
                    case["units"],
                    self.golden["fmt"],
                    case.get("refuseRounding", False),
                )
                expected = case["expected"]
                if "error" in expected:
                    self.assertIsNone(text)
                    self.assertEqual(error, _nc_machine.WRITE_BACK_ERRORS[expected["error"]])
                else:
                    self.assertIsNone(error)
                    self.assertEqual(text, expected["text"])
                    self.assertEqual(rounded, expected["rounded"])

    def test_every_preset_reads_a_literal_the_way_typescript_does(self):
        for number, case in enumerate(self.golden["readings"], 1):
            with self.subTest(case=number, note=case["note"]):
                readings = gedit_nc.readings_of(
                    literal(case["literal"]), case["class"], self.decl_profile_of(case["decl"]), case["units"]
                )
                self.assertEqual(
                    [{"preset": r["preset"], "value": r["value"]} for r in readings], case["expected"]
                )
                for reading in readings:
                    self.assertTrue(reading["label"], reading["preset"])

    def test_every_word_resolves_the_way_typescript_resolves_it(self):
        for number, case in enumerate(self.golden["resolve"], 1):
            with self.subTest(case=number, note=case["note"]):
                ctx_machine = {
                    "id": None,
                    "name": None,
                    "choice": "document" if case["source"] == "machine" else "none",
                    "params": self.params_of(case["input"]),
                    "source": {
                        "numberInput": case["source"],
                        "units": "profile",
                        "diameter": "profile",
                        "variants": {},
                        "modalInitial": {},
                    },
                }
                value, readings = gedit_nc.resolve_value(
                    literal(case["literal"]),
                    case["class"],
                    ctx_machine,
                    self.decl_profile_of(case["decl"]),
                    case["units"],
                )
                self.assertEqual(value, case["expected"]["value"])
                self.assertEqual([r["preset"] for r in readings], case["expected"]["readings"])


class ShippedPresetsT083T084(unittest.TestCase):
    """T083 and T084: the IS-A preset and the "Point-less feeds" option, as the profiles ship them."""

    @classmethod
    def setUpClass(cls):
        cls.golden = helpers.load_json(helpers.FIXTURES_DIR / "machines" / "numbers.json")

    def preset(self, profile_id, preset_id):
        presets = helpers.resolved_profile(profile_id)["machineParams"]["numberInput"]["presets"]
        found = [p for p in presets if p["id"] == preset_id]
        self.assertEqual(len(found), 1, "%s/%s" % (profile_id, preset_id))
        return found[0]

    def written(self, name):
        entry = dict(self.golden["inputs"][name])
        entry.pop("note", None)
        return entry

    def test_both_fanuc_profiles_offer_is_a_and_leave_it_out_of_the_digit_check(self):
        for profile_id in ("fanuc-gcode", "fanuc-lathe"):
            ids = [p["id"] for p in helpers.resolved_profile(profile_id)["machineParams"]["numberInput"]["presets"]]
            self.assertEqual(ids, ["is-a", "is-b", "is-c", "calculator"], profile_id)
            is_a = self.preset(profile_id, "is-a")
            self.assertIs(is_a.get("digitCheck"), False)
            self.assertEqual(is_a["value"]["incrementMm"], "0.01")
            self.assertEqual(is_a["value"]["incrementInch"], "0.001")
            # The others take part in the digit check.
            for other in ("is-b", "is-c", "calculator"):
                self.assertNotIn("digitCheck", self.preset(profile_id, other))

    def test_the_golden_machine_inputs_are_what_a_point_less_feeds_choice_makes_of_a_preset(self):
        # numbers.test.ts checks the same two inputs against `withPointlessFeeds`, the form's own
        # function: both languages read the values of one and the same machine.
        decl = helpers.resolved_profile("fanuc-gcode")["machineParams"]["numberInput"]["pointlessFeeds"]
        choice = {c["value"]: c for c in decl["choices"]}
        self.assertEqual(decl["default"], "standard")
        self.assertNotIn("classes", choice["standard"])
        self.assertEqual(
            helpers.apply_pointless_feeds(self.preset("fanuc-gcode", "is-c")["value"], choice["per-rev"]), self.written("is-c-per-rev")
        )
        # Manual-check fix D4-2: the lathe states its own option, with its own choices.
        lathe = helpers.resolved_profile("fanuc-lathe")["machineParams"]["numberInput"]["pointlessFeeds"]
        own = {c["value"]: c for c in lathe["choices"]}
        self.assertEqual(lathe["default"], "standard")
        self.assertEqual(list(own), ["standard", "per-minute", "series-15", "both"])
        self.assertNotIn("classes", own["standard"])
        is_b = self.preset("fanuc-lathe", "is-b")["value"]
        self.assertEqual(helpers.apply_pointless_feeds(is_b, own["per-minute"]), self.written("lathe-per-minute"))
        self.assertEqual(helpers.apply_pointless_feeds(is_b, own["series-15"]), self.written("lathe-series-15"))
        # Calculator-type input reads every feed as written, whatever the feed parameters say.
        calculator = self.preset("fanuc-lathe", "calculator")["value"]
        self.assertEqual(helpers.apply_pointless_feeds(calculator, own["both"]), calculator)

    def test_d4_1_a_lathe_counts_a_point_less_feed_per_revolution_in_0_0001_mm(self):
        # Manual-check fix D4-1: on every lathe increment preset, G99 F12345 is 1.2345 mm/rev.
        for preset_id in ("is-a", "is-b", "is-c"):
            with self.subTest(preset=preset_id):
                rev = self.preset("fanuc-lathe", preset_id)["value"]["classes"]["feedPerRev"]
                self.assertEqual(rev, {"mode": "increment", "increment": "0.0001", "incrementInch": "0.000001"})

    def test_with_no_machine_the_option_is_never_assumed(self):
        # The defaults of a document with no machine are the default preset as declared.
        machine = gedit_nc.machine_params({"profile": helpers.resolved_profile("fanuc-gcode")})
        self.assertEqual(machine["params"]["numberInput"], self.preset("fanuc-gcode", "is-b")["value"])
        value, readings = gedit_nc.resolve_value(
            literal("200"), "feedPerMin", machine, helpers.resolved_profile("fanuc-gcode"), "mm"
        )
        self.assertEqual((value, readings), ("200", []))


class MachineParams(unittest.TestCase):
    """What a script gets when nobody chose a machine (§7.15)."""

    def test_an_empty_context_answers_the_defaults_with_every_source_the_profile(self):
        machine = gedit_nc.machine_params({})
        self.assertEqual(machine["choice"], "none")
        self.assertIsNone(machine["id"])
        self.assertIsNone(machine["params"]["numberInput"])
        self.assertEqual(machine["params"]["units"], "mm")
        self.assertEqual(machine["source"]["numberInput"], "profile")
        self.assertEqual(machine["source"]["units"], "profile")

    def test_a_context_without_a_machine_answers_the_profile_defaults(self):
        profile = helpers.load_profile("fanuc-gcode")
        machine = gedit_nc.machine_params(helpers.make_context(profile=profile))
        self.assertEqual(machine["choice"], "none")
        # The default preset by its id, not by its place in the list.
        declared = profile["machineParams"]["numberInput"]
        default = [preset["value"] for preset in declared["presets"] if preset["id"] == declared["default"]]
        self.assertEqual(machine["params"]["numberInput"], default[0])
        self.assertEqual(machine["params"]["units"], "mm")
        for name in ("numberInput", "units", "diameter"):
            self.assertEqual(machine["source"][name], "profile")
        self.assertEqual(machine["source"]["modalInitial"], {"feedmode": "profile"})

    def test_the_lathe_defaults_to_the_preset_its_declaration_names(self):
        profile = helpers.load_profile("fanuc-lathe")
        machine = gedit_nc.machine_params(helpers.make_context(profile=profile))
        presets = profile["machineParams"]["numberInput"]["presets"]
        wanted = next(p for p in presets if p["id"] == profile["machineParams"]["numberInput"]["default"])
        self.assertEqual(machine["params"]["numberInput"], wanted["value"])
        self.assertEqual(machine["params"]["diameter"], "on")
        # M9 (R6): the two tool/U-W variants join the G-code system, each at its default
        # (the tool change since D3-4a, the counter spindle since the review round's D5-7).
        self.assertEqual(
            machine["params"]["variants"],
            {"gcodeSystem": "A", "incrementalAddresses": "uw", "toolWord": "byLength", "toolChange": "turret", "counterSpindleY": "turns"},
        )

    def test_a_profile_that_declares_nothing_reads_its_numbers_as_written(self):
        profile = helpers.load_profile("heidenhain-klartext")
        machine = gedit_nc.machine_params(helpers.make_context(profile=profile))
        self.assertIsNone(machine["params"]["numberInput"])
        self.assertEqual(gedit_nc.value_of(literal("50"), "length", machine, "mm"), "50")

    def test_the_effective_machine_of_the_context_is_taken_as_it_stands(self):
        context = helpers.effective_context("fanuc-gcode", preset="is-b")
        machine = gedit_nc.machine_params(context)
        self.assertEqual(machine["source"]["numberInput"], "machine")
        value, readings = gedit_nc.resolve_value(literal("50"), "length", machine, context["profile"], "mm")
        self.assertEqual(value, "0.05")
        self.assertEqual(readings, [])

    def test_the_whole_effective_machine_may_be_passed_where_parameters_are_wanted(self):
        # A script holds `machine_params(load_context())`, not its `params` member, and
        # passing it must not silently read numbers as if no machine had been chosen.
        context = helpers.effective_context("fanuc-gcode", preset="is-b")
        machine = gedit_nc.machine_params(context)
        self.assertEqual(gedit_nc.value_of(literal("50"), "length", machine, "mm"), "0.05")
        self.assertEqual(gedit_nc.value_of(literal("50"), "length", machine["params"], "mm"), "0.05")


class WriteBackEdges(unittest.TestCase):
    """The rules that are easier to read as a sentence than as a fixture line."""

    def setUp(self):
        self.machine = {
            "numberInput": {
                "mode": "increment",
                "incrementMm": "0.001",
                "incrementInch": "0.0001",
                "incrementDeg": "0.001",
                "incrementSec": "0.001",
                "classes": {"feedPerMin": {"mode": "calculator"}, "feedPerRev": {"mode": "calculator"}},
            }
        }

    def test_a_point_survives_and_a_point_less_word_stays_point_less_in_all_three_readings(self):
        calculator = {"numberInput": {"mode": "calculator", "incrementMm": "1"}}
        scale = {"numberInput": {"mode": "scale", "incrementMm": "0.01"}}
        # A point-less word is a count of increments under `increment`, of units under
        # `scale` and millimetres under `calculator`; a pointed word is millimetres in
        # `increment` and `calculator` and still a count of units under `scale`.
        for machine, counted, written in (
            (self.machine, "0.06", "60"),
            (calculator, "60", "60"),
            (scale, "0.6", "0.6"),
        ):
            with self.subTest(machine=machine["numberInput"]["mode"]):
                self.assertEqual(
                    gedit_nc.write_back(counted, literal("50"), "length", machine, "mm", KEEP), ("60", False, None)
                )
                self.assertEqual(
                    gedit_nc.write_back(written, literal("50."), "length", machine, "mm", KEEP), ("60.", False, None)
                )

    def test_a_rounding_is_reported_and_can_be_refused(self):
        text, rounded, error = gedit_nc.write_back("0.0505", literal("50"), "length", self.machine, "mm", KEEP)
        self.assertEqual((text, rounded, error), ("51", True, None))
        text, rounded, error = gedit_nc.write_back(
            "0.0505", literal("50"), "length", self.machine, "mm", KEEP, True
        )
        self.assertIsNone(text)
        self.assertEqual(error, _nc_machine.WRITE_BACK_ERRORS["rounded"])

    def test_a_value_that_fits_is_never_refused(self):
        self.assertEqual(
            gedit_nc.write_back("0.05", literal("50"), "length", self.machine, "mm", KEEP, True), ("50", False, None)
        )

    def test_a_value_that_is_not_a_number_is_refused_instead_of_raising(self):
        text, _rounded, error = gedit_nc.write_back("1e3", literal("50"), "length", self.machine, "mm", KEEP)
        self.assertIsNone(text)
        self.assertEqual(error, _nc_machine.WRITE_BACK_ERRORS["notANumber"])

    def test_a_word_without_a_reading_has_nothing_to_write_back_into(self):
        text, _rounded, error = gedit_nc.write_back("3", literal("3"), "count", self.machine, "mm", KEEP)
        self.assertIsNone(text)
        self.assertEqual(error, _nc_machine.WRITE_BACK_ERRORS["noReading"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()


class ArcCentreModes(unittest.TestCase):
    """FB-2 (T120, WX-NC-6): a mode in force that declares the arc-centre words lends a block
    those words only (`wordValue.ts` `inForceEntries` / `arcCentreEntry`)."""

    @classmethod
    def setUpClass(cls):
        context = helpers.effective_context("fanuc-gcode")
        cls.profile = context["profile"]
        cls.entries = {e["code"]: e for e in context["codes"] if isinstance(e, dict)}

    def modes(self, groups, written=()):
        return gedit_nc.arc_centre_modes(
            {group: {"code": code, "line": 1} for group, code in groups.items()}, self.entries.get, self.profile, written
        )

    def test_g43_5_lends_i_j_k_and_keeps_its_q(self):
        lent = self.modes({"lengthComp": "G43.5", "motion": "G1"})
        self.assertEqual([e["code"] for e in lent], ["G43.5"])
        self.assertEqual([p["address"] for p in lent[0]["params"]], ["I", "J", "K"])
        self.assertTrue(gedit_nc.redefines_arc_centre(self.entries["G43.5"], self.profile))
        # The same copy every block, so a cache by `id` sees one entry.
        self.assertIs(self.modes({"lengthComp": "G43.5"})[0], lent[0])
        self.assertIs(gedit_nc.arc_centre_entry(self.entries["G43.5"], self.profile), lent[0])

    def test_under_a_modal_g83_q_stays_a_length(self):
        in_force = [self.entries["G83"]] + self.modes({"lengthComp": "G43.5", "cycle": "G83"})
        self.assertEqual(gedit_nc.number_class_of("Q", self.profile, "per-minute", [], False, in_force), "length")
        self.assertEqual(gedit_nc.number_class_of("I", self.profile, "per-minute", [], False, in_force), "count")

    def test_g49_g40_and_a_written_code_lend_nothing(self):
        self.assertEqual(self.modes({"lengthComp": "G49", "compensation": "G40"}), [])
        self.assertEqual(self.modes({"lengthComp": "G43.5"}, written=[self.entries["G43.5"]]), [])
        self.assertEqual([e["code"] for e in self.modes({"compensation": "G41.6"})], ["G41.6"])
        self.assertEqual(self.modes({"compensation": "G41"}), [])
        self.assertFalse(gedit_nc.redefines_arc_centre(self.entries["G41"], self.profile))

    def test_a_profile_without_arc_centre_words_lends_nothing(self):
        self.assertEqual(gedit_nc.arc_centre_modes({"lengthComp": {"code": "G43.5"}}, self.entries.get, {"addresses": {}}), [])

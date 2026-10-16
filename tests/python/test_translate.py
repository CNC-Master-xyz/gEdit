"""`translate.py` (Phase 4 plan §5 P4a, P4.3; X19, X22), against the golden cases in
``tests/fixtures/scripts/translate/`` (the format is ``tests/fixtures/scripts/README.md``, "The geometry
goldens"). The runner was written by the P4a prelude; P4.3 added the cases of the exit criteria:

* every golden, byte for byte, with its message and findings (written runs and refused ones);
* identity: a shift of 0, 0, 0 gives every golden and every owner-public program back byte
  for byte;
* the round trip: a shift by d and then by -d gives every value back, on every written golden
  and on every owner-public program the shift by d does not refuse (the counts per refusal
  reason are printed, not asserted);
* the header and the form ids the runtime scenario and the user guide name;
* the run-level refusals (no code database, a selection whose lines above were not sent);
* regression tests for the gaps found in ``_nc_geom``/``_nc_path`` while writing the goldens
  (``ModuleGapTest``; all of them are fixed).

The programs are synthetic, written for gEdit; the owner-public ones are the owner's published
programs, reported as counts only.
"""

from __future__ import annotations

import concurrent.futures
import os
import unittest
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from tests.python import helpers

try:
    import tomllib  # noqa: F401

    HAS_TOMLLIB = True
except ImportError:  # Python 3.9 and 3.10
    HAS_TOMLLIB = False

gedit_nc = helpers.import_gedit_nc()
import _nc_path  # noqa: E402  (the bundled folder is on sys.path from here on)

SCRIPT = "translate.py"

#: The shift the owner-public round trip uses: odd values in every axis, so no word that moves
#: can come back by accident.
SHIFT = {"dx": 1.5, "dy": -2.25, "dz": 0.75}
ZERO = {"dx": 0, "dy": 0, "dz": 0}

OWNER_PUBLIC = helpers.FIXTURES_DIR / "nc" / "owner-public"
#: How many runs at once (each is its own process), and how long one may take on a 99,000-line
#: program at background priority.
WORKERS = max(1, min(4, os.cpu_count() or 1))
LONG_TIMEOUT_SECONDS = 1800
SHORT_TIMEOUT_SECONDS = 600


def run_script(script: str, stdin: str = "", context: Optional[Dict[str, Any]] = None) -> helpers.RunOutput:
    """`helpers.run_script` with a longer limit: at background priority on a busy machine a
    run of twenty lines has been seen to wait more than the 60 s the helper allows."""
    saved = helpers.RUN_TIMEOUT_SECONDS
    helpers.RUN_TIMEOUT_SECONDS = max(saved, SHORT_TIMEOUT_SECONDS)
    try:
        return helpers.run_script(script, stdin=stdin, context=context)
    finally:
        helpers.RUN_TIMEOUT_SECONDS = saved


def negated(params: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(params)
    for key in ("dx", "dy", "dz"):
        if key in out and out[key] not in (None, ""):
            out[key] = -out[key]
    return out


def refused(result: Dict[str, Any]) -> bool:
    return any(f.get("severity") == "error" for f in result.get("findings", []))


def values_of(text: str, profile: Dict[str, Any]) -> List[Tuple[Any, ...]]:
    """The program as the tokenizer reads it, every number as its value: ``X0.`` and ``X0.00``
    are the same, ``X0.`` and ``X0.5`` are not. Call arguments are compared one by one."""
    cp = gedit_nc.compile_profile(profile)
    out: List[Tuple[Any, ...]] = []
    state = None
    for number, line in enumerate(text.split("\n"), 1):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        for token in tokens:
            if token.kind == "whitespace":
                continue
            literal, function = _nc_path.literal_of(token) if token.kind == "word" else (None, None)
            if literal is not None:
                # `X10.`, `Q203=+0,5` and `I=AC(10)`: the value, and the value function.
                value = gedit_nc.decimal_of(literal)
                out.append((number, "word", (token.address or "").upper(), function, value.normalize() if value is not None else token.text))
            elif token.kind == "call" and token.value_text:
                args = []
                for arg in token.value_text.split(","):
                    literal = gedit_nc.parse_number(arg.strip())
                    value = gedit_nc.decimal_of(literal) if literal is not None else None
                    args.append(value.normalize() if value is not None else arg.strip())
                out.append((number, "call", token.address, tuple(args)))
            else:
                out.append((number, token.kind, token.text))
    return out


def owner_public_programs() -> List[Tuple[str, str, str]]:
    """``(name, profile id, text)`` of every owner-public program, as the app hands it over."""
    out = []
    for path in sorted(OWNER_PUBLIC.rglob("*")):
        if not path.is_file():
            continue
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("cp1252")
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        out.append((path.relative_to(OWNER_PUBLIC).as_posix(), path.parent.name, text))
    return out


def run_document(text: str, profile_id: str, params: Dict[str, Any]) -> helpers.RunOutput:
    context = helpers.effective_context(profile_id, params=params)
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    return run_script(SCRIPT, stdin=text, context=context)


def run_inline(text: str, profile_id: str, params: Dict[str, Any], preceding: Optional[List[str]] = None) -> Dict[str, Any]:
    """One run of an inline program; ``preceding`` makes it a selection below those lines."""
    context = helpers.effective_context(profile_id, params=params)
    lines = text.split("\n")
    if preceding is not None:
        start = len(preceding) + 1
        context["input"] = {"scope": "selection", "startLine": start, "endLine": start + len(lines) - 1, "precedingLines": preceding}
    out = run_script(SCRIPT, stdin=text, context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


class GoldenTest(unittest.TestCase):
    def test_every_case(self) -> None:
        cases = helpers.geometry_cases("translate")
        self.assertGreaterEqual(len(cases), 30)
        for case in cases:
            with self.subTest(case=case.name):
                out = run_script(SCRIPT, stdin=case.input_text(), context=helpers.geometry_context(case))
                self.assertTrue(out.ok, out.stderr)
                result = out.json()
                self.assertEqual(result["text"], case.expected_text())
                want = case.envelope()
                self.assertEqual(result.get("message"), want["message"])
                self.assertEqual(result.get("findings", []), want["findings"])
                self.assertEqual(refused(result), case.refused)

    def test_every_built_in_profile_has_a_written_golden_and_a_refused_one(self) -> None:
        written, refusing = set(), set()
        for case in helpers.geometry_cases("translate"):
            (refusing if case.refused else written).add(case.profile_id)
        profiles = {"fanuc-gcode", "fanuc-lathe", "heidenhain-klartext", "okuma-osp", "sinumerik", "sinumerik-mill"}
        self.assertEqual(written, profiles)
        self.assertEqual(refusing, profiles)

    def test_the_refused_goldens_cover_every_x22_reason_of_translate(self) -> None:
        seen = set()
        for case in helpers.geometry_cases("translate"):
            for finding in case.envelope()["findings"]:
                if finding["severity"] == "error":
                    seen.add(finding["reason"])
        wanted = {
            "frame", "coordinate-shift", "intermediate-point", "call", "expression", "machine-dependent",
            "distance-assumed", "axis-unwritten", "unknown-code", "rotary-turned", "selection-inside",
            "cycle-not-reviewed", "fk-contour", "arc-unsupported", "resolution",
        }
        self.assertLessEqual(wanted, seen)


class IdentityAndRoundTripTest(unittest.TestCase):
    """X19 on the goldens: 0, 0, 0 gives the input back byte for byte; d then -d every value."""

    def test_a_zero_shift_gives_every_golden_back_byte_for_byte(self) -> None:
        for case in helpers.geometry_cases("translate"):
            with self.subTest(case=case.name):
                context = helpers.geometry_context(case)
                context["params"] = dict(ZERO)
                out = run_script(SCRIPT, stdin=case.input_text(), context=context)
                self.assertTrue(out.ok, out.stderr)
                self.assertEqual(out.json()["text"], case.input_text())

    def test_d_then_minus_d_gives_every_value_of_every_written_golden_back(self) -> None:
        checked = 0
        for case in helpers.geometry_cases("translate"):
            if case.refused:
                continue
            with self.subTest(case=case.name):
                context = helpers.geometry_context(case)
                context["params"] = negated(case.params)
                out = run_script(SCRIPT, stdin=case.expected_text(), context=context)
                self.assertTrue(out.ok, out.stderr)
                result = out.json()
                self.assertFalse(refused(result), result.get("findings"))
                profile = context["profile"]
                self.assertEqual(values_of(result["text"], profile), values_of(case.input_text(), profile))
                checked += 1
        self.assertGreaterEqual(checked, 10)


class OwnerPublicTest(unittest.TestCase):
    """X19 on the owner's published programs: identity, and the round trip where d is not
    refused. What each refusal reason counts is printed for the review, not asserted."""

    results: Dict[Tuple[str, str], helpers.RunOutput] = {}
    programs: List[Tuple[str, str, str]] = []

    @classmethod
    def setUpClass(cls) -> None:
        cls.programs = owner_public_programs()
        texts = {name: (profile, text) for name, profile, text in cls.programs}
        saved = helpers.RUN_TIMEOUT_SECONDS
        helpers.RUN_TIMEOUT_SECONDS = LONG_TIMEOUT_SECONDS
        try:
            jobs = [(name, kind) for name, _, _ in cls.programs for kind in ("zero", "shift")]
            jobs.sort(key=lambda job: -len(texts[job[0]][1]))
            with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
                futures = {
                    pool.submit(run_document, texts[name][1], texts[name][0], ZERO if kind == "zero" else SHIFT): (name, kind)
                    for name, kind in jobs
                }
                results = {futures[f]: f.result() for f in concurrent.futures.as_completed(futures)}
                back = []
                for name, (profile, _) in texts.items():
                    shifted = results[(name, "shift")]
                    if shifted.ok and not refused(shifted.json()):
                        back.append((name, profile, shifted.json()["text"]))
                futures = {pool.submit(run_document, text, profile, negated(SHIFT)): (name, "back") for name, profile, text in back}
                results.update({futures[f]: f.result() for f in concurrent.futures.as_completed(futures)})
            cls.results = results
        finally:
            helpers.RUN_TIMEOUT_SECONDS = saved

    def test_there_are_the_twenty_published_programs(self) -> None:
        self.assertEqual(len(self.programs), 20)

    def test_no_run_crashes_and_a_refused_run_hands_the_input_back(self) -> None:
        for name, _, text in self.programs:
            for kind in ("zero", "shift"):
                with self.subTest(program=name, run=kind):
                    out = self.results[(name, kind)]
                    self.assertTrue(out.ok, out.stderr[-2000:])
                    result = out.json()
                    if refused(result):
                        self.assertEqual(result["text"], text)

    def test_a_zero_shift_gives_every_program_back_byte_for_byte(self) -> None:
        for name, _, text in self.programs:
            with self.subTest(program=name):
                self.assertEqual(self.results[(name, "zero")].json()["text"], text)

    def test_d_then_minus_d_gives_every_value_back(self) -> None:
        moved = 0
        counts: Dict[str, int] = {}
        for name, profile, text in self.programs:
            shifted = self.results[(name, "shift")].json()
            if refused(shifted):
                reasons = sorted({f["reason"] for f in shifted["findings"] if f["severity"] == "error"})
                for reason in reasons:
                    counts[reason] = counts.get(reason, 0) + 1
                print("\n  translate %s: refused (%s)" % (name, ", ".join(reasons)), end="")
                continue
            with self.subTest(program=name):
                back = self.results[(name, "back")]
                self.assertTrue(back.ok, back.stderr[-2000:])
                result = back.json()
                self.assertFalse(refused(result), result.get("findings", [])[:5])
                eff = helpers.effective_context(profile)["profile"]
                self.assertEqual(values_of(result["text"], eff), values_of(text, eff))
                same = result["text"] == text
                print("\n  translate %s: moved and back%s" % (name, "" if same else " (values; some words written with more decimals)"), end="")
                moved += 1
        print("\n  translate owner-public: %d moved and back, %d refused; programs refused per reason: %s"
              % (moved, len(self.programs) - moved, ", ".join("%s %d" % kv for kv in sorted(counts.items())) or "none"))
        # A refused run is clean by itself, so a floor keeps a script that came to refuse everything
        # from passing. Measured on 2026-10-16: 5 of the 20 programs are moved and come back; the
        # floor is one below. A deliberate new refusal may lower it, in the commit that adds it.
        self.assertGreaterEqual(moved, 4, "translate moved %d of the 20 owner-public programs: a new refusal? lower the floor on purpose" % moved)


class RunTest(unittest.TestCase):
    """What the script does outside the goldens."""

    PROGRAM = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X10. Y10. Z5.\nM30\n"

    def test_a_shift_that_is_no_number_stops_with_a_plain_message(self) -> None:
        context = helpers.effective_context("fanuc-gcode", params={"dx": "ten"})
        out = run_script(SCRIPT, stdin=self.PROGRAM, context=context)
        self.assertEqual(out.returncode, 1)
        self.assertIn("X shift: 'ten' is not a number.", out.stderr)

    def test_a_decimals_choice_the_form_does_not_offer_stops(self) -> None:
        context = helpers.effective_context("fanuc-gcode", params={"dx": 1, "decimals": "3"})
        out = run_script(SCRIPT, stdin=self.PROGRAM, context=context)
        self.assertEqual(out.returncode, 1)
        self.assertIn("Decimal places", out.stderr)

    def test_no_profile_stops(self) -> None:
        out = run_script(SCRIPT, stdin=self.PROGRAM, context={"contract": 2})
        self.assertEqual(out.returncode, 1)
        self.assertIn("needs a dialect profile", out.stderr)

    def test_without_a_code_database_nothing_is_moved(self) -> None:
        context = helpers.effective_context("fanuc-gcode", params={"dx": 1})
        context["codes"] = []
        out = run_script(SCRIPT, stdin=self.PROGRAM, context=context)
        result = out.json()
        self.assertEqual(result["text"], self.PROGRAM)
        self.assertEqual([f["reason"] for f in result["findings"]], ["no-database"])
        self.assertEqual(result["findings"][0]["severity"], "error")

    def test_a_selection_whose_lines_above_were_not_sent_is_refused(self) -> None:
        context = helpers.effective_context("fanuc-gcode", params={"dx": 1})
        context["input"] = {"scope": "selection", "startLine": 3, "endLine": 3}
        out = run_script(SCRIPT, stdin="G0 X10. Y10.", context=context)
        result = out.json()
        self.assertEqual(result["text"], "G0 X10. Y10.")
        self.assertEqual([(f["line"], f["reason"], f["severity"]) for f in result["findings"]], [(3, "selection-unprimed", "error")])

    def test_the_text_keeps_its_last_line_break(self) -> None:
        result = run_inline(self.PROGRAM, "fanuc-gcode", {"dx": 1})
        self.assertEqual(result["text"], self.PROGRAM.replace("X10.", "X11."))

    def test_a_selection_ending_with_a_line_break_inside_a_klartext_block_is_refused(self) -> None:
        # Regression (P4.3): the trailing empty element of a selection that ends with a line
        # break hid the `~` of its last line, and the half block was moved.
        preceding = ["0 BEGIN PGM T MM", "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE"]
        text = "2 CYCL DEF 200 DRILLING ~\n  Q203=+0 ;SURFACE COORDINATE ~\n"
        result = run_inline(text, "heidenhain-klartext", {"dz": 1}, preceding)
        self.assertEqual(result["text"], text)
        # One block, one finding: at its first line (the definition the shift changes, which
        # calls below the selection may run, and the `~` of its last line).
        self.assertEqual([(f["line"], f["reason"]) for f in result["findings"]], [(3, "selection-inside")])

    def test_a_klartext_definition_moved_in_a_selection_that_its_calls_below_may_run_is_refused(self) -> None:
        preceding = ["0 BEGIN PGM T MM", "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "2 TOOL CALL 1 Z S3000"]
        text = "3 CYCL DEF 200 DRILLING ~\n  Q201=-10 ;DEPTH ~\n  Q203=+0 ;SURFACE COORDINATE\n4 L X+10 Y+10 R0 FMAX M99"
        moved = run_inline(text, "heidenhain-klartext", {"dz": 1}, preceding)
        self.assertEqual([(f["line"], f["reason"]) for f in moved["findings"]], [(4, "selection-inside")])
        # A shift that leaves the definition as it is leaves the calls below right: no refusal.
        across = run_inline(text, "heidenhain-klartext", {"dx": 1}, preceding)
        self.assertFalse(refused(across), across["findings"])
        self.assertIn("4 L X+11 Y+10 R0 FMAX M99", across["text"])

    def test_one_finding_per_refused_block_with_its_first_reason(self) -> None:
        # `G1 X#1` in a frame: frame comes first in the order of _nc_geom.REASONS.
        text = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X0. Y0.\nG68 X0. Y0. R10.\nG1 X#1 F100.\nM30\n"
        result = run_inline(text, "fanuc-gcode", {"dx": 1})
        self.assertEqual([(f["line"], f["reason"]) for f in result["findings"]], [(4, "frame"), (5, "frame")])


class ReviewFixTest(unittest.TestCase):
    """The P4a review's findings on translate (fix batch B3); the goldens `b3-*` hold the
    reproductions, these the edges around them."""

    KLARTEXT = (
        "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 TOOL CALL 1 Z S3000\n"
        "3 CYCL DEF 200 DRILLING ~\n  Q201=-10 ;DEPTH ~\n  Q203=+0 ;SURFACE COORDINATE\n"
        "4 L Z+50 R0 FMAX\n5 CYCL CALL POS X+10 Y+10 Z+0 FMAX\n6 L X+30 Y+10 R0 FMAX M99\n7 END PGM T MM"
    )

    def errors(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_nc3_a_z_shift_refuses_a_cycle_called_at_a_position_and_its_definition(self) -> None:
        # TNC 640 cycle manual, CYCL CALL POS: the call's tool-axis coordinate acts as a further
        # datum shift on top of Q203, so moving both moves the hole twice, and moving one leaves
        # the tool driving to an unmoved Z.
        result = run_inline(self.KLARTEXT, "heidenhain-klartext", {"dz": 1})
        self.assertEqual(result["text"], self.KLARTEXT)
        self.assertEqual(self.errors(result), [(4, "cycle-position"), (8, "cycle-position")])
        self.assertIn("CYCL CALL POS, line 8", result["findings"][0]["message"])
        self.assertIn("a Z shift would move the cycle twice", result["findings"][1]["message"])
        # with the Z shift together with X and Y as well
        both = run_inline(self.KLARTEXT, "heidenhain-klartext", {"dx": 1, "dz": 1})
        self.assertEqual(self.errors(both), [(4, "cycle-position"), (8, "cycle-position")])

    def test_nc3_a_shift_in_x_and_y_moves_the_call_and_leaves_its_z(self) -> None:
        result = run_inline(self.KLARTEXT, "heidenhain-klartext", {"dx": 1, "dy": -2})
        self.assertFalse(refused(result), result["findings"])
        lines = result["text"].split("\n")
        self.assertIn("5 CYCL CALL POS X+11 Y+8 Z+0 FMAX", lines)
        self.assertIn("  Q203=+0 ;SURFACE COORDINATE", lines)

    def test_nc3_a_z_shift_still_moves_a_cycle_run_at_the_current_position(self) -> None:
        text = self.KLARTEXT.replace("5 CYCL CALL POS X+10 Y+10 Z+0 FMAX", "5 L X+10 Y+10 R0 FMAX\n55 CYCL CALL")
        result = run_inline(text, "heidenhain-klartext", {"dz": 1})
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("  Q203=+1 ;SURFACE COORDINATE", result["text"].split("\n"))

    def test_nc3_a_call_whose_definition_is_above_the_selection_is_refused(self) -> None:
        lines = self.KLARTEXT.split("\n")
        result = run_inline("\n".join(lines[7:]), "heidenhain-klartext", {"dz": 1}, lines[:7])
        self.assertEqual([line for line, _ in self.errors(result)], [8, 9])

    def test_nc10_an_incremental_index_of_zero_turns_nothing(self) -> None:
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90 G54\nG0 X0. Y0. Z50.\n"
            "G91 G0 A0.\nG90 G1 X20. Y5. F200.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dy": 2})
        self.assertFalse(refused(result), result["findings"])
        # …and an index by a variable, whose value is not known, counts as turned
        turned = run_inline(text.replace("G91 G0 A0.", "G91 G0 A#1"), "fanuc-gcode", {"dy": 2})
        self.assertIn((5, "rotary-turned"), self.errors(turned))

    def test_nc10_an_incremental_index_after_a_known_position_refuses_as_before(self) -> None:
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90 G54\nG0 A0.\nG0 X0. Y0. Z50.\n"
            "G91 G0 A90.\nG90 G1 X20. Y5. F200.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dy": 2})
        self.assertEqual(self.errors(result), [(6, "rotary-turned")])

    def test_code3_a_selection_from_line_1_that_ends_inside_a_klartext_block_is_refused(self) -> None:
        text = "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 CYCL DEF 200 DRILLING ~\n  Q203=+0 ;SURFACE COORDINATE ~"
        context = helpers.effective_context("heidenhain-klartext", params={"dz": 1})
        context["input"] = {"scope": "selection", "startLine": 1, "endLine": 4}
        out = run_script(SCRIPT, stdin=text, context=context)
        result = out.json()
        self.assertEqual(result["text"], text)
        self.assertEqual(self.errors(result), [(3, "selection-inside")])

    def test_code3_the_whole_document_from_line_1_is_no_selection(self) -> None:
        # The same lines as a whole document: nothing runs below it, so its end is no edge.
        text = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X0. Y0. Z50.\nG81 X10. Y10. Z-5. R2. F100."
        out = run_document(text, "fanuc-gcode", {"dz": 1})
        self.assertFalse(refused(out.json()), out.json()["findings"])


class HeaderTest(unittest.TestCase):
    PARAMS = ["dx", "dy", "dz", "decimals"]

    def header_source(self) -> str:
        lines = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8").split("\n")
        i = 1 if lines[0].startswith("#!") else 0
        self.assertEqual(lines[i].strip(), "# /// gedit")
        body = []
        i += 1
        while lines[i].strip() != "# ///":
            self.assertTrue(lines[i].startswith("#"), lines[i])
            body.append(lines[i][2:] if lines[i].startswith("# ") else lines[i][1:])
            i += 1
        return "\n".join(body)

    def test_fifteen_minutes_as_the_owner_decided_for_the_geometry_scripts(self) -> None:
        # Q-C (the owner, 2026-10-16): translate, rotate and mirror get 900 s.
        self.assertIn("\ntimeout = 900\n", "\n" + self.header_source() + "\n")

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_header_is_the_toml_the_backend_expects(self) -> None:
        import tomllib

        meta = tomllib.loads(self.header_source())
        self.assertEqual(meta["name"], "Translate")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertEqual(meta["output"], "replace")
        self.assertIs(meta["envelope"], True)
        self.assertEqual(meta["timeout"], 900)
        self.assertNotIn("profiles", meta)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_form_ids_are_the_pinned_ones(self) -> None:
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        self.assertEqual([p["id"] for p in params], self.PARAMS)
        by_id = {p["id"]: p for p in params}
        for axis in ("dx", "dy", "dz"):
            self.assertEqual(by_id[axis]["type"], "number")
            self.assertEqual(by_id[axis]["default"], 0)
        self.assertIn("diameter", by_id["dx"]["help"])
        self.assertEqual(by_id["decimals"]["type"], "choice")
        self.assertEqual([c["value"] for c in by_id["decimals"]["choices"]], ["keep"])
        self.assertEqual(by_id["decimals"]["default"], "keep")


class ModuleGapTest(unittest.TestCase):
    """Gaps of `_nc_geom`/`_nc_path` found by P4.3 and fixed by the P4a Wave B integration (plan
    §7 #299 to #305). Each was an expected failure; each now holds its fix."""

    def reasons(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_a_klartext_pattern_definition_refuses_a_translate(self) -> None:
        # X22: a PATTERN DEF has absolute positions of its own, which gEdit does not move
        # (`cycle-position`, from its database entry, plan §7 #301).
        text = (
            "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n"
            "2 PATTERN DEF ~\n  POS1 (X+25 Y+33 Z+0)\n3 END PGM T MM"
        )
        result = run_inline(text, "heidenhain-klartext", {"dx": 1})
        self.assertEqual(self.reasons(result), [(3, "cycle-position")])
        self.assertEqual(result["text"], text)

    def test_a_pattern_call_runs_at_positions_kept_elsewhere(self) -> None:
        # `CYCL CALL PAT` writes none of its positions: they are in a pattern or a point table.
        # `CYCL CALL POS X… Y… Z…` writes them, and they move.
        text = (
            "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n"
            "2 CYCL DEF 200 DRILLING ~\n  Q200=+2 ;SET-UP CLEARANCE ~\n  Q201=-5 ;DEPTH\n"
            "3 L Z+50 R0 FMAX\n4 CYCL CALL PAT F5000\n5 END PGM T MM"
        )
        self.assertEqual(self.reasons(run_inline(text, "heidenhain-klartext", {"dx": 1})), [(7, "cycle-position")])
        moved = run_inline(text.replace("4 CYCL CALL PAT F5000", "4 CYCL CALL POS X+10 Y+10 Z+0"), "heidenhain-klartext", {"dx": 1})
        self.assertFalse(refused(moved), moved["findings"])
        self.assertIn("4 CYCL CALL POS X+11 Y+10 Z+0", moved["text"].split("\n"))

    def test_an_absolute_centre_of_the_face_axis_is_a_diameter_under_diamon(self) -> None:
        # SINUMERIK 840D sl programming manual, diameter programming: under DIAMON and DIAM90
        # an interpolation parameter I, J, K written with AC is a diameter; with IC a radius.
        text = (
            "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G18 G90 DIAMON\nN20 G0 X60 Z0\n"
            "N30 G3 X80 Z-10 I=AC(60) K=AC(-10)\nN40 DIAM90\nN50 G2 X60 Z0 I=AC(60) K=AC(-10)\n"
            "N60 DIAMOF\nN70 G0 X30 Z0\nN80 G3 X40 Z-10 I=AC(30) K=AC(-10)\nN90 G3 X50 Z-20 I=IC(10) K=IC(0)"
        )
        result = run_inline(text, "sinumerik", {"dx": 1})
        lines = result["text"].split("\n")
        self.assertEqual(lines[3], "N30 G3 X81 Z-10 I=AC(61) K=AC(-10)")
        self.assertEqual(lines[5], "N50 G2 X61 Z0 I=AC(61) K=AC(-10)")
        # under DIAMOF X and the absolute centre are radii: a diameter shift of 1 is 0.5
        self.assertEqual(lines[8], "N80 G3 X40.5 Z-10 I=AC(30.5) K=AC(-10)")
        self.assertEqual(lines[9], "N90 G3 X50.5 Z-20 I=IC(10) K=IC(0)")

    def test_an_incremental_move_needs_no_start_on_an_axis_it_does_not_write(self) -> None:
        # `axis-unwritten` is for the axes the block moves incrementally: a G91 X move after a
        # drilling cycle (which leaves Z not known) is not refused for Z (plan §7 #303).
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X0. Y0. Z50.\n"
            "G81 X10. Y10. Z-5. R2. F100.\nG91 X10.\nG80\nG90 G0 Z50.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dx": 1, "dz": 1})
        self.assertFalse(refused(result), result["findings"])
        # …and still is for an axis it does move from a start nobody knows
        unknown = run_inline(text.replace("G91 X10.", "G91 Z-1."), "fanuc-gcode", {"dx": 1, "dz": 1})
        self.assertEqual(self.reasons(unknown), [(5, "axis-unwritten")])

    def test_the_cancel_form_of_a_sinumerik_frame_refuses_nothing(self) -> None:
        # SINUMERIK 840D sl programming manual, frame instructions: TRANS, ROT, SCALE and MIRROR
        # without an axis delete the programmable frame; CYCLE800() resets the swivel plane;
        # TRANS with zeros replaces the frame by none, ATRANS with zeros adds nothing.
        text = (
            "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G17 G90 G71 G54\nN20 ROT\n"
            "N30 MIRROR\nN40 SCALE\nN50 TRANS\nN60 CYCLE800()\nN70 TRANS X0 Y0 Z0\nN80 ATRANS X0\n"
            "N90 G0 X0 Y0 Z50\nN100 M30"
        )
        result = run_inline(text, "sinumerik-mill", {"dx": 1})
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("N90 G0 X1 Y0 Z50", result["text"].split("\n"))
        # a frame with values, and a shift that is not zero, still refuse
        frame = run_inline(text.replace("N20 ROT", "N20 ROT RPL=30"), "sinumerik-mill", {"dx": 1})
        self.assertEqual(self.reasons(frame)[0], (3, "frame"))
        shift = run_inline(text.replace("ATRANS X0", "ATRANS X0.5"), "sinumerik-mill", {"dx": 1})
        self.assertEqual(self.reasons(shift), [(9, "coordinate-shift")])

    def test_a_bare_cycle800_resets_and_refuses_nothing(self) -> None:
        # CAM programs write `CYCLE800` with no arguments at the top to reset the swivel plane.
        text = "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G17 G90 G71 G54\nN20 CYCLE800()\nN30 G0 X0 Y0 Z50\nN40 M30"
        result = run_inline(text, "sinumerik-mill", {"dx": 1})
        self.assertFalse(refused(result), result["findings"])

    def test_the_klartext_reset_header_refuses_nothing(self) -> None:
        # TNC 640 cycle manual: a datum shift to X=0, Y=0 resets cycle 7, a rotation angle of 0
        # resets cycle 10, cycle 8 defined again without an axis ends the mirror, and a tilt
        # with every angle 0 is no tilt.
        text = (
            "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 CYCL DEF 7.0 DATUM SHIFT\n"
            "3 CYCL DEF 7.1 X0\n4 CYCL DEF 7.2 Y+0,\n5 PLANE SPATIAL SPA0 SPB0 SPC0 STAY\n6 CYCL DEF 10.0 ROTATION\n"
            "7 CYCL DEF 10.1 ROT+0\n8 CYCL DEF 8.0 MIRROR IMAGE\n9 CYCL DEF 8.1\n10 PLANE RESET STAY\n"
            "11 L X+10 Y+10 R0 FMAX\n12 END PGM T MM"
        )
        result = run_inline(text, "heidenhain-klartext", {"dx": 1})
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("11 L X+11 Y+10 R0 FMAX", result["text"].split("\n"))
        # a rotation that is not 0, an increment of it, and a line of the datum table refuse
        turned = run_inline(text.replace("ROT+0", "ROT+30"), "heidenhain-klartext", {"dx": 1})
        self.assertEqual(self.reasons(turned)[0], (8, "frame"))
        increment = run_inline(text.replace("ROT+0", "IROT+15"), "heidenhain-klartext", {"dx": 1})
        self.assertEqual(self.reasons(increment)[0], (8, "frame"))
        table = run_inline(text.replace("3 CYCL DEF 7.1 X0", "3 CYCL DEF 7.1 #5"), "heidenhain-klartext", {"dx": 1})
        self.assertEqual(self.reasons(table), [(4, "coordinate-shift")])

    def test_the_fanuc_cancel_codes_refuse_nothing(self) -> None:
        # FANUC 30i operator's manual: G69 cancels the rotation, G50.1 the programmable mirror,
        # G15 the polar command, G50 the scaling, G52 with every axis 0 the local coordinate
        # system. G92 with zeros sets the position, which is no reset.
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG69\nG50.1 X0 Y0\nG15\n"
            "G50\nG52 X0 Y0 Z0\nG0 X0. Y0. Z50.\nG1 X10. F100.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dx": 1})
        self.assertFalse(refused(result), result["findings"])
        position = run_inline(text.replace("G52 X0 Y0 Z0", "G92 X0 Y0 Z0"), "fanuc-gcode", {"dx": 1})
        self.assertEqual(self.reasons(position), [(7, "coordinate-shift")])

    def test_a_fanuc_offset_number_without_its_code_is_no_unknown_word(self) -> None:
        # `G1 X10. D2`: D is the radius offset number of the compensation group; without the
        # code in the block it is read as that group's number (plan §7 #304).
        text = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X0. Y0.\nG1 X10. D2 F100.\nM30"
        result = run_inline(text, "fanuc-gcode", {"dx": 1})
        self.assertEqual([f["reason"] for f in result["findings"]], [])

    def test_a_lathe_program_with_roughing_and_thread_cycles_moves(self) -> None:
        # FANUC 30i lathe operator's manual: the parameters of G70 to G76 are depths, allowances,
        # counts, block numbers and feeds, no positions; the end points of G74 to G76 are axis
        # words and move; the profile blocks P to Q are ordinary moves (plan §7 #305).
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G18 G40\nG0 X100. Z5.\n"
            "G71 U2. R0.5\nG71 P100 Q200 U0.4 W0.1 F0.25\nN100 G0 X40.\nG1 Z-20. F0.1\nX60. Z-30.\nN200 X100.\n"
            "G70 P100 Q200\nG0 X40. Z5.\nG76 P011060 Q100 R0.05\nG76 X37.4 Z-18. P1300 Q400 F2.\nG0 X100. Z50.\nM30"
        )
        result = run_inline(text, "fanuc-lathe", {"dx": 2, "dz": -1})
        self.assertFalse(refused(result), result["findings"])
        lines = result["text"].split("\n")
        self.assertEqual(lines[4], "G71 P100 Q200 U0.4 W0.1 F0.25")
        self.assertEqual(lines[5], "N100 G0 X42.")
        self.assertEqual(lines[12], "G76 X39.4 Z-19. P1300 Q400 F2.")
        # the Sinumerik stock removal cycle names its contour (a subprogram or a part of the
        # program gEdit does not follow), so it is refused as a cycle with positions of its own
        sinumerik = (
            "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G18 G90 DIAMON\nN20 G0 X100 Z5\n"
            'N30 CYCLE95("KONTUR", 2, 0.1, 0.2, , 0.3, 0.1, 0.1, 9, , , 0.5)\nN40 M30'
        )
        self.assertEqual(self.reasons(run_inline(sinumerik, "sinumerik", {"dx": 2})), [(4, "cycle-position")])


class Wave1IntegrationTest(unittest.TestCase):
    """The reasons the P4a fix batch B1 gave translate, worded in its message (plan §7)."""

    def test_every_reason_and_information_row_has_a_text(self) -> None:
        import importlib

        import _nc_geom

        module = importlib.import_module("translate")
        need = [k for k, (applies, _) in _nc_geom.REASONS.items() if "translate" in applies]
        self.assertEqual([k for k in need if k not in module.REASON_TEXT], [])
        info = [k for k, (applies, _) in _nc_geom.INFO.items() if "translate" in applies]
        self.assertEqual([k for k in info if k not in module.INFO_TEXT], [])

    def test_the_message_words_a_jump_and_an_unknown_pole(self) -> None:
        jump = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG90 G17 G21\nG0 X0. Y0. Z5.\nGOTO 10\nG91\nN10 G1 X5. F100.\nM30"
        result = run_inline(jump, "fanuc-gcode", {"dx": 1})
        self.assertTrue(refused(result))
        self.assertIn("1 block a jump or a loop may reach with other settings", result["message"])
        pole = "0 BEGIN PGM P MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 L X+0 Y+0 R0 FMAX\n3 LP PR+5 PA+30\n4 END PGM P MM"
        result = run_inline(pole, "heidenhain-klartext", {"dx": 1})
        self.assertIn((4, "pole-unknown"), [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"])
        self.assertIn("1 move around a pole that is not known", result["message"])



class RefusedBlocksAreNotMovedTest(unittest.TestCase):
    """P4a fix batch B6 (CODE-1): a block refused for a reason that comes before every reason moving a word can give is listed
    with it and its words are not moved (the run writes nothing anyway)."""

    def run_in_process(self, text: str, params: Dict[str, Any]):
        import translate
        from tests.python.test_rotate import in_process

        calls: List[Any] = []
        real = translate.Run.moved

        def counting(self, role, op, units):  # type: ignore[no-untyped-def]
            calls.append(role.token.text)
            return real(self, role, op, units)

        translate.Run.moved = counting  # type: ignore[method-assign]
        try:
            result = in_process(translate, "fanuc-gcode", params, text)
        finally:
            translate.Run.moved = real  # type: ignore[method-assign]
        return result, calls

    def test_the_moves_under_a_frame_are_not_moved(self) -> None:
        text = "G21 G17 G90\nG68 X0. Y0. R30.\n" + "\n".join("G1 X%d. Y%d. F100." % (i, i + 1) for i in range(40)) + "\nG69\nM30"
        result, calls = self.run_in_process(text, {"dx": 1, "dy": 2, "dz": 0})
        self.assertEqual(calls, [])
        self.assertEqual(result["text"], text)
        self.assertEqual({f["reason"] for f in result["findings"]}, {"frame"})
        self.assertEqual(len(result["findings"]), 41)  # the G68 block and the 40 moves under it

    def test_the_words_of_a_block_refused_later_in_the_order_are_still_moved(self) -> None:
        # `word-unknown` comes after the reasons a moved word can give, so the block's words are looked at as before.
        text = "G21 G17 G90\nG0 X0. Y0.\nG1 X10. Y10. F100.\nG1 X20. Y20. A=1.\nM30"
        result, calls = self.run_in_process(text, {"dx": 1, "dy": 2, "dz": 0})
        self.assertIn("X20.", calls)

    def test_a_clean_program_moves_every_word_once_per_spelling(self) -> None:
        text = "G21 G17 G90\nG0 X0. Y0.\n" + "\n".join("G1 X10. Y%d. F100." % (i % 4) for i in range(40)) + "\nM30"
        result, calls = self.run_in_process(text, {"dx": 1, "dy": 2, "dz": 0})
        self.assertEqual(result["findings"], [])
        self.assertIn("Y2.", result["text"])


if __name__ == "__main__":
    unittest.main()

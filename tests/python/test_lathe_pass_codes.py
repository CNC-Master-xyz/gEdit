"""v1.2.0 NC fix round, batch D3 (code data): what the scripts read from the code data.

* **NCR-4.** The default lathe profile (``fanuc-lathe``, G-code system A, no machine) reads
  ``G77``, ``G78`` and ``G79`` the way system B does: single passes (``path: 'cycle'``) whose
  taper ``R`` is a length along X (``G77``, ``G78``) or Z (``G79``), and ``G78``'s ``F`` is the
  thread lead (``pitchFeed``). Before, system A had the three numbers without a description, so
  a multiply of X scaled the end point and kept the taper, the lathe Z mirror wrote a thread for
  the other hand, and the extents read a pass as a straight move.
* **NCR-9b.** A Sinumerik cycle's depth given absolute and from the reference plane (``DP`` and
  ``DPR``, ``FDEP`` and ``FDPR``) names its twin (``CodeParam.twin``), and the scripts get the
  member with the code data, exactly as the loader keeps it.

Run from the repository root::

    python3 -m pytest tests/python/test_lathe_pass_codes.py -q
"""

from __future__ import annotations

import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()
import extents  # noqa: E402  (the bundled folder is on sys.path from here on)


def run(script, text, profile_id, params, variant=None):
    """One run of a bundled script on an inline program, as a whole document."""
    context = helpers.effective_context(profile_id, variant=variant) if variant else helpers.effective_context(profile_id)
    context["params"] = params
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    out = helpers.run_script(script + ".py", stdin=text, context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


def errors(result):
    return [(f["line"], f["reason"]) for f in result.get("findings", []) if f["severity"] == "error"]


def findings(result):
    """``(line, reason)`` of every finding: address arithmetic leaves a block it refuses as
    written and says why in a warning, the geometry transforms refuse the run with an error."""
    return [(f["line"], f["reason"]) for f in result.get("findings", [])]


def lines_of(result):
    return result["text"].split("\n")


def entry(profile_id, code, variant=None):
    context = helpers.effective_context(profile_id, variant=variant) if variant else helpers.effective_context(profile_id)
    return next((e for e in context["codes"] if e.get("code") == code), None)


class SystemAPassCodesTest(unittest.TestCase):
    """NCR-4: system A's G77-G79 are whole passes with a taper, and G78 is a thread."""

    #: (code, the axis its taper R lies along, the other lathe axis, its feed or lead).
    PASSES = (("G77", "X", "Z", "F0.2"), ("G78", "X", "Z", "F1.5"), ("G79", "Z", "X", "F0.2"))

    def test_the_data_describes_them_as_system_b_does(self):
        for code, along, _other, _feed in self.PASSES:
            with self.subTest(code=code):
                a = entry("fanuc-lathe", code)
                b = entry("fanuc-lathe", code, variant=("gcodeSystem", "B"))
                self.assertEqual(a["sets"], b["sets"])
                self.assertEqual(a["sets"].get("path"), "cycle")
                self.assertEqual(a["params"], b["params"])
                self.assertEqual([p.get("lengthAlong") for p in a["params"] if p["address"] == "R"], [along])
                self.assertEqual(a.get("pitchFeed"), b.get("pitchFeed"))
                self.assertNotIn("pitchFeedAmbiguous", a)
        self.assertIs(entry("fanuc-lathe", "G78").get("pitchFeed"), True)

    def test_a_multiply_of_the_taper_axis_refuses_both_pass_blocks(self):
        # The review's repro: default lathe profile, multiply X by 2. Before the fix the run wrote
        # `G77 X100. Z-20. R-2.` / `X96.` without a word: the end point doubled, the taper kept.
        text = "G0 X60. Z2.\nG77 X50. Z-20. R-2. F0.2\nX48."
        result = run("address_arithmetic", text, "fanuc-lathe", {"operation": "multiply", "operand": 2, "addresses": ["X"]})
        self.assertEqual(lines_of(result), ["G0 X120. Z2.", "G77 X50. Z-20. R-2. F0.2", "X48."])
        self.assertEqual(findings(result), [(2, "not-scaled"), (3, "not-scaled")])
        # The same for the threading and the facing pass, each along its own axis.
        for code, along, _other, feed in self.PASSES[1:]:
            with self.subTest(code=code):
                end = "X50. Z-20." if along == "X" else "X20. Z-2."
                again = "X48." if along == "X" else "Z-3."
                text = "G0 X60. Z2.\n%s %s R-2. %s\n%s" % (code, end, feed, again)
                result = run("address_arithmetic", text, "fanuc-lathe", {"operation": "multiply", "operand": 2, "addresses": [along]})
                self.assertEqual(lines_of(result)[1:3], text.split("\n")[1:3])
                self.assertEqual(findings(result), [(2, "not-scaled"), (3, "not-scaled")])

    def test_the_lathe_z_mirror_refuses_a_g78_as_a_thread(self):
        # Before the fix the mirror wrote the thread mirrored in Z, which cuts the other hand.
        text = "G18 G21\nG0 X44. Z6.\nG78 X39.2 Z-20. F1.5\nX38.6\nG0 X60. Z20.\nM30"
        result = run("mirror", text, "fanuc-lathe", {"about": "z", "z0": 0})
        self.assertEqual(result["text"], text)
        self.assertEqual([e for e in errors(result) if e[1] == "thread"], [(3, "thread"), (4, "thread")])

    def test_the_extents_reach_the_taper_start(self):
        # A taper pass cuts from the end point plus the taper: X50. with R-2. (a radius) starts at
        # X46. Read as a straight move, the extents stopped at X50.
        w = walk("G0 X60. Z2.\nG77 X50. Z-20. R-2. F0.2\nM30")
        self.assertEqual(extent(w, "X"), ("46", "60", 0))
        self.assertEqual(extent(w, "Z"), ("-20", "2", 0))
        # The facing pass's taper lies along Z.
        w = walk("G0 X64. Z3.\nG79 X20. Z-1. R-5. F0.2\nM30")
        self.assertEqual(extent(w, "Z"), ("-6", "3", 0))


def walk(text, profile_id="fanuc-lathe"):
    """The `Extents` walker after ``text``, on the profile's own defaults (no machine)."""
    context = helpers.effective_context(profile_id)
    cp = gedit_nc.compile_profile(context["profile"])
    w = extents.Extents(context, cp)
    state = None
    for number, line in enumerate(text.split("\n"), 1):
        state = w.line(line, number, state, record=True)
    w.settle_held()
    return w


def extent(w, axis):
    """``(min, max, unresolved)`` of one axis in the program scope, values as text."""
    r = w.program.ranges.get(axis)
    if r is None:
        return None
    lo = None if r.low is None else extents.text_of(r.low, 4)
    hi = None if r.high is None else extents.text_of(r.high, 4)
    return (lo, hi, r.unresolved)


class SinumerikDepthTwinsTest(unittest.TestCase):
    """NCR-9b: the depth twins reach the scripts with the code data (`CodeParam.twin`)."""

    WANT = {
        "CYCLE81": {"DP": "DPR", "DPR": "DP"},
        "CYCLE82": {"DP": "DPR", "DPR": "DP"},
        "CYCLE83": {"DP": "DPR", "DPR": "DP", "FDEP": "FDPR", "FDPR": "FDEP"},
        "CYCLE84": {"DP": "DPR", "DPR": "DP"},
        "CYCLE840": {"DP": "DPR", "DPR": "DP"},
        "CYCLE85": {"DP": "DPR", "DPR": "DP"},
        "CYCLE86": {"DP": "DPR", "DPR": "DP"},
        "CYCLE87": {"DP": "DPR", "DPR": "DP"},
        "CYCLE88": {"DP": "DPR", "DPR": "DP"},
        "CYCLE89": {"DP": "DPR", "DPR": "DP"},
        "SLOT1": {"_DP": "_DPR", "_DPR": "_DP"},
        "SLOT2": {"_DP": "_DPR", "_DPR": "_DP"},
    }

    def test_every_twin_pair_is_in_the_context(self):
        codes = helpers.effective_context("sinumerik")["codes"]
        got = {}
        for e in codes:
            twins = {p["address"]: p["twin"] for p in e.get("params") or [] if isinstance(p, dict) and "twin" in p}
            if twins:
                got[e["code"]] = twins
        self.assertEqual(got, self.WANT)

    def test_a_pair_is_an_absolute_position_and_its_relative_depth(self):
        codes = {e["code"]: e for e in helpers.effective_context("sinumerik")["codes"]}
        for code, pairs in self.WANT.items():
            params = {p["address"]: p for p in codes[code]["params"]}
            for address, twin in pairs.items():
                with self.subTest(code=code, address=address):
                    self.assertEqual(params[twin]["twin"], address)
                    self.assertEqual(
                        sorted([gedit_nc.position_of(params[address]), gedit_nc.position_of(params[twin])]),
                        ["none", "tool-axis"],
                    )
            self.assertEqual(codes[code].get("review"), "pending")


if __name__ == "__main__":
    unittest.main()

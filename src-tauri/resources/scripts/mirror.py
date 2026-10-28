#!/usr/bin/env python3
# /// gedit
# name = "Mirror"
# description = "Mirrors a milling program's path in the XY plane: in X, in Y, or about a line at an angle. On a turning program, mirrors it in Z for the counter spindle. Points, arc centres and incremental moves mirror, and G2/G3 and G41/G42 swap. The result says that climb milling became conventional milling (on a lathe: set the tool nose direction for the counter spindle). If one block cannot be mirrored safely, nothing is changed and every such block is listed."
# input = "selection-or-document"
# output = "replace"
# timeout = 900
# envelope = true
#
# [[params]]
# id = "about"
# type = "choice"
# label = "Mirror"
# help = "Automatic mirrors a turning program in Z for the counter spindle and a milling program in X. In X flips the X values about the line through Point X parallel to Y; in Y flips the Y values about the line through Point Y parallel to X. A turning program can only be mirrored in Z, for the counter spindle."
# default = "auto"
# choices = [
#   { label = "Automatic (in Z on a turning program, in X on a milling program)", value = "auto" },
#   { label = "In X (about a line parallel to Y)", value = "y-axis" },
#   { label = "In Y (about a line parallel to X)", value = "x-axis" },
#   { label = "About a line at an angle", value = "line" },
#   { label = "In Z for the counter spindle (turning)", value = "z" }
# ]
#
# [[params]]
# id = "px"
# type = "number"
# label = "Point X"
# help = "The X the mirror line goes through, in the program's units (in X: X' = 2 x Point X - X)."
# default = 0
# decimals = 6
#
# [[params]]
# id = "py"
# type = "number"
# label = "Point Y"
# help = "The Y the mirror line goes through, in the program's units (in Y: Y' = 2 x Point Y - Y)."
# default = 0
# decimals = 6
#
# [[params]]
# id = "angle"
# type = "number"
# label = "Line angle (degrees)"
# help = "Only for a line at an angle: its angle from the X axis, counter-clockwise positive. 0, 90, 180 and 270 are exact; any other angle rounds the words and checks the arcs."
# default = 0
# decimals = 6
#
# [[params]]
# id = "z0"
# type = "number"
# label = "Mirror Z (turning)"
# help = "Only for the Z mirror: the Z the program is mirrored about (Z' = 2 x Mirror Z - Z)."
# default = 0
# decimals = 6
#
# [[params]]
# id = "decimals"
# type = "choice"
# label = "Decimal places"
# help = "Only for a line at an angle that is not a multiple of 90 degrees. As written keeps each word's own decimals, with at least 3 in mm and 4 in inch; 3 or 4 writes every rounded word with a point with that many (an inch program keeps at least 4). A word without a point stays whole increments where the machine reads it in increments; where the machine reads numbers as written, a rounded word gets a point and 3 decimals in mm, 4 in inch."
# default = "keep"
# choices = [
#   { label = "As written", value = "keep" },
#   { label = "3", value = "3" },
#   { label = "4", value = "4" }
# ]
# ///
"""Mirror (Phase 4 plan §5 P4a, P4.4; AD-41 to AD-44; exit criteria X21 and X22).

Mirrors the path of a program and hands it back through the ``envelope`` output. The script
walks the program with the path tracker (``_nc_path``) and asks the transform rules
(``_nc_geom``) what every word is; it keeps no list of codes of its own. The golden format,
the form ids and the message are ``tests/fixtures/scripts/README.md``, "The geometry goldens".

On a milling program (Q4-3: the XY plane only)
-----------------------------------------------
``about`` chooses the mirror line: ``y-axis`` (the line through ``px`` parallel to Y, so X
flips: ``X' = 2·px − X``), ``x-axis`` (through ``py`` parallel to X, so Y flips) or ``line``
(through ``px``, ``py`` at ``angle`` degrees from X). Points, cycle positions, the Klartext
pole ``CC`` and absolute arc centres reflect; incremental moves and arc centre vectors
(``I``, ``J``) reflect as vectors; ``PA`` becomes ``2·angle − PA`` and ``IPA`` changes sign.
Radii keep their value and sign (a mirror keeps the angle an arc spans), and so do the
Sinumerik opening angle ``AR=``, ``TURN=``, the Klartext ``CCA`` and ``LEN`` and the axes outside
the plane. **The arc direction and the compensation side swap from data** (AD-42): a code
with ``CodeSets.arcDirection`` becomes the one code of its group with the other direction
(``G2``↔``G3``, written in the style of the code it replaces: ``G02`` → ``G03``), a code with
``CodeSets.compSide`` the one with the other side (``G41``↔``G42``, Klartext ``RL``↔``RR``), and
the Klartext direction word follows ``addresses.arcDirectionWords`` (``DR+``↔``DR-``). A code
with no single partner refuses the run (``swap-unknown``).

A mirror reverses the cutting direction: climb milling becomes conventional milling. The
result says so in one warning (``climb-milling``, Q4-7); the path is not reversed. A helical
move turns the other way, so a thread milled with it changes hand (``helix-hand``).

The axis mirrors write only the words that were there (AD-44) and are exact on the decimal
text: nothing is rounded, and a result that does not fit the word refuses the run
(``resolution``). A line at another angle writes X and Y on every block that now moves in
both, rounds each word half away from zero and checks every arc of the written program, as
``rotate.py`` does (``arc-check``).

On a turning program (Q4-2): the Z mirror for the counter spindle
----------------------------------------------------------------
``about = "z"`` mirrors Z about ``z0`` (``Z' = 2·z0 − Z``) in the ZX plane (``G18``): an
incremental Z and ``W`` and the centre word along Z (``K``) change sign; a ``Y`` changes sign
about the turning axis (``Y' = −Y``), and so do an incremental Y and ``J`` (the owner's decision
Q-B, ``_nc_geom.LATHE_MIRROR_AXES``), unless the machine's "Counter spindle" setting says Y
stays (``counterSpindleY: stays``, the review round's D5-7: then Y, an incremental Y and ``J``
are left as written); ``X``, ``U``, ``I`` and the radii stay; ``G2``↔``G3`` and ``G41``↔``G42`` swap from data. It is exact. A thread, a
roughing cycle, any other turning, grooving or drilling cycle and a single pass with a taper
refuse the run (``thread``, ``roughing-cycle``, ``lathe-cycle``, ``single-pass-taper``; the
prelude's case list, plan §5 P4a item 5); Sinumerik ``DIAMON``/``DIAMOF``/``DIAM90`` refuse
nothing, because the Z mirror reads no X. The result carries the warning ``tool-nose``: the
tool nose direction is a number in each tool's offset, not in the program. A turning program
is not mirrored in X (``lathe-x-mirror``), and the Z mirror is not for a milling program
(``mill-z-mirror``). ``about = "auto"`` (the form's first choice), or left empty, is ``z`` on a
turning profile and ``y-axis`` on a milling one.

Settled defaults (the owner's answers of 2026-10-12, plan §9)
--------------------------------------------------------------

* **Q4-1, all or nothing.** A run that meets one refused block writes **nothing** and lists
  **every** refused block with its line and its reason. The input is handed back unchanged,
  so the app makes no edit and no undo step.
* **Q4-2, the lathe**: the Z mirror for the counter spindle, as above; no X mirror.
* **Q4-3, planes.** On a mill, XY only (``plane``); the lathe Z mirror needs ``G18``.
* **Q4-4, rounding and the arc tolerance.** Exact where the line is parallel to an axis and
  for the Z mirror; elsewhere each word is rounded and every arc checked (0.002 mm,
  0.0001 in).
* **Q4-5, the distance mode.** From the program or the machine's power-on mode; a mode only
  assumed from the profile refuses the run (``distance-assumed``).
* **Q4-6, returns and machine positions.** ``G53``, ``M91``, ``SUPA`` and an incremental
  ``G28``/``G30`` return of zero are left and listed as information (``machine-position``); an
  intermediate point the mirror would move refuses the run (``intermediate-point``).
* **Q4-7, the cutting direction.** A warning only; the path is not reversed.

A selection is primed with the lines above it (``input.precedingLines``); one whose lines
above were not sent refuses the run (``selection-unprimed``). One that starts or ends inside a
cycle or a block that runs over several lines refuses the run (``selection-inside``); so does
one whose blocks run under an arc direction or a compensation side set above it
(``selection-mode``: the mirror would have to swap a code it cannot see). The first move of a
selection starts where the lines above leave the tool, a point the mirror does not move: a move
to an absolute point is written with the other axis too, an arc or an incremental move there
refuses the run, and so does, on a lathe, a first move without Z, or without Y while the tool
stands away from Y0 (``selection-start``). v1.2.0 (NCR-3): under the Z mirror a single pass
(``sets.path: 'cycle'``) is refused while the tool still stands there and the mirror moves that
point (or it is not known), and so is a pass that takes its Z from above the selection; a
selection that ends while the passes are in force and that the run changed refuses
(``selection-inside``). The Klartext workpiece blank (``BLK FORM``) is left as
written, with one information row per run (``blank``, the owner's decision Q-D).
Everything outside the words it changes is handed back byte for byte.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from typing import Any, Dict

import gedit_nc
import _nc_geom
import _nc_run
from _nc_run import decimals_param, number_param, trim

#: The script's name in an error on stderr.
SCRIPT = "Mirror"

#: The mirror lines of the form.
ABOUT = ("auto", "y-axis", "x-axis", "line", "z")


class Params:
    """The form, checked. A value that cannot be used is an error, not a guess."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"
        about = values.get("about")
        if about not in (None, "") and about not in ABOUT:
            raise ValueError("Mirror: %r is not auto, y-axis, x-axis, line or z." % (about,))
        if about in (None, "", "auto"):
            about = "z" if self.lathe else "y-axis"
        self.about = about
        self.px = number_param(values, "px", "Point X")
        self.py = number_param(values, "py", "Point Y")
        self.angle = number_param(values, "angle", "Line angle")
        self.z0 = number_param(values, "z0", "Mirror Z")
        self.decimals = decimals_param(values)
        #: D5-7: whether the machine turns Y with Z (its "Counter spindle" setting). The form
        #: does not carry the machine, so the context is read for it; only the Z mirror asks.
        self.y_turns = _nc_geom.counter_spindle_y_turns(gedit_nc.load_context()) if self.about == "z" else True

    def op(self) -> Any:
        if self.about == "z":
            return _nc_geom.LatheZMirror(self.z0, self.y_turns)
        degrees = {"x-axis": Decimal(0), "y-axis": Decimal(90)}.get(self.about, self.angle)
        return _nc_geom.Mirror((self.px, self.py), degrees)

    def headline(self) -> str:
        if self.about == "z":
            return "Mirrored in Z about Z%s for the counter spindle" % trim(self.z0)
        if self.about == "y-axis":
            return "Mirrored in X about X%s" % trim(self.px)
        if self.about == "x-axis":
            return "Mirrored in Y about Y%s" % trim(self.py)
        return "Mirrored about the line through X%s Y%s at %s°" % (trim(self.px), trim(self.py), trim(self.angle))

    def verb(self) -> str:
        return "mirrored for the counter spindle" if self.about == "z" else "mirrored"


#: The text of the run's own refusal ``selection-start`` (``RUN_REASONS`` below): rotate works
#: on milling programs only; the mirror's Z mirror also names the single passes (v1.2.0, NCR-3).
SELECTION_START = (
    "this first move of the selection starts where the lines above the selection leave the "
    "tool, and that point is not moved with the selection, so an arc, a move that continues the direction of the block before it (CT, DEP), an incremental move or "
    "(on a lathe) a move without Z, or without Y away from the turning axis, or a turning or "
    "facing pass (which goes back to that point) from there would miss the moved path, and so "
    "would a pass that takes its Z from a block above the selection. Start the selection at a "
    "block that moves to an absolute position, with Z on a lathe (and Y where Y is not 0), "
    "and give its first pass every value"
)

#: The refusals of the run itself, beside ``_nc_geom.REASONS``: id -> the plain text after
#: "<as written>: " (plan §7, the P4a fix round).
RUN_REASONS = {
    "selection-start": SELECTION_START,
}
#: What the message calls a refused block, by reason (the plane run's table).
REASON_LABEL = _nc_run.REASON_LABEL

# ===========================================================================
# The run is ``_nc_run.plane_main``, the same for rotate and mirror (the P4b prelude moved it
# there from the two copies these scripts carried; TODO CODE-6).
# ===========================================================================


def main() -> int:
    return _nc_run.plane_main(SCRIPT, Params, RUN_REASONS)


if __name__ == "__main__":
    sys.exit(main())

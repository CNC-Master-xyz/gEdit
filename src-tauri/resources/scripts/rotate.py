#!/usr/bin/env python3
# /// gedit
# name = "Rotate"
# description = "Turns a milling program's path in the XY plane about a point by an angle, counter-clockwise positive. Points, arc centres and incremental moves turn with it, and X and Y are both written on every block that now moves in both. A rotation by 90, 180 or 270 degrees is exact; any other angle rounds and checks every arc. If one block cannot be turned safely, nothing is changed and every such block is listed."
# input = "selection-or-document"
# output = "replace"
# timeout = 900
# envelope = true
#
# [[params]]
# id = "cx"
# type = "number"
# label = "Centre X"
# help = "The X of the point the path turns about, in the program's units."
# default = 0
# decimals = 6
#
# [[params]]
# id = "cy"
# type = "number"
# label = "Centre Y"
# help = "The Y of the point the path turns about, in the program's units."
# default = 0
# decimals = 6
#
# [[params]]
# id = "angle"
# type = "number"
# label = "Angle (degrees)"
# help = "Counter-clockwise is positive, as the controls count it (seen from +Z). 90, 180 and 270 are exact; any other angle rounds the words and checks the arcs."
# required = true
# decimals = 6
#
# [[params]]
# id = "decimals"
# type = "choice"
# label = "Decimal places"
# help = "Only for an angle that is not a multiple of 90 degrees. As written keeps each word's own decimals, with at least 3 in mm and 4 in inch; 3 or 4 writes every rounded word with a point with that many (an inch program keeps at least 4). A word without a point stays whole increments where the machine reads it in increments; where the machine reads numbers as written, a rounded word gets a point and 3 decimals in mm, 4 in inch."
# default = "keep"
# choices = [
#   { label = "As written", value = "keep" },
#   { label = "3", value = "3" },
#   { label = "4", value = "4" }
# ]
# ///
"""Rotate (Phase 4 plan §5 P4a, P4.4; AD-41 to AD-44; exit criteria X20 and X22).

Turns the path of a milling program in the XY plane about the point ``cx``, ``cy`` by
``angle`` degrees, counter-clockwise positive as the controls count it, and hands the
program back through the ``envelope`` output. The script walks the program with the path
tracker (``_nc_path``) and asks the transform rules (``_nc_geom``) what every word is; it
keeps no list of codes of its own. The golden format, the form ids and the message are
``tests/fixtures/scripts/README.md``, "The geometry goldens".

What it changes
---------------
Every absolute point and cycle position of X and Y, every incremental move in XY, every arc
centre vector (``I``, ``J``; an absolute centre ``I=AC(…)`` like a point), the Klartext pole
``CC`` and the polar angle ``PA`` (turned by the angle; ``IPA`` stays). ``G2``/``G3`` stay, and
so do radii (with their sign), the Sinumerik opening angle ``AR=``, ``TURN=``, the axes outside
the plane (the third axis of a helix) and every cycle parameter on the tool axis. **X and Y
are both written on every block that now moves in both** (AD-44): a block that wrote only
``X`` gets its ``Y`` from the position the tracker knows, in the form of its ``X``; a block whose
start is not known refuses the run. A word whose value the rotation leaves unchanged is left
byte for byte, so a rotation by 360° gives the program back as it was.

Exact or rounded (AD-44, Q4-4): a rotation by a multiple of 90° is computed on the decimal
text, so no word is rounded and a result that does not fit the word refuses the run
(``resolution``). Any other angle computes in double precision and rounds each word half away
from zero (a word with a point to its own decimals, at least 3 in mm and 4 in inch, or the
decimals the form asks; a word without a point to whole increments where the machine reads
it in increments, and to 3 decimals in mm, 4 in inch, where it reads numbers as written). An
incremental move is then written as the difference of the two rounded points it joins, so
rounding does not add up along a path. After rounding, the written program is walked again
and every arc is checked: the start and the end must lie at the same distance from the
centre within 0.002 mm (0.0001 in), and the chord of a radius arc may exceed its diameter by
no more; otherwise the run is refused at that arc (``arc-check``).

Settled defaults (the owner's answers of 2026-10-12, plan §9)
--------------------------------------------------------------

* **Q4-1, all or nothing.** A run that meets one refused block writes **nothing** and lists
  **every** refused block with its line and its reason. The input is handed back unchanged,
  so the app makes no edit and no undo step. A path moved except for one block is a broken
  path.
* **Q4-2, the lathe.** A turning program is not rotated (``lathe-rotate``); it can be
  translated, or mirrored in Z for the counter spindle (``mirror.py``).
* **Q4-3, planes.** Rotate works in the XY plane only (``plane``).
* **Q4-4, rounding and the arc tolerance**, as above.
* **Q4-5, the distance mode.** The mode at the first moved block comes from the program or
  from the machine's power-on mode; a mode only assumed from the profile refuses the run
  (``distance-assumed``).
* **Q4-6, returns and machine positions.** ``G53``, ``M91``, ``SUPA`` and an incremental
  ``G28``/``G30`` return of zero are left and listed as information (``machine-position``); an
  intermediate point the rotation would move refuses the run (``intermediate-point``).

What refuses the run is ``_nc_geom.REASONS`` (X22): a frame, a coordinate setting, a call, a
variable in a moved word, a cycle with positions of its own or one nobody reviewed, an FK
contour, ``CT``/``CTP``/``CIP``, an arc gEdit cannot compute, a rotary move, a plane other than
XY, a word nobody describes, a turning program, a number whose reading depends on the machine
while none is chosen. A selection is primed with the lines above it
(``input.precedingLines``); one whose lines above were not sent refuses the run
(``selection-unprimed``), and so does one that starts or ends inside a cycle or inside a block
that runs over several lines (``selection-inside``). The first move of a selection starts where
the lines above leave the tool, a point the run does not move: a move to an absolute point is
written with both X and Y, an arc or an incremental move there refuses the run
(``selection-start``). The Klartext workpiece blank (``BLK FORM``) is left as written, with one
information row per run (``blank``, the owner's decision Q-D).

Everything outside the words it changes (spacing, block numbers, comments, line endings) is
handed back byte for byte.
"""

from __future__ import annotations

import sys
from typing import Any, Dict

import gedit_nc
import _nc_geom
import _nc_run
from _nc_run import decimals_param, number_param, trim

#: The script's name in an error on stderr.
SCRIPT = "Rotate"


class Params:
    """The form, checked. A value that cannot be used is an error, not a guess."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        self.cx = number_param(values, "cx", "Centre X")
        self.cy = number_param(values, "cy", "Centre Y")
        angle = values.get("angle")
        if angle is None or angle == "":
            raise ValueError("Angle: enter the angle to rotate by, in degrees.")
        self.angle = number_param(values, "angle", "Angle")
        self.decimals = decimals_param(values)
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"

    def op(self) -> Any:
        return _nc_geom.Rotate((self.cx, self.cy), self.angle)

    def headline(self) -> str:
        return "Rotated by %s° about X%s Y%s" % (trim(self.angle), trim(self.cx), trim(self.cy))

    def verb(self) -> str:
        return "rotated"


#: The text of the run's own refusal ``selection-start`` (``RUN_REASONS`` below): rotate works
#: on milling programs only; the mirror's Z mirror also names the single passes (v1.2.0, NCR-3).
SELECTION_START = (
    "this first move of the selection starts where the lines above the selection leave the "
    "tool, and that point is not moved with the selection, so an arc, an incremental move or "
    "(on a lathe) a move without Z, or without Y away from the turning axis, from there would "
    "miss the moved path. Start the selection at a block that moves to an absolute position, "
    "with Z on a lathe (and Y where Y is not 0)"
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

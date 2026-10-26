# fanuc-no-motion

Fanuc mill, no machine, the form left empty (a machine without a motion block): the lengths are
given, the feed time needs nothing of the machine, the rapid time, the tool-change time and the
total are "not set", and one row names each value the program would need: the rapid rate of Z
(first needed on line 7), of X (line 8) and the tool-change time (line 4). Y never moves at rapid,
so its rate is not asked for.

- N30, N40 (lines 5, 6): the start is not known: position-unknown.
- N50 `G99 G81` at X10 Y10 from Z20: rapid Z20 → R3 (17), feed 3 → -8 (11) at 120 = 5.5, back to R3 (11).
- N60 X30.: rapid X10 → X30 (20) at R3, feed 11 = 5.5, back to R3 (11).
- N80 rapid R3 → Z50: 47.
- Feed 22.00 mm, 11.0 s. Rapid 17 + 11 + 20 + 11 + 47 = 106.00 mm, time not set. One tool change,
  its time not set. Total not set.

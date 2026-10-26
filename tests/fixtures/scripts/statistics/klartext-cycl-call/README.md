# klartext-cycl-call

Klartext, no machine. The profile powers on in feed per minute (TNC 640 user manual, M136: F
is in mm/min unless M136 is in force); the program writes `M137` as well. Cycle 200
called twice with `CYCL CALL`, the dwell cycle 9, rapids each axis at its own rate. Form: rapid
X 30000, Y 30000, Z 15000 mm/min, per axis, tool change 6 s.

- Block 4 and 5 (lines 5, 6): the start is not known: position-unknown.
- Block 6: rapid Z50 → Z20, 30 mm: 30 / 15000 × 60 = 0.12.
- Block 8 `CYCL CALL` at X20 Y10 from Z20: surface Q203 = 0, set-up clearance Q200 = 2, depth
  Q201 = -15, plunging depth Q202 = 5 (pecks from the surface: -5, -10, -15), the tool comes back
  down to Q200 = 2 above the last bottom, return Q204 = 20 above the surface. Rapid Z20 → 2 (18),
  feed 2 → -5 (7), rapid to 2 (7), down to -3 (5), feed to -10 (7), rapid to 2 (12), down to -8 (10),
  feed to -15 (7), rapid -15 → 20 (35). Feed 21 at Q206 = 150: 8.4; Z rapids 87: 0.348.
- Block 9: rapid X20 → X60, 40 mm at 30000: 0.08.
- Block 10: the same hole at X60: feed 8.4, rapids 87 (0.348).
- Block 11/12 `CYCL DEF 9` with `DWELL 1.5`: 1.5 s.
- Block 13: feed X60 Y10 → X0 Y0: √(60² + 10²) = 60.8276 at 1000 = 3.6497.
- Block 14: rapid Z20 → Z100, 80 mm: 0.32.
- Feed 21 + 21 + 60.8276 = 102.83 mm, 8.4 + 8.4 + 3.6497 = 20.4. Rapid 30 + 87 + 40 + 87 + 80 =
  324.00 mm, 0.12 + 0.348 + 0.08 + 0.348 + 0.32 = 1.216 → 1.2. Dwell 1.5, tool change 6.
  Total 20.4497 + 1.216 + 1.5 + 6 = 29.2.

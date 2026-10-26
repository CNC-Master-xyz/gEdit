# sinumerik-cycle83-g931

Sinumerik mill, no machine. A travel time `G931` (T085: F is the time in seconds, as written)
inside and above the top feed, `G4 F` in seconds and `G4 S` in revolutions, `CYCLE83` with
`VARI=1` called twice. Form: rapid X 24000, Y 24000, Z 12000 mm/min, straight, top feed 3000
mm/min, tool change 3 s.

- N50 (line 6): the start is not known: position-unknown.
- N60 feed X0 → X40 at 400: 6.
- N70 `G931` X40 → X80 in F2 seconds: 40 mm in 2 s is 1200 mm/min, below 3000: 2.
- N80 X80 → X200 in F1 second: 120 mm in 1 s is 7200 mm/min, above 3000: 120 / 3000 × 60 = 2.4
  (clamped, info row on line 9).
- N90 `G94 F120`. N100 `G4 F1.5`: 1.5 s. N110 `G4 S30`: 30 revolutions at 3000 rpm = 0.6 s.
- N120 rapid X200 Y0 → X30 Y10: √(170² + 10²) = 170.2939 at 24000 = 0.4257.
- N130 `CYCLE83(10,0,2,-15,,-5,,0,0,0,1,1,,,,,1)` at X30 Y10 from Z50: RTP 10, RFP 0, SDIS 2, DP -15,
  first depth FDEP -5 (then the same stroke: -10, -15), `_DIS1` 1. Rapid Z50 → 2 (48), feed 2 → -5
  (7), rapid to 2 (7), down to -4 (6), feed to -10 (6), rapid to 2 (12), down to -9 (11), feed to -15
  (6), rapid to RTP 10 (25). Feed 19 at the feed in force 120: 9.5; Z rapids 109: 0.545.
- N140 rapid X30 → X40 at Z10: 10 mm, 0.025.
- N150 the same from Z10: rapid 10 → 2 (8) instead of 48: Z rapids 69, 0.345; feed 9.5.
- N160 rapid Z10 → Z100: 90 mm, 0.45.
- Feed 40 + 40 + 120 + 19 + 19 = 238.00 mm, 6 + 2 + 2.4 + 9.5 + 9.5 = 29.4. Rapid 170.2939 + 109 + 10
  + 69 + 90 = 448.29 mm, 1.7907 → 1.8. Dwell 2.1, tool change 3. Total 29.4 + 1.7907 + 2.1 + 3 = 36.3.

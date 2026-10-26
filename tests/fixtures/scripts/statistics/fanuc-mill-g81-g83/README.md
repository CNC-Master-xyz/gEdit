# fanuc-mill-g81-g83

Fanuc mill, no machine. Form: rapid X 30000, Y 30000, Z 20000 mm/min, straight, top feed
5000 mm/min, tool change 4 s, G73 retract 0.5, G83 clearance 1. A straight move, an arc, a
helix, the top-feed clamp, a `G4 X` dwell, `G81`, `G83` (twice) and `G73` timed from their holes.

The hand computation (lengths in mm, times in s; a rapid along one axis takes length / rate × 60):

**T1** (lines 4-14)

- N30, N40: the start is where the machine stands: position-unknown (lines 5, 6).
- N50 rapid Z50 → Z5: 45 mm, 45 / 20000 × 60 = 0.135.
- N60 feed Z5 → Z-2: 7 mm at 300 = 1.4. N70 X0 → X100: 100 at 300 = 20.
- N80 `G2` (100,0) → (100,40) about (100,20), half a circle of radius 20: 20π = 62.8319 at 300 = 12.5664.
- N90 `G3` back to (100,0), Z-2 → Z-6: √((20π)² + 4²) = 62.9590 at 120 = 31.4795.
- N100 X100 → X0 at F6000, above the top feed: 100 at 5000 = 1.2 (clamped, info row on line 12).
- N110 rapid Z-6 → Z50: 56 mm, 0.168. N120 `G4 X2.`: 2 s.
- Feed 7 + 100 + 62.8319 + 62.9590 + 100 = 332.79 mm, 1.4 + 20 + 12.5664 + 31.4795 + 1.2 = 66.6.
  Rapid 45 + 56 = 101.00 mm, 0.303 → 0.3. Total 66.6459 + 0.303 + 2 + 4 = 72.9.

**T2** (lines 15-26), tool at X0 Y0 Z50

- N150 rapid to X10 Y10: √200 = 14.1421 mm at 30000 (the slowest of X, Y) = 0.0283.
- N160 `G98 G81`: already over the hole; rapid Z50 → R2 48 (0.144), feed R2 → Z-10 12 at 200
  (3.6), back to the initial level Z50 60 (0.18).
- N170 `G99 G83` Q8 from Z50: rapid X10 → X30 20 (0.04); rapid Z50 → R2 48; pecks from R2:
  bottoms -6, -14, -20; feed 2 → -6 (8), rapid to R2 (8), down to -6 + 1 = -5 (7), feed to -14 (9),
  rapid to R2 (16), down to -13 (15), feed to -20 (7), `G99` back to R2 (22). Feed 24 at 100 = 14.4;
  Z rapids 48 + 8 + 7 + 16 + 15 + 22 = 116 → 0.348.
- N180 X50.: X30 → X50 20 (0.04) at R2; the same pecks without the 48: Z rapids 68 → 0.204; feed 14.4.
- N200 rapid R2 → Z50: 48, 0.144.
- N210 `G99 G73` Q5 from Z50: rapid X50 → X70 20 (0.04); rapid Z50 → R2 48 (0.144); feed 2 → -3
  (5), retract 0.5 at rapid (0.0015), feed -2.5 → -8 (5.5): 10.5 at 100 = 6.3; `G99` back to R2 10 (0.03).
- N230 rapid R2 → Z50: 48, 0.144.
- Feed 12 + 24 + 24 + 10.5 = 70.50 mm, 3.6 + 14.4 + 14.4 + 6.3 = 38.7. Rapid 14.1421 + 108 + 136 + 88
  + 48 + 78.5 + 48 = 520.64 mm, 1.4878 → 1.5. Total 38.7 + 1.4878 + 4 = 44.2.

**Total**: feed 403.29 mm, 105.3 s; rapid 621.64 mm, 1.8 s; dwell 2.0; tool changes 8.0; total
105.3459 + 1.7908 + 2 + 8 = 117.1.

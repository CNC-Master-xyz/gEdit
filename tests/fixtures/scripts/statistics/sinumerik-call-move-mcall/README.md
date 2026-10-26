# sinumerik-call-move-mcall

Sinumerik mill, no machine. Form: rapid X 30000, Y 30000, Z 20000 mm/min, straight, tool change
4 s. A cycle call in a block with its own move (NC-12: the move runs first, then the cycle, fix
batch 1 NC-4), a modal call with `MCALL`, the blocks under `MCALL` that write only a feed or a
speed (fix batch 1, NC-10: the control runs the cycle after them too) and a set-up clearance
below 0 (NC-3), the last three not estimated with the reason the expansion gives.

The hand computation (lengths in mm, times in s; a rapid along one axis takes length / rate × 60):

- N50: the start is where the machine stands: position-unknown (line 6).
- N60 `G0 X10 Y20 CYCLE81(10,0,2,-5)` from X0 Y0 Z30: the block's own rapid X0 Y0 → X10 Y20,
  √(10² + 20²) = 22.3607 at 30000 = 0.044721; then the cycle: rapid Z30 → 2 (28, 0.084), feed
  2 → -5 (7 at the F100 in force: 4.2), rapid to RTP 10 (15, 0.045).
- N80 `X20 Y20` under `MCALL`: rapid X10 → X20 at Z10 (10, 0.02), then the cycle: rapid Z10 → 2
  (8, 0.024), feed 7 (4.2), rapid to Z10 (15, 0.045).
- N90 `F250`, N100 `S2500` under `MCALL`: cycle, lines 10, 11 (named by the cycle in force,
  CYCLE81).
- N120 `CYCLE81(10,0,-2,-5)`: a set-up clearance below 0: cycle, line 13.
- N130 `G0 Z100`: the refused blocks left Z where the control puts it: position-unknown, line 14.
- Feed 14.00 mm, 8.4. Rapid 22.3607 + 28 + 15 + 10 + 8 + 15 = 98.36 mm, 0.262721 → 0.3. Tool
  change 4. Total 8.4 + 0.262721 + 4 = 12.662721 → 12.7.

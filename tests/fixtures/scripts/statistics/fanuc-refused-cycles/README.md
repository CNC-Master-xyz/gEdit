# fanuc-refused-cycles

Fanuc mill, no machine. Form: rapid X 30000, Y 30000, Z 20000 mm/min, straight, tool change 4 s.
The cycle blocks the expansion refuses since the P4b fix round are not estimated, each with the
reason the expansion gives (fix batch 1: `G86` under `M4`, the owner's Q2; `K0` with a position
in the block, Q1; a repeat count above 9999, CODE-1), and a cycle dwell whose time cannot be read
leaves out that dwell only (fix batch 2, NC-K).

The hand computation (lengths in mm, times in s; a rapid along one axis takes length / rate × 60):

- N30, N40: the start is where the machine stands: position-unknown (lines 5, 6).
- N50 `G98 G82` at X10 Y0 from X0 Y0 Z50: rapid X0 → X10 (10 mm, 10 / 30000 × 60 = 0.02), rapid
  Z50 → R2 (48), feed R2 → Z-10 (12 mm at 100: 7.2), the dwell `P500` (least time increments: no
  machine chosen, the increment depends on the machine: dwell-unknown, line 7, the dwell only),
  rapid back to the initial level Z50 (60). Z rapids 108 / 20000 × 60 = 0.324.
- N70 `G86` with `M4` in force (N60): the expansion writes it out under `M3` only: cycle, line 9.
- N90 `G81 … K0` with a position in the block: cycle, line 11.
- N110 `G91 G81 … K10000`: more than 9999 repeats: cycle, line 13.
- N130 `G0 Z100.`: the refused cycles left Z where the control puts it: position-unknown, line 15.
- Feed 12.00 mm, 7.2. Rapid 10 + 108 = 118.00 mm, 0.02 + 0.324 = 0.344 → 0.3. Dwell 0. Tool change
  4. Total 7.2 + 0.344 + 4 = 11.544 → 11.5.

# lathe-css

Fanuc lathe (system A), no machine. Constant surface speed `G96 S150` (m/min) with the clamp
`G50 S2000`, a feed per revolution `G99`, the split where the clamp starts to hold, then rpm
`G97 S1000`, a thread `G32` and a multi-pass thread `G76` (not estimated). Form: rapid X 12000,
Z 15000 mm/min (X along the radius), straight, tool change 2 s.

Under constant surface speed the speed at the radius r (mm) is n = 1000 · 150 / (2π r) = K / r with
K = 23873.2415, held at 2000 rpm below r = K / 2000 = 11.9366. A feed of f mm/rev cuts f · n mm/min.

**T1**

- N50 (line 7): the start is not known: position-unknown.
- N60 `G1 Z-30. F0.2` at X60 (r = 30): n = 795.77, 0.2 · 795.77 = 159.155 mm/min; 32 mm:
  32 · 30 / (0.2 K) = 0.201062 min = 12.0637 s.
- N70 `X0. F0.1`, r 30 → 0 along 30 mm: from r 30 to 11.9366 (18.0634 mm) the time is length ×
  mean radius / (f K) = 18.0634 · 20.9683 / (0.1 K) = 0.158654 min; from 11.9366 to 0 the clamp
  holds, 0.1 · 2000 = 200 mm/min: 11.9366 / 200 = 0.059683 min. Together 0.218337 min = 13.1002 s.
- N80 rapid X0 Z-30 → X40 Z5: radius 0 → 20, Z 35: √(20² + 35²) = 40.3113 at 12000 (the slower of
  X and Z) = 0.2016.
- N100 `G97 S1000`, `G1 Z-10. F0.25`: 15 mm at 250 mm/min = 3.6.
- N110 `G32` (line 13): a thread: not estimated.
- N120 rapid X40 Z-20 → X100 Z100: √(30² + 120²) = 123.6932 at 12000 = 0.6185.
- Feed 32 + 30 + 15 = 77.00 mm, 12.0637 + 13.1002 + 3.6 = 28.8; rapid 164.00 mm, 0.8200 → 0.8;
  tool change 2; total 28.7639 + 0.8200 + 2 = 31.6.

**T2**

- N150 rapid X100 Z100 → X25 Z5: √(37.5² + 95²) = 102.1334 at 12000 = 0.5107.
- N160, N170 `G76` (lines 18, 19): multi-pass: not estimated.
- Rapid 102.13 mm, 0.5; tool change 2; total 2.5.

**Total**: feed 77.00 mm, 28.8 s; rapid 266.14 mm, 1.3307 → 1.3; tool changes 4; total 34.1.

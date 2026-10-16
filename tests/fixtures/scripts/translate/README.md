# Translate goldens

The format is the geometry goldens' (`../README.md`, "The geometry goldens"): `input.nc`,
`params.json` (`dx`, `dy`, `dz`), an optional `case.json` (profile, machine) and
`preceding.nc` (the lines above a selection), and either `expected.nc` with `envelope.json`
(the run writes) or `refused.json` (nothing is written, every refused block is listed).
`tests/python/test_translate.py` runs them, and also runs each one with a shift of 0, 0, 0
(the input back byte for byte) and each written one back by the negated shift (every value
back). Every program is synthetic, written for gEdit, and says so in its first comment line.
A case with a `machine` member has its effective profile in `tests/fixtures/resolved/`
(`UPDATE_RESOLVED=1 npx vitest run tests/unit/resolved.test.ts` writes the index entry).

| Case | Profile, machine | What it shows |
|---|---|---|
| `fanuc-mill-shift` | Fanuc mill | the prelude's example: points, `G81` with `R`, `I`/`J` and a `G91` move kept, `G91 G28 Z0.` as information |
| `fanuc-mill-cycles-offsets` | Fanuc mill | `G83` with its peck `Q` kept, `G99`/`G98`, positions under the modal cycles, a `G91 G81` kept whole, `G43 H1 Z`, a work-offset change `G54` → `G55` inside the program, `G53` and `G91 G28` as information |
| `fanuc-mill-selection` | Fanuc mill | a selection primed by the lines above it, holding a whole `G81` … `G80` |
| `fanuc-mill-is-b` | Fanuc mill, IS-B machine | point-less words moved in whole increments (`X0` → `X1250`), a leading-zero word (`Y.5` → `Y.498`) |
| `lathe-a-shift` | Fanuc lathe, system A | X as a diameter, `U`/`W`, `R` and `I`/`K` kept, the single pass `G90` with and without its taper `R` |
| `lathe-b-shift` | Fanuc lathe, system B machine | `G90`/`G91` as distance codes, the single pass `G77` |
| `klartext-shift` | Klartext | `L`, the pole `CC` with `C` and `CR`, `IX`/`IY`, `LP`, an incremental pole, `CYCL DEF 200` and its `M99` calls, `CYCL CALL POS` moved in X and Y, an `M89` modal call, `M91` as information (a shift in X and Y only: a Z shift refuses the `CYCL CALL POS`, `b3-klartext-call-pos-z`) |
| `b3-klartext-surface-shift` | Klartext | a Z shift moves `Q203` of a definition run at the current position (`M99`, `CYCL CALL`) |
| `okuma-lathe-shift` | Okuma lathe, 1 mm machine | X as a diameter, `G91` kept, `I`/`K` kept |
| `okuma-lathe-1um` | Okuma lathe, 1 µm machine | every number scaled, point or not: `X60000` → `X61000`, `X70000.` → `X71000.` |
| `sinumerik-turn-shift` | Sinumerik turning | each X word in its own reading: `DIAMON` by the diameter shift, `DIAMOF` by half of it, `DIAM90` absolute by it; `K=AC()`, `I=IC()`, `X=IC()`, `CR=` |
| `sinumerik-turn-radius-machine` | Sinumerik turning, radius machine | the same program with the X shift as a radius: a diameter word moves by twice it |
| `sinumerik-mill-shift` | Sinumerik milling | `I=AC()`/`J=AC()`, `CR=`, `IC()`/`AC()` words, `MCALL CYCLE81` and its positions, `CYCLE83` (`RTP`, `RFP`, `DP`, `FDEP`), `SUPA` as information, `G55` |
| `fanuc-mill-frames-settings` | Fanuc mill | refused: `G68`, `G51.1` (`frame`); `G52` with a shift, `G92`, `G10` (`coordinate-shift`); `G52 X0. Y0.` is the reset and refuses nothing (plan §7 #299) |
| `fanuc-mill-calls-values` | Fanuc mill | refused: `M98`, `G65` (`call`); `X#1`, `X[#1+5.]` (`expression`); a point-less word with no machine (`machine-dependent`); `G123` (`unknown-code`); `G90 G28 Z50.` (`intermediate-point`) |
| `fanuc-mill-distance-assumed` | Fanuc mill | refused: no `G90`/`G91` before the first move (`distance-assumed`) |
| `fanuc-mill-axis-unwritten` | Fanuc mill | refused: a `G91` move from an X the program never wrote, and the cut after it, which starts where that move left the tool (`axis-unwritten`; P4a fix B1, NC-9) |
| `fanuc-mill-rotary-turned` | Fanuc mill | refused: moves before `B30.` is first written and while it stands (`rotary-turned`) |
| `b3-fanuc-mill-rotary-incremental` | Fanuc mill | refused: an incremental index `G91 G0 A90.` of an axis never written counts as turned (`rotary-turned`, P4a review NC-10) |
| `fanuc-mill-is-b-resolution` | Fanuc mill, IS-B machine | refused: a shift finer than one increment (`resolution`) |
| `fanuc-mill-selection-cycle-above` | Fanuc mill | refused: the selection starts in a `G81` started above it (`selection-inside`) |
| `fanuc-mill-selection-cycle-open` | Fanuc mill | refused: the selection ends with its `G81` still in force |
| `b3-fanuc-mill-selection-line-1` | Fanuc mill | refused: the same for a selection from line 1 (`selection-inside`, P4a review CODE-3) |
| `lathe-a-refused` | Fanuc lathe, system A | refused: `G50 X Z` (`coordinate-shift`), `G28 X100.`; `G71`/`G70` move since their parameters carry roles (plan §7 #305) |
| `klartext-refused` | Klartext | refused: cycle 7 (`coordinate-shift`), `FL` (`fk-contour`), `X+Q1`, `CALL LBL`, `PLANE SPATIAL`, cycle 10 at 30° (`frame`; its 10.0 line only names the cycle, plan §7 #299) |
| `klartext-slot-centre` | Klartext | refused: cycle 254 with its centre `Q216`/`Q217` and its call (`cycle-position`) |
| `b3-klartext-call-pos-z` | Klartext | refused: a Z shift of a cycle called with `CYCL CALL POS`, whose Z adds to `Q203`: the definition and the call (`cycle-position`, P4a review NC-3) |
| `klartext-selection-block-start` | Klartext | refused: the selection starts on a parameter line of a cycle definition, and calls it |
| `klartext-selection-block-end` | Klartext | refused: the selection ends on a line ending in `~` |
| `klartext-selection-call` | Klartext | refused: calls of a definition above the selection |
| `okuma-no-machine` | Okuma lathe | refused: every number depends on the machine's unit (`machine-dependent`) |
| `okuma-lathe-refused` | Okuma lathe, 1 mm machine | refused: an `L` radius arc (`arc-unsupported`), `G50 X Z`, `CALL` |
| `sinumerik-turn-refused` | Sinumerik turning | refused: `CYCLE95` (`cycle-position`: its contour NPP is elsewhere, plan §7 #305), `TRANS Z`, `X=R1`, `L100` |
| `sinumerik-mill-refused` | Sinumerik milling | refused: `TRANS X`, `X=R1`, `L100`, `POCKET3`, `ROT RPL=` |
| `sinumerik-mill-frames` | Sinumerik milling | refused: `MIRROR`, `SCALE`, `CYCLE800` and the moves in them (`frame`) |
| `sinumerik-mill-selection-mcall` | Sinumerik milling | refused: positions of an `MCALL` written above the selection |

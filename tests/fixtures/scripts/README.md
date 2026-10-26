# Script goldens

One folder per bundled script; each has a README with its format where the script needs
more than `input.nc`, `params.json` and one `expected.*` file:
[address arithmetic](address_arithmetic/README.md), [extents](extents/README.md),
[program checks](program_checks/README.md). `scale_feed`, `scale_speed` and `tool_list`
use the plain format of `tests/python/helpers.py` (`script_cases`). Every program in these
folders is synthetic, written for gEdit, and carries the `WRITTEN FOR GEDIT` marker; none is
copied from a machine, a CAM system or a customer.

## The geometry goldens: translate, rotate, mirror (Phase 4, P4a)

Written as a contract by the P4a prelude (Phase 4 plan §5 P4a item 3, §6.1). P4.3 owns
`translate/`, P4.4 owns `rotate/` and `mirror/`; each WP writes its cases (the plan's X19 to
X22) and pins the texts. The prelude left one example case per script, which the WP makes
pass and may correct where the written form of a number is not what the hand computation
assumed.

### A case

```
tests/fixtures/scripts/{translate,rotate,mirror}/<case>/
  input.nc        the program, stdin
  params.json     what the user filled in (the script's form)
  case.json       optional: profile, machine, machineName, input (a selection)
  preceding.nc    optional: the lines above a selection (input.precedingLines); a case with a
                  selection and no `preceding.nc` is the `selection-unprimed` case. The
                  `WRITTEN FOR GEDIT` marker may sit in `preceding.nc` instead of `input.nc`
  expected.nc     a run that writes: the text handed back, byte for byte
  envelope.json   with expected.nc: { "message", "findings" } of the envelope
  refused.json    instead of both: { "message", "findings" } of a refused run
```

A case holds **either** `expected.nc` and `envelope.json` (the run writes) **or**
`refused.json` (the run is refused, Q4-1). A refused run hands the input back unchanged —
the test checks the text byte for byte against `input.nc`, so the app makes no edit and no
undo step — and lists every refused block: one finding per refused block, in line order,
each `{ "line", "severity": "error", "message", "reason" }` with `reason` one id of
`_nc_geom.REASONS`, or one of the run's own reasons: the `RUN_REASONS` of rotate and mirror
(`selection-start`) and the reasons a script gives a whole run (`no-database`,
`selection-unprimed`). The information rows (`_nc_geom.INFO`: `machine-position`,
`word-left`, `rounded`, `blank`) are findings too, with `severity` `"info"`, in a written
run and in a refused one alike. The warnings (`_nc_geom.WARNINGS`: `climb-milling`,
`helix-hand`, `tool-nose`, `severity` `"warning"`) appear **only in a run that writes**: a
refused run lists no warning. `tests/python/helpers.py` reads a case with `geometry_cases(script)`.

**`case.json`, not `machine.json`.** The plan's optional `machine.json` is the `machine`
member of `case.json`, as in the address arithmetic goldens (plan §7 #293): the generator of
`tests/fixtures/resolved/` finds a golden with a machine by a top-level `machine` member and
its profile by a top-level `profile` member of a JSON file under `tests/fixtures/scripts/`,
and runs it against the effective profile it wrote for exactly those parameters
(`UPDATE_RESOLVED=1 npx vitest run tests/unit/resolved.test.ts`); Python never merges a
machine. A case without a machine is "no machine": a word whose reading depends on the
machine refuses the run (`machine-dependent`). As in address arithmetic, a machine golden
must not equal the profile's default preset, or it would share the no-machine file.

### The forms (`[[params]]` of the script headers)

The ids are pinned so the runtime scenario `p4-geometry` (H4a) and the user guide (P4.D)
can name them; labels and help texts are the WP's.

| Script | id | type | values | default |
|---|---|---|---|---|
| translate | `dx`, `dy`, `dz` | number | the shift per axis, in the program's units; `dx` on a turning profile as the machine reads `X` (the form says "diameter" or "radius") | `0` |
| translate | `decimals` | choice | `keep` (the word's own form; nothing is rounded, Q4-4) | `keep` |
| rotate | `cx`, `cy` | number | the centre of the rotation | `0` |
| rotate | `angle` | number | degrees, counter-clockwise positive | required |
| rotate, mirror | `decimals` | choice | `keep` (the word's own decimals, at least 3 in mm and 4 in inch), `3`, `4`; a word without a point on a machine that reads numbers as written gets 3 decimals (mm) or 4 (inch) when it is rounded | `keep` |
| mirror | `about` | choice | `auto` (first: `z` on a turning profile, `y-axis` on a milling one), `y-axis` (X flips), `x-axis` (Y flips), `line` (through `px`, `py` at `angle`), `z` (the Z mirror for the counter spindle, turning only); the choices are in this order in the header | `auto` |
| mirror | `px`, `py`, `angle` | number | the point the axis or the line goes through (a mirror about the X axis through it is `Y' = 2·py − Y`); `angle`, for `line` only, its angle from X in degrees | `0` |
| mirror | `z0` | number | the Z to mirror about on a lathe (`Z' = 2·Z0 − Z`) | `0` |

### The message

One paragraph, in this order: what was done (`Moved by X1.25 Y-2 Z0.5: 13 words on 6
blocks.`, `Rotated by 90° about X0 Y0: …`, `Mirrored in Z about Z0 for the counter spindle:
…`, with the words added and the words rounded counted); what was left as information;
for a refused run `Nothing was changed: N blocks cannot be …` with the reasons counted in the
order of `_nc_geom.REASONS`; the machine, always last, as in address arithmetic. The exact
wording is the WP's and its goldens pin it; the example cases carry the prelude's draft.

### The example cases

| Case | Profile | What it shows |
|---|---|---|
| `translate/fanuc-mill-shift` | Fanuc mill, no machine | a shift by X1.25 Y-2 Z0.5: absolute points, a `G81` with its `R` plane, the incremental centre `I`/`J` and a `G91` move kept, `G91 G28 Z0.` left as information |
| `rotate/fanuc-mill-90` | Fanuc mill, no machine | a rotation by 90° about X0 Y0, exact: points and the centre vector turned, `G3` kept, a `G91` block that wrote only `X` writes `X` and `Y` |
| `mirror/lathe-z-counter-spindle` | Fanuc lathe, system A, no machine | the Z mirror about Z0: `Z` and `W` and `K` change sign (so do `Y` and `J` about the turning axis), `X`, `U`, `I`, `R` stay, `G2`↔`G3` and `G41`↔`G42` swap from the data, the tool-nose warning |
| `mirror/lathe-thread-refused` | Fanuc lathe, system A | a refused run: a `G76` thread (`thread`) and a `G71` roughing cycle (`roughing-cycle`) listed, nothing written |

## The drilling and time goldens: expand_cycles, statistics (Phase 4, P4b)

Written as a contract by the P4b prelude (Phase 4 plan §6.3 rule 14, §6.4 rule 6). P4.7 owns
`expand_cycles/`, P4.9 owns `statistics/`; the prelude left no example case, because both
need the hand computation of the work package that writes the script.

- `expand_cycles/<case>/` is a geometry golden (above): `input.nc`, `params.json` (`peckRetract`,
  `peckClearance`), optional `case.json` and `preceding.nc`, then `expected.nc` with
  `envelope.json`, or `refused.json`; a refused run hands the input back byte for byte and
  lists one error per refused block, `reason` one id of `_nc_cycles.REASONS` or of the frame
  (`no-database`, `selection-unprimed`). Every written case also holds X23: the extents of
  `expected.nc` equal the extents of `input.nc` (the cycle's), T108 included.
- `statistics/<case>/`: `input.nc`, `params.json` (the form of §6.4 rule 6, `format: "csv"`),
  optional `case.json`, `expected.csv` (lengths to 0.01 mm, times to 0.1 s) and
  `envelope.json` (`message`, `findings`: the "not estimated" rows with their lines). The
  first line of `expected.csv` is the header; each case's computation by hand is written in
  a `README.md` of its folder.

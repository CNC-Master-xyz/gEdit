// The sample programs of the profile form's preview read as programs a control would run
// (P4h review NC-10): every arc has the same radius at its start and at its end, the Okuma
// branch is written the way an Okuma control takes it, and the Okuma mill sample carries no
// lathe-only G50. The fanuc-lathe calculator preset names G76 P (second block) among the
// words read in microns (NC-8).
//
// The arc check is a small reader of its own, enough for the eight samples: absolute X/Y/Z,
// G2/G3 (G02/G03) with I/J/K from the start point (radius values on a lathe) or I=AC(..) as an
// absolute centre (a diameter on a lathe, the samples turn with DIAMON), and Heidenhain CC/C.
// Facts: Okuma `IF [V1 EQ 10] N2000`, operators LT LE EQ NE GT GE with a space on each side
// (OSP-P300 programming manual LG33-019-R22 p.424-425 and p.450); Siemens I=AC(..) is a
// diameter under DIAMON, an incremental I a radius (840D sl NC programming SW4.92 p.169).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAMPLE_GRAMMARS, SAMPLE_MACHINE_TYPES, SAMPLE_TEMPLATES } from './index';

type Point = { X: number; Y: number; Z: number };
type Arc = { line: string; start: Point; end: Point; centre: Point };

const AXES = ['X', 'Y', 'Z'] as const;
const CENTRE_OF = { I: 'X', J: 'Y', K: 'Z' } as const;

/** The arcs of one sample, each with its start, end and centre in radius values. */
function arcsOf(name: string, template: string): Arc[] {
  const lathe = name.endsWith('-lathe');
  const klartext = name.startsWith('klartext-');
  // A diameter on a lathe (X), except in the Heidenhain samples, which write plain coordinates.
  const scale = (axis: string): number => (lathe && !klartext && axis === 'X' ? 0.5 : 1);
  const pos: Point = { X: 0, Y: 0, Z: 0 };
  let klartextCentre: Point | null = null;
  const arcs: Arc[] = [];
  for (const raw of template.split('\n')) {
    const line = raw.replace(/\{note:[^}]*\}|\{n\d+\}|\{skip\}/g, ' ').trim();
    if (line === '' || /^\d*\s*BLK FORM/.test(line)) continue;
    const words = new Map<string, { value: number; absolute: boolean }>();
    for (const m of line.matchAll(/(?<![A-Z_])([XYZIJK])\s*(?:=\s*AC\(\s*([-+]?[\d.]+)\s*\)|([-+]?(?:\d+\.?\d*|\.\d+)))/g)) {
      const [, letter, ac, plain] = m;
      words.set(letter, { value: Number(ac ?? plain), absolute: ac !== undefined });
    }
    const start = { ...pos };
    const end = { ...pos };
    for (const axis of AXES) {
      const word = words.get(axis);
      if (word) end[axis] = word.value * scale(axis);
    }
    if (klartext && /^\d+\s+CC\b/.test(line)) {
      klartextCentre = { ...pos };
      for (const axis of AXES) {
        const word = words.get(axis);
        if (word) klartextCentre[axis] = word.value;
      }
      continue; // CC sets the centre and does not move the tool.
    }
    if (klartext && /^\d+\s+C\b/.test(line)) {
      expect(klartextCentre, `${name}: C without CC`).not.toBeNull();
      arcs.push({ line, start, end, centre: { ...(klartextCentre as Point) } });
    } else if (!klartext && /(?<![A-Z0-9.])G0?[23](?![0-9.])/.test(line)) {
      const centre = { ...start };
      for (const [letter, axis] of Object.entries(CENTRE_OF)) {
        const word = words.get(letter);
        if (!word) continue;
        centre[axis] = word.absolute ? word.value * scale(axis) : start[axis] + word.value;
      }
      arcs.push({ line, start, end, centre });
    }
    Object.assign(pos, end);
  }
  return arcs;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.X - b.X, a.Y - b.Y, a.Z - b.Z);

describe('the preview samples', () => {
  const names = SAMPLE_GRAMMARS.flatMap((grammar) => SAMPLE_MACHINE_TYPES.map((type) => `${grammar}-${type}`));

  it('has every sample the form asks for', () => {
    for (const name of names) expect(SAMPLE_TEMPLATES[name], name).toBeTypeOf('string');
  });

  it('writes every arc with the same radius at its start and its end', () => {
    for (const name of names) {
      const arcs = arcsOf(name, SAMPLE_TEMPLATES[name]);
      expect(arcs.length, `${name} has an arc`).toBeGreaterThan(0);
      for (const arc of arcs) {
        const r1 = distance(arc.start, arc.centre);
        const r2 = distance(arc.end, arc.centre);
        expect.soft(r1, `${name}: ${arc.line} has a radius`).toBeGreaterThan(0.001);
        expect.soft(Math.abs(r1 - r2), `${name}: ${arc.line} (start radius ${r1}, end radius ${r2})`).toBeLessThan(0.001);
      }
    }
  });

  it('writes the Okuma branch with its condition in brackets and a sequence name as the target', () => {
    for (const name of ['okuma-mill', 'okuma-lathe']) {
      const text = SAMPLE_TEMPLATES[name];
      const branch = text.split('\n').find((line) => /(?<![A-Z])IF(?![A-Z])/.test(line));
      expect(branch, name).toMatch(/(?<![A-Z])IF \[V1 GT 10\] N(\d+)\s*$/);
      const target = /N(\d+)\s*$/.exec(branch ?? '')?.[1];
      expect(text, `${name}: the block N${target} is there`).toMatch(new RegExp(`^\\{n${target}\\}`, 'm'));
      expect(text, name).not.toMatch(/GOTO/);
    }
  });

  it('keeps G50 out of the Okuma mill sample and still starts the spindle', () => {
    const text = SAMPLE_TEMPLATES['okuma-mill'];
    expect(text).not.toMatch(/(?<![A-Z0-9.])G50(?![0-9.])/);
    expect(text).toMatch(/(?<![A-Z])S1800 M03\b/);
  });
});

describe('the fanuc-lathe calculator preset', () => {
  it('names G76 P (second block) among the words read in microns', () => {
    const path = fileURLToPath(new URL('../profiles/fanuc-lathe.json', import.meta.url));
    const labels: string[] = [];
    JSON.parse(readFileSync(path, 'utf8'), (key, value: unknown) => {
      if (value !== null && typeof value === 'object' && (value as { id?: unknown }).id === 'calculator') {
        const label = (value as { label?: unknown }).label;
        if (typeof label === 'string') labels.push(label);
      }
      return value;
    });
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('G76 Q and P (second block)');
    expect(labels[0]).toContain('in microns');
  });
});

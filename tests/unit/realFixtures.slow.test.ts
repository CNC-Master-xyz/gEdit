// The run over the owner's local programs (gate G11): every check of `tests/real/README.md` over every
// program the manifest names. The rules and the logic on a synthetic manifest are in `realFixtures.test.ts`.

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatReport, runG11 } from './helpers/g11';
import { REPO, mainWorkingTree, readManifest, realFolder, reportPathAllowed, sourceOf, type RealFolder } from './helpers/realFolder';
import { findPython } from './helpers/realPrograms';

describe('the local programs', () => {
  const folder = realFolder();
  const programs = folder.kind === 'folder' ? readManifest(folder.path) : null;

  it.skipIf(folder.kind !== 'folder' || programs === null || programs.length === 0)(
    'runs every check over every program the manifest names (G11)',
    () => {
      const local = folder as Extract<RealFolder, { kind: 'folder' }>;
      const python = findPython();
      const report = runG11(local.path, programs ?? [], sourceOf(local), python);
      const lines = formatReport(report);
      if (!python.ok) lines.push(`G11 the script checks skipped: ${python.reason}`);
      for (const line of lines) expect(line).not.toContain(local.path);
      console.log(lines.join('\n'));

      const target = process.env.GEDIT_G11_REPORT?.trim();
      if (target) {
        const roots = [REPO, mainWorkingTree()].filter((root): root is string => root !== null);
        if (reportPathAllowed(target, roots)) writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        else console.log('G11 report not written: GEDIT_G11_REPORT points under tests/ of the repository');
      }

      expect(report.checks.noCrash.fail, 'a check crashed on a local program').toBe(0);
      if (process.env.GEDIT_G11 === 'strict') {
        expect(report.failures, 'G11 failures (strict)').toEqual([]);
        expect(report.noLongerGaps, 'known gaps that pass now (strict)').toEqual([]);
      }
    },
    600_000,
  );
});

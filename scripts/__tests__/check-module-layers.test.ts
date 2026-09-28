/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { checkModuleLayers, LAYER_RULES } from '../check-module-layers.mjs';
import { withProbeLock, withTempSourceFile } from './boundaryMutation';

/** Collect the messages a run logged, and its exit code. */
function run() {
  const logs: string[] = [];
  const code = checkModuleLayers({ log: (msg: unknown) => logs.push(String(msg)) });
  return { code, logs, output: logs.join('\n') };
}

/** The design-system rule, asserted to exist so a rename cannot silently drop it. */
function designSystemRule() {
  const rule = LAYER_RULES.find((r) => r.from === 'packages/ui');
  expect(rule).toBeDefined();
  return rule!;
}

describe('checkModuleLayers', () => {
  it('passes on the current tree', () => {
    // Under the probe lock: another suite's mutation probe must not be able to
    // show up in this walk, in either direction.
    const { code, output } = withProbeLock(() => run());
    expect(output).not.toMatch(/violation/);
    expect(code).toBe(0);
  });

  it('guards the shared relation-metadata layer against importing its consumers', () => {
    const rule = LAYER_RULES.find((r) => r.from === 'src/lib/relationMetadata');
    expect(rule).toBeDefined();
    expect(rule!.forbidden).toEqual(
      expect.arrayContaining(['src/components', 'src/stores', 'src/windows', 'src/hooks']),
    );
  });

  it('reports the offending file and target when a rule is violated', () => {
    // A synthetic rule proves the detector actually inspects imports rather than
    // trusting the rule table. Query editor modules import Host library helpers.
    const probe = {
      name: 'probe',
      from: 'src/windows/connection/query',
      forbidden: ['src/lib'],
    };
    LAYER_RULES.push(probe);
    try {
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain('src/lib');
      expect(output).toContain('probe');
    } finally {
      LAYER_RULES.pop();
    }
  });
});

describe('checkModuleLayers · @datazen/ui must stay a host-free leaf', () => {
  it('declares both halves of the rule: forbidden subtrees and forbidden bare packages', () => {
    const rule = designSystemRule();
    expect(rule.forbidden).toEqual(
      expect.arrayContaining([
        'src',
        'packages/drivers',
        'packages/driver-sdk',
        'packages/wapp-sdk',
        'packages/extension-points',
      ]),
    );
    expect(rule.forbiddenPackages).toEqual(
      expect.arrayContaining(['@tauri-apps/', 'zustand', '@datazen/driver-sdk']),
    );
  });

  // Mutation test against the REAL tree — this is the guard's teeth. Every
  // shape below is a real way the boundary can be broken; a guard that only
  // understood `import … from` would let the dynamic / require / mock ones
  // through, which is precisely how the original `PathInput` regression would
  // have been reintroduced one keystroke after being fixed.
  const SHAPES: Array<{ what: string; body: string; expectedTarget: string }> = [
    {
      what: 'a static import of a Tauri plugin',
      body: "import { open } from '@tauri-apps/plugin-dialog';\nexport const pick = open;\n",
      expectedTarget: '@tauri-apps/…',
    },
    {
      what: 'a dynamic import of a Tauri plugin',
      body: "export const pick = () => import('@tauri-apps/plugin-fs');\n",
      expectedTarget: '@tauri-apps/…',
    },
    {
      what: 'a CommonJS require of a Tauri plugin',
      body: "const dlg = require('@tauri-apps/api/dialog');\nexport default dlg;\n",
      expectedTarget: '@tauri-apps/…',
    },
    {
      what: 'a test-time mock of a host store package',
      body: "vi.mock('zustand', () => ({}));\nexport const noop = true;\n",
      expectedTarget: 'zustand…',
    },
    {
      what: 'a relative climb back into the host src tree',
      body: "import { useSettingsStore } from '../../../src/stores/settingsStore';\nexport const s = useSettingsStore;\n",
      expectedTarget: 'src/stores/settingsStore',
    },
    {
      what: 'a relative climb into a driver package',
      body: "import { redisMeta } from '../../drivers/redis/ui/shared/meta';\nexport default redisMeta;\n",
      expectedTarget: 'packages/drivers/redis/ui/shared/meta',
    },
  ];

  for (const { what, body, expectedTarget } of SHAPES) {
    it(`fails on ${what}`, () => {
      const { code, output } = withTempSourceFile(
        'packages/ui/src/__boundaryProbe__.ts',
        body,
        () => run(),
      );
      expect(code).toBe(1);
      expect(output).toContain('packages/ui/src/__boundaryProbe__.ts');
      expect(output).toContain(expectedTarget);
      expect(output).toContain('shared design system (@datazen/ui) must stay a host-free leaf');
    });
  }

  it('does not fire on the design system’s own imports (no false positives)', () => {
    // Scoped to the probe: the shipped tree is asserted clean by the
    // "passes on the current tree" case above, not by this one.
    const { output } = withTempSourceFile(
      'packages/ui/src/__boundaryProbe__.tsx',
      [
        "import { useState } from 'react';",
        "import { FolderOpen } from 'lucide-react';",
        "import { twMerge } from 'tailwind-merge';",
        "import { Button } from './Button';",
        "import { cn } from '../cn';",
        "import { PathInput } from './PathInput';",
        '// A comment naming @tauri-apps/plugin-dialog must not count.',
        '/* Nor may a block comment: import "zustand" */',
        "const label = 'pick a @tauri-apps/plugin-dialog path';",
        'export const Probe = () => useState(cn(FolderOpen, twMerge(label)));',
        'export { Button, PathInput };',
        '',
      ].join('\n'),
      () => run(),
    );
    expect(output).not.toContain('__boundaryProbe__');
  });
});

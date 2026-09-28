/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { checkModuleLayers, LAYER_RULES } from '../check-module-layers.mjs';

/** Collect the messages a run logged, and its exit code. */
function run() {
  const logs: string[] = [];
  const code = checkModuleLayers({ log: (msg: unknown) => logs.push(String(msg)) });
  return { code, logs, output: logs.join('\n') };
}

describe('checkModuleLayers', () => {
  it('passes on the current tree', () => {
    const { code, output } = run();
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

// scripts/__tests__/aggregate-hub.test.ts
// 协调 hub 聚合器的回归测试。脚本本身是顶层执行脚本（无导出），但它接受自定义
// 协调目录作为位置参数，因此可以对着临时目录做端到端验证，无需重构被测代码。
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/aggregate-hub.mjs');

/** 造一个临时协调目录，塞入指定轨道，再跑聚合器，返回生成的 hub.md 正文。 */
function aggregate(tracks: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hub-'));
  for (const [id, content] of Object.entries(tracks)) {
    const trackDir = path.join(dir, 'tracks', id);
    mkdirSync(trackDir, { recursive: true });
    writeFileSync(path.join(trackDir, 'progress.md'), content, 'utf8');
  }
  execFileSync('node', [SCRIPT, dir], { cwd: REPO_ROOT, encoding: 'utf8' });
  return readFileSync(path.join(dir, 'hub.md'), 'utf8');
}

/** 取 hub.md 中某个轨在指定小节里的那一行。总览表与写锁台账表列不同，必须分节取。 */
function rowIn(hub: string, section: string, trackId: string): string {
  const body = hub.split(`## ${section}`)[1];
  if (body === undefined) throw new Error(`hub.md 中没有「${section}」小节`);
  const row = body.split('\n').find((l) => l.trimStart().startsWith(`| ${trackId} |`));
  if (row === undefined) throw new Error(`「${section}」中没有轨道 ${trackId} 的行`);
  return row;
}

const OVERVIEW = '功能总览表';
const LOCK = '写锁台账';

describe('aggregate-hub 台账解析', () => {
  it('识别带 Markdown 强调标记的 `状态` 字段', () => {
    // 回归：解析器比较前不剥 `*`，而 `状态` 用的是等值匹配，
    // 于是 `- **状态**: X` 永远匹配不上，总览表状态恒为「未开始」。
    const hub = aggregate({
      alpha: '# Track: alpha\n\n- **状态**: READY_FOR_TEST\n- **分支**: `feature/alpha`\n',
    });
    expect(rowIn(hub, OVERVIEW, 'alpha')).toContain('READY_FOR_TEST');
    expect(rowIn(hub, OVERVIEW, 'alpha')).not.toContain('未开始');
    expect(rowIn(hub, LOCK, 'alpha')).toContain('READY_FOR_TEST');
  });

  it('不把 `Pro 分支` 误当作宿主分支', () => {
    // 回归：`分支` 曾用子串匹配，`- **Pro 分支**: productivity/x` 会覆盖宿主分支，
    // 而 Pro 仓与宿主仓是两个独立 git 仓库，登记的必须是宿主分支。
    const hub = aggregate({
      beta: '# Track: beta\n\n- **状态**: CODING\n- **分支**: `feature/beta`（宿主）\n- **Pro 分支**: `productivity/beta`\n',
    });
    // Pro 仓分支是另一个 git 仓库，登记的必须是宿主分支，且 Pro 值不得出现在台账里。
    const lockRow = rowIn(hub, LOCK, 'beta');
    expect(lockRow).toContain('feature/beta');
    expect(lockRow).not.toContain('productivity/beta');
    expect(hub).not.toContain('productivity/beta');
  });

  it('只有 `Pro 分支` 时回落到默认宿主分支', () => {
    const hub = aggregate({
      gamma: '# Track: gamma\n\n- **状态**: CODING\n- **Pro 分支**: `productivity/gamma`\n',
    });
    const lockRow = rowIn(hub, LOCK, 'gamma');
    expect(lockRow).toContain('feature/gamma');
  });

  it('正文中的叙述行不会被误读成台账字段', () => {
    // 解析器只读首个 `## ` 之前的头部；正文的 `- 覆盖率: 82%` 之类不该进台账。
    const hub = aggregate({
      delta:
        '# Track: delta\n\n- **状态**: CODING\n- **分支**: `feature/delta`\n\n## 覆盖率\n\n- 覆盖率: 82%\n',
    });
    const lockRow = rowIn(hub, LOCK, 'delta');
    expect(lockRow).not.toContain('82%');
  });

  it('统计未关闭的 Bug 数量', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hub-'));
    const trackDir = path.join(dir, 'tracks', 'eps');
    mkdirSync(path.join(trackDir, 'bugs'), { recursive: true });
    writeFileSync(
      path.join(trackDir, 'progress.md'),
      '# Track: eps\n\n- **状态**: CODING\n',
      'utf8',
    );
    writeFileSync(
      path.join(trackDir, 'bugs/eps-BUG-001.md'),
      '# eps-BUG-001 · 示例\n\n- **状态**：待修复\n',
      'utf8',
    );
    // 用真实闭环文件的写法（状态值本身也带强调标记）。
    writeFileSync(
      path.join(trackDir, 'bugs/eps-BUG-002.md'),
      '# eps-BUG-002 · 已闭环\n\n- **状态**：**已修复**（第 3 轮复测通过）\n',
      'utf8',
    );
    // 正文里的状态流转叙述不得被误判为开放态。
    writeFileSync(
      path.join(trackDir, 'bugs/eps-BUG-003.md'),
      '# eps-BUG-003 · 流转叙述\n\n- **状态**：**已修复**\n- **严重度**：低\n\n## 状态流转\n\n状态流：`待修复（round-1）` → **`已修复`**（round-2 复测通过）。\n\n- **复测结论**：✅ 修复有效，BUG-003 关闭（状态 → 已修复）。\n',
      'utf8',
    );
    execFileSync('node', [SCRIPT, dir], { cwd: REPO_ROOT, encoding: 'utf8' });
    const hub = readFileSync(path.join(dir, 'hub.md'), 'utf8');
    expect(rowIn(hub, OVERVIEW, 'eps')).toContain('1 bugs');
  });
});

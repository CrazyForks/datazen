/**
 * Demo recording v2 — 6 幕 AI 主线（不含迁移三件套）。
 *
 * 1. Wizard 开箱（Sample Playground → AI 步骤展示 → Done 进入主界面）
 * 2. Editor Pro 写 SQL（补全/签名/hover/linter/意图/语句运行/粘贴IN/拖拽/事务/NL2SQL）
 * 3. AI 诊断（错 SQL → 诊断 → 应用修正）
 * 4. AI 过滤（表浏览 → 自然语言过滤 → chips）
 * 5. AI Chat（右侧抽屉 → 多轮 → 插入编辑器）
 * 6. 结果可视化 → 添加到看板（表格/图表切换 → 加看板 → 看板页验证）
 *
 * AI 配置通过 IPC 预置（e2e/.env 的 E2E_AI_*），与 ai-features.ts 一致。
 * Pro 版构建要求：node e2e/run.mjs --pro --skip-build --spec demo-recording-v2.ts
 *
 * Frames: e2e/.demo-recording-v2/frame_NNNNN.png → assemble-apng.mjs → ffmpeg MP4。
 */
import { browser, $, $$ } from '@wdio/globals';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const FRAME_DIR = path.join(ROOT, 'e2e', '.demo-recording-v2');

function getAiConfig() {
  // 录制走本地 Ollama（无限流）：providerType=ollama, model=deepseek-r1。
  // 如需云端，设 E2E_AI_USE_CLOUD=1 则回退到 e2e/.env 的 E2E_AI_*。
  if (process.env.E2E_AI_USE_CLOUD === '1') {
    return {
      providerType: (process.env.E2E_AI_PROVIDER || 'open_ai') as
        | 'open_ai'
        | 'anthropic'
        | 'deepseek'
        | 'ollama'
        | 'custom',
      endpoint: process.env.E2E_AI_ENDPOINT || '',
      apiKey: process.env.E2E_AI_API_KEY || '',
      model: process.env.E2E_AI_MODEL || '',
      protocol: process.env.E2E_AI_PROTOCOL || undefined,
    };
  }
  return {
    providerType: 'ollama' as const,
    endpoint: process.env.E2E_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/v1',
    apiKey: 'ollama',
    model: process.env.E2E_OLLAMA_MODEL || 'deepseek-r1:latest',
    protocol: undefined,
  };
}

// ── frame capture ──
let seq = 0;
function pad(n: number): string {
  return String(n).padStart(5, '0');
}

async function snap(): Promise<void> {
  const b64 = (await browser.takeScreenshot()) as string;
  seq += 1;
  fs.writeFileSync(path.join(FRAME_DIR, `frame_${pad(seq)}.png`), Buffer.from(b64, 'base64'));
}

/** Hold for `ms`, snapping frames throughout so playback stays fluid. */
async function hold(ms: number, interval = 250): Promise<void> {
  const end = Date.now() + ms;
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < end) {
    // eslint-disable-next-line no-await-in-loop
    await snap();
    // eslint-disable-next-line no-await-in-loop
    await browser.pause(interval);
  }
}

async function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync(
    (c: string, a: string, done: (r: unknown) => void) => {
      (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (c: string, a: string) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__
        .invoke(c, JSON.parse(a))
        .then((r: unknown) => done(r))
        .catch((e: unknown) => done({ __error: String(e) }));
    },
    cmd,
    JSON.stringify(args),
  );
  if (result && typeof result === 'object' && result !== null && '__error' in result) {
    throw new Error(String((result as { __error: string }).__error));
  }
  return result as T;
}

async function setWindowSize(w = 1600, h = 1000) {
  await invoke('plugin:window|set_size', { value: { Logical: { width: w, height: h } } });
  await browser.pause(500);
}

/** 确保主工作区窗口就绪（与 helpers.ensureMainWindowForIpc 同逻辑，录制脚本自包含）。 */
async function ensureMainWindow() {
  try {
    const nav = await $('[data-testid="workspace-nav-databases"]');
    if (await nav.isDisplayed().catch(() => false)) return;
  } catch {
    /* fall through */
  }
  try {
    await browser.url('tauri://localhost');
    await $('[data-testid="workspace-nav-databases"]').waitForDisplayed({ timeout: 15000 });
  } catch {
    const handles = await browser.getWindowHandles();
    if (handles[0]) await browser.switchToWindow(handles[0]);
  }
  await browser.pause(400);
}

async function setEditorContent(text: string) {
  const editor = $('.cm-editor .cm-content');
  await editor.waitForDisplayed({ timeout: 10000 });
  await editor.click();
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.activeElement?.closest('.cm-editor .cm-content') != null &&
          document.querySelector('[id^="dz-select-listbox-"]') == null,
      ),
    { timeout: 2000, timeoutMsg: 'editor focus/selector cleanup did not settle' },
  );
  await browser.execute((t: string) => {
    const el = document.querySelector('.cm-editor .cm-content') as HTMLElement | null;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      sel.deleteFromDocument();
    }
    document.execCommand('insertText', false, t);
  }, text);
  await browser.pause(300);
}

async function clickTestId(id: string, timeout = 10000) {
  const el = $(`[data-testid="${id}"]`);
  await el.waitForClickable({ timeout });
  await el.click();
  await browser.pause(300);
}

async function waitForResults(timeout = 30000) {
  // 与 helpers.executeSqlInEditor 同策略：data-execution-seq 递增或行数文本出现。
  const queryPanel = await $('[data-testid="query-panel"]');
  const prevSeq = Number((await queryPanel.getAttribute('data-execution-seq')) ?? '0');
  await browser.waitUntil(
    async () => {
      const seq = Number((await queryPanel.getAttribute('data-execution-seq')) ?? '0');
      if (seq > prevSeq) return true;
      const body = await $('body').getText();
      if (/\d+\s*(行|rows?)\b/i.test(body)) return true;
      if (/Query failed|error returned from database/i.test(body)) return true;
      return false;
    },
    { timeout, timeoutMsg: 'Query results did not appear' },
  );
  await browser.pause(600);
}

/** Seed the legacy AI config so isConfigured=true (same as ai-features.ts). */
async function seedAiConfig() {
  const aiConfig = getAiConfig();
  if (!aiConfig.apiKey) {
    console.warn('⚠️  E2E_AI_API_KEY not set — AI 镜头将只拍未配置态');
    return false;
  }
  await invoke('ai_save_config', {
    config: {
      providerType: aiConfig.providerType,
      endpoint: aiConfig.endpoint,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
      extra: aiConfig.protocol ? { protocol: aiConfig.protocol } : null,
    },
  });
  return true;
}

// ── Main demo flow ──
// 跨 it 共享：AI 是否就绪、基线 SQL。
let aiReady = false;
const BASE_QUERY = `SELECT region, SUM(amount) AS total
FROM demo_sales
GROUP BY region
ORDER BY total DESC;`;

describe('Demo Recording v2 — AI 主线 6 幕', () => {
  before(async () => {
    // 不导航：E2E 隔离数据是全新安装，bootstrap 已自动创建原生向导窗，
    // webdriver 当前 handle 直接就是它。
    fs.mkdirSync(FRAME_DIR, { recursive: true });
  });

  it('第 1 幕：Wizard 开箱', async () => {
    // ════════════════════════════════════════════════════════════════
    // 第 1 幕：WIZARD 开箱
    // ════════════════════════════════════════════════════════════════
    // webdriver 只有一个 handle（原生向导窗本身，label=onboarding）。
    // bootstrap 已把它导航到 main URL；这里导航回向导 URL 即可重进 Wizard。
    await browser.url('tauri://localhost/window.html?window=onboarding');
    await $('[data-testid="onboarding-wizard"]').waitForDisplayed({ timeout: 30000 });
    aiReady = await seedAiConfig();
    await setWindowSize(1600, 1000);

    // S0: Welcome — 三入口
    await $('[data-testid="onboarding-entry-sample"]').waitForDisplayed({ timeout: 15000 });
    await hold(2500, 400);

    // 点 Sample Playground
    await $('[data-testid="onboarding-entry-sample"]').click();
    await $('[data-testid="onboarding-step-s1-sample"]').waitForDisplayed({ timeout: 15000 });
    await hold(2000, 400);

    // 等 sample 数据 seed 完成
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="onboarding-sample-path"]').isExisting()) ||
        (await $('[data-testid="onboarding-sample-error"]').isExisting()),
      { timeout: 30000, timeoutMsg: 'Sample data seeding timeout' },
    );
    await hold(1500, 400);

    // Continue → AI provider 步骤（S2）
    const continueBtn = $('[data-testid="onboarding-continue"]');
    await browser.waitUntil(async () => await continueBtn.isEnabled(), { timeout: 10000 });
    await continueBtn.click();
    await $('[data-testid="onboarding-step-s2-ai"]').waitForDisplayed({ timeout: 15000 });
    // AI 已通过 IPC 预置：这里只展示表单态 2s（不手输 key）
    await hold(2000, 400);

    // Skip → Done
    await $('[data-testid="onboarding-skip"]').click();
    await $('[data-testid="onboarding-step-s3"]').waitForDisplayed({ timeout: 15000 });
    await hold(1500, 400);

    // 进入主工作区：onboarding_complete 关闭向导窗 + 新建主窗口。
    // 当前 handle（向导窗）会失效，枚举新 handle 并切到主窗口。
    const wizardHandle = await browser.getWindowHandle();
    await $('[data-testid="onboard-open-datazen"]').click();
    await browser.waitUntil(
      async () => {
        const handles = await browser.getWindowHandles().catch(() => [] as string[]);
        const next = handles.find((h) => h !== wizardHandle);
        if (!next) return false;
        await browser.switchToWindow(next).catch(() => {});
        return browser
          .execute(() => !!document.querySelector('[data-testid="workspace-nav-databases"]'))
          .catch(() => false);
      },
      { timeout: 30000, timeoutMsg: '主窗口未出现' },
    );
    await $('[data-testid="workspace-nav-databases"]').waitForDisplayed({ timeout: 15000 });
    await hold(2000, 400);

    // 确保 Sample Playground 已连接：双击 navigator 连接项（选中+连接），
    // 等连接工具条就绪后再开 query tab。
    await browser.execute(() => {
      const nav =
        document.querySelector('[data-testid="connection-navigator-aside"]') ??
        Array.from(document.querySelectorAll('aside')).find((a) =>
          a.querySelector('[data-conn-item]'),
        );
      const items = nav?.querySelectorAll('[data-conn-item]') ?? [];
      for (const item of items) {
        if (item.textContent?.includes('Sample Playground')) {
          (item as HTMLElement).dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
          );
          return;
        }
      }
    });
    await $('[data-testid="conn-toolbar-new-query"]')
      .waitForDisplayed({ timeout: 30000 })
      .catch(() => {});
    await browser.pause(1500);
    // 开一个 query tab（不依赖 post-onboarding 自动开：向导窗/主窗 localStorage 未必互通）。
    // toolbar 只在 activePanel 存在时渲染；连接初始化慢时轮询等（与 helpers.openQueryTab 同策略）。
    {
      const deadline = Date.now() + 60_000;
      let opened = false;
      while (Date.now() < deadline && !opened) {
        try {
          let newQueryBtn = await $('[data-testid="conn-toolbar-new-query"]');
          if (
            !(await newQueryBtn.isExisting()) ||
            !(await newQueryBtn.isDisplayed().catch(() => false))
          ) {
            newQueryBtn = await $('[data-testid="home-quick-new-query"]');
          }
          if (
            !(await newQueryBtn.isExisting()) ||
            !(await newQueryBtn.isDisplayed().catch(() => false))
          ) {
            await browser.pause(300);
            continue;
          }
          await newQueryBtn.waitForClickable({ timeout: Math.max(1000, deadline - Date.now()) });
          await newQueryBtn.click();
          await browser.pause(250);
          opened = await $('[data-testid="editor-execute-button"]')
            .isExisting()
            .catch(() => false);
        } catch {
          await browser.pause(300);
        }
      }
    }
    await $('[data-testid="editor-execute-button"]').waitForDisplayed({ timeout: 20000 });
    await hold(2000, 400);
  });

  it('第 2 幕：Editor Pro 写 SQL', async () => {
    // ════════════════════════════════════════════════════════════════
    // 第 2 幕：EDITOR PRO 写 SQL（8 点全保留）
    // ════════════════════════════════════════════════════════════════
    // 2.1 预置 SQL 执行成功（基线）
    await clickTestId('workspace-nav-databases');
    await browser.pause(500);

    await setEditorContent(BASE_QUERY);
    await hold(1500, 400);

    await clickTestId('editor-execute-button');
    await waitForResults();
    await hold(2500, 400);

    // 2.2 智能补全：输入 "SELECT r" 触发补全下拉
    await setEditorContent('SELECT r FROM demo_sales');
    await browser.execute(() => {
      const el = document.querySelector('.cm-editor .cm-content') as HTMLElement | null;
      el?.focus();
    });
    // 光标移到 r 之后，删掉重输触发补全
    await browser.keys(['Home']);
    await browser.keys([
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
    ]);
    await browser.pause(800);
    await hold(2000, 400);

    // 2.3 函数签名提示：SUM( 后悬停
    await setEditorContent('SELECT SUM(amount) FROM demo_sales');
    await browser.execute(() => {
      const el = document.querySelector('.cm-editor .cm-content') as HTMLElement | null;
      el?.focus();
    });
    await browser.keys(['End']);
    await browser.pause(800);
    await hold(2000, 400);

    // 2.4 实时 Linter：故意写错列名
    await setEditorContent('SELECT regio FROM demo_sales;');
    await browser.pause(1500);
    await hold(2000, 400);

    // 2.5 语句 gutter 运行：多语句，只看 gutter
    const multiStmt = `SELECT region, SUM(amount) AS total
FROM demo_sales
GROUP BY region;

SELECT quarter, SUM(amount) AS total
FROM demo_sales
GROUP BY quarter;`;
    await setEditorContent(multiStmt);
    await browser.pause(500);
    await hold(2000, 400);
    // 点第一条语句的 gutter 运行
    const gutterHit = await browser.execute(() => {
      const gutter = document.querySelector('.sql-statement-gutter .sql-gutter-marker');
      if (gutter) {
        (gutter as HTMLElement).click();
        return true;
      }
      return false;
    });
    if (gutterHit) {
      await waitForResults().catch(() => {});
      await hold(2000, 400);
    }

    // 2.6 Alt+Enter 意图菜单（Pro S4-C）
    await setEditorContent('SELECT * FROM demo_sales;');
    await browser.execute(() => {
      const el = document.querySelector('.cm-editor .cm-content') as HTMLElement | null;
      el?.focus();
      const sel = window.getSelection();
      if (sel && el?.firstChild) {
        sel.collapse(el.firstChild, 7);
      }
    });
    await browser.pause(300);
    await browser.keys(['Alt', 'Enter']);
    await browser.pause(800);
    await hold(2000, 400);
    await browser.keys(['Escape']);
    await browser.pause(300);

    // 2.7 工具条：格式化 + 历史 + 片段
    await setEditorContent('select region,sum(amount) as total from demo_sales group by region;');
    await hold(1000, 400);
    const formatBtn = $('[data-testid="editor-format-button"]');
    if (await formatBtn.isExisting()) {
      await formatBtn.click();
      await browser.pause(500);
      await hold(1500, 400);
    }
    // 历史
    await clickTestId('editor-history-toggle');
    await hold(1500, 400);
    await clickTestId('editor-history-toggle');
    await browser.pause(300);

    // 2.8 NL2SQL（AI 生成 SQL）— 最后一个 Pro 点
    if (aiReady) {
      // 打开 NL2SQL 面板（工具条 ✨ 按钮：aria-label 为 "AI 生成 SQL"）
      await browser.execute(() => {
        const buttons = document.querySelectorAll(
          '[data-testid="query-editor-toolbar"] button[aria-label*="AI"]',
        );
        (buttons[0] as HTMLElement | undefined)?.click();
      });
      await browser.pause(800);
      await hold(1500, 400);
      // 在 NL2SQL 输入框输入自然语言并生成
      await browser.execute((q: string) => {
        const scope = document.querySelector('[data-testid="query-editor-toolbar"]')?.parentElement;
        const ta = scope?.querySelector('textarea') as HTMLTextAreaElement | null;
        if (ta) {
          ta.focus();
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          )?.set;
          setter?.call(ta, q);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, '按 region 统计销售额倒序');
      await browser.pause(500);
      await hold(1500, 400);
      // 点「生成 SQL」按钮
      await browser.execute(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent?.includes('生成 SQL')) {
            (b as HTMLElement).click();
            return;
          }
        }
      });
      // 等待生成完成写入编辑器（最多 90s）
      await browser
        .waitUntil(
          async () =>
            browser.execute(() =>
              (document.querySelector('.cm-editor .cm-content')?.textContent || '').includes(
                'GROUP BY',
              ),
            ),
          { timeout: 90000, timeoutMsg: 'NL2SQL 未完成' },
        )
        .catch(() => {});
      await hold(2500, 400);
      // 执行生成的 SQL
      await clickTestId('editor-execute-button');
      await waitForResults().catch(() => {});
      await hold(2500, 400);
    }

    // 恢复可执行基线 SQL（给后面幕准备干净状态）
    await setEditorContent(BASE_QUERY);
    await clickTestId('editor-execute-button');
    await waitForResults();
    await hold(2000, 400);
  });

  it('第 3 幕：AI 诊断', async () => {
    // ════════════════════════════════════════════════════════════════
    // 第 3 幕：AI 诊断
    // ════════════════════════════════════════════════════════════════
    const brokenSQL = `SELECT regio, SUM(amount) AS total
FROM demo_sales
GROUP BY regio;`;
    await setEditorContent(brokenSQL);
    await hold(1000, 400);
    await clickTestId('editor-execute-button');
    await browser.pause(2000);
    await hold(1500, 400);

    // 点「诊断/AI 修复」
    const fixBtn = $('[data-testid="query-fix-sql"]');
    if (await fixBtn.isExisting()) {
      await fixBtn.click();
      await browser.pause(1000);
      await hold(2000, 400);
      if (aiReady) {
        // 等待诊断流式完成（最多 90s）
        await browser
          .waitUntil(
            async () =>
              browser.execute(() => {
                const panel = document.body.textContent || '';
                return (
                  panel.includes('应用修正') || document.querySelector('pre.text-green-400') != null
                );
              }),
            { timeout: 90000, timeoutMsg: 'AI 诊断未完成' },
          )
          .catch(() => {});
        await hold(3000, 500);
        // 点「应用修正」→ 重跑成功
        await browser.execute(() => {
          const btns = document.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent?.includes('应用修正')) {
              (b as HTMLElement).click();
              return;
            }
          }
        });
        await browser.pause(1000);
        await hold(1500, 400);
        await clickTestId('editor-execute-button');
        await waitForResults().catch(() => {});
        await hold(2500, 400);
      } else {
        await hold(2000, 400);
      }
    }
  });

  it('第 4 幕：AI 过滤', async () => {
    // ════════════════════════════════════════════════════════════════
    // 第 4 幕：AI 过滤（表浏览 → 自然语言过滤）
    // ════════════════════════════════════════════════════════════════
    // 右键/单击打开 demo_sales 表浏览
    await browser.execute(() => {
      const nav =
        document.querySelector('[data-testid="connection-navigator-aside"]') ??
        Array.from(document.querySelectorAll('aside')).find((a) =>
          a.querySelector('[data-conn-item]'),
        );
      const node = nav?.querySelector<HTMLElement>(
        '[data-testid="schema-tree-node"][data-item-name="demo_sales"]',
      );
      node?.click();
    });
    await browser.pause(1500);
    await hold(2000, 400);

    // 展开 ✨ 智能筛选
    const smartToggle = $('[data-testid="smart-filter-toggle"]');
    if (await smartToggle.isExisting()) {
      await smartToggle.click();
      await browser.pause(500);
      await hold(1500, 400);
      if (aiReady) {
        // 输入自然语言过滤条件
        await browser.execute((q: string) => {
          const inputs = document.querySelectorAll('input[placeholder*="自然语言"]');
          const input = inputs[0] as HTMLInputElement | undefined;
          if (input) {
            input.focus();
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              'value',
            )?.set;
            setter?.call(input, q);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, '金额大于 900 的华东数据');
        await browser.pause(500);
        await hold(1500, 400);
        // 点「筛选」解析
        await browser.execute(() => {
          const btns = document.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent === '筛选') {
              (b as HTMLElement).click();
              return;
            }
          }
        });
        await browser
          .waitUntil(
            async () =>
              browser.execute(() => {
                const t = document.body.textContent || '';
                return t.includes('已解析') || t.includes('筛选字段');
              }),
            { timeout: 60000, timeoutMsg: 'AI 过滤解析未完成' },
          )
          .catch(() => {});
        await hold(2500, 400);
      } else {
        await hold(1500, 400);
      }
    } else {
      await hold(1500, 400);
    }
  });

  it('第 5 幕：AI Chat', async () => {
    // ════════════════════════════════════════════════════════════════
    // 第 5 幕：AI CHAT（右侧抽屉 → 多轮 → 插入编辑器）
    // ════════════════════════════════════════════════════════════════
    // 回到查询页
    await clickTestId('workspace-nav-databases');
    await browser.pause(500);
    await clickTestId('conn-toolbar-ai');
    await $('[data-testid="ai-chat-panel"]')
      .waitForDisplayed({ timeout: 10000 })
      .catch(() => {});
    await hold(2000, 400);

    if (aiReady) {
      const chatExists = await $('[data-testid="ai-chat-panel"]').isExisting();
      if (chatExists) {
        // 第一轮提问
        await browser.execute((q: string) => {
          const field = document.querySelector('[data-testid="ai-input-field"] textarea');
          const ta = field as HTMLTextAreaElement | null;
          if (ta) {
            ta.focus();
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype,
              'value',
            )?.set;
            setter?.call(ta, q);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, '用 demo_sales 按 region 统计总销售额，倒序');
        await browser.pause(500);
        await hold(1000, 400);
        // 发送（Enter）
        await browser.execute(() => {
          const ta = document.querySelector(
            '[data-testid="ai-input-field"] textarea',
          ) as HTMLTextAreaElement | null;
          ta?.focus();
        });
        await browser.keys(['Enter']);
        // 等流式结束：assistant 气泡（bg-surface-alt 样式）出现即完成。
        await browser
          .waitUntil(
            async () =>
              browser.execute(
                () =>
                  document.querySelector(
                    '[data-testid="ai-chat-panel"] [data-testid="ai-code-block"]',
                  ) != null ||
                  document.querySelectorAll('[data-testid="ai-chat-panel"] .bg-surface-alt')
                    .length >= 1,
              ),
            { timeout: 120000, timeoutMsg: 'AI Chat 第一轮未完成' },
          )
          .catch(() => {});
        await hold(3000, 500);

        // 一键插入编辑器
        const inserted = await browser.execute(() => {
          const btn = document.querySelector(
            '[data-testid="ai-code-insert"]',
          ) as HTMLElement | null;
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        if (inserted) {
          await browser.pause(800);
          await hold(2000, 400);
        }
      }
    } else {
      await hold(1500, 400);
    }
  });

  it('第 6 幕：可视化上看板', async () => {
    // ════════════════════════════════════════════════════════════════
    // 第 6 幕：结果可视化 → 添加到看板
    // ════════════════════════════════════════════════════════════════
    // 回到查询页：先关 AI Chat 抽屉（若开着），再点 panel-tab 回查询面板。
    await browser.execute(() => {
      const chatOpen = !!document.querySelector('[data-testid="ai-chat-panel"]');
      if (chatOpen) {
        const btns = document.querySelectorAll('[data-testid="conn-toolbar-ai"]');
        (btns[0] as HTMLElement | undefined)?.click();
      }
    });
    await browser.pause(500);
    await browser.execute(() => {
      // panel-tab-select 才是可点的 tab 按钮；点回含「查询/Query」的那个，
      // 找不到就点第一个。
      const tabs = Array.from(document.querySelectorAll('[data-testid="panel-tab-select"]'));
      const q = tabs.find((t) => /查询|Query/i.test(t.textContent || ''));
      ((q ?? tabs[0]) as HTMLElement | undefined)?.click();
    });
    await browser.pause(800);
    await $('[data-testid="query-panel"]').waitForDisplayed({ timeout: 15000 });
    // 确保有一份可图表化的结果
    await setEditorContent(BASE_QUERY);
    await clickTestId('editor-execute-button');
    await waitForResults();
    await hold(2000, 400);

    // 切图表 Tab
    await clickTestId('result-workspace-view-chart');
    await hold(1000, 400);
    // 选柱状图
    const barBtn = $('[data-testid="chart-type-bar"]');
    if (await barBtn.isExisting()) {
      await barBtn.click();
      await hold(2500, 400);
    } else {
      await hold(2000, 400);
    }

    // 点数据点 → 跳回表格对应行（联动）
    await browser.execute(() => {
      const dot =
        document.querySelector('.recharts-bar-rectangle path') ??
        document.querySelector('.recharts-wrapper path');
      (dot as unknown as HTMLElement)?.click?.();
    });
    await browser.pause(800);
    await hold(1500, 400);
    // 回到图表
    await clickTestId('result-workspace-view-chart').catch(() => {});
    await hold(1500, 400);

    // 添加到看板
    await clickTestId('query-add-to-dashboard');
    await $('[data-testid="add-to-dashboard-dialog"]').waitForDisplayed({ timeout: 10000 });
    await hold(1500, 400);
    // 新建看板
    const newBtn = $('[data-testid="dashboard-target-new"]');
    if (await newBtn.isExisting()) {
      await newBtn.click();
      await browser.pause(500);
      await browser.execute((name: string) => {
        const input = document.querySelector(
          '[data-testid="dashboard-new-panel-name"]',
        ) as HTMLInputElement | null;
        if (input) {
          input.focus();
          input.select();
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          )?.set;
          setter?.call(input, name);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, '销售总览');
      await browser.pause(500);
      await hold(1500, 400);
    }
    await clickTestId('add-to-dashboard-confirm');
    await browser.pause(1500);
    await hold(2000, 400);

    // 跳到看板页验证 widget 落盘（createWidgetFromSql 后 emit dashboard:changed，
    // 主窗口内嵌看板面板展示）。
    await clickTestId('workspace-nav-dashboard');
    await $('[data-testid="dashboard-panel"]').waitForDisplayed({ timeout: 15000 });
    await browser
      .waitUntil(async () => (await $$('[data-testid="dashboard-tile"]')).length >= 1, {
        timeout: 30000,
        timeoutMsg: '看板 widget 未出现',
      })
      .catch(() => {});
    await hold(3000, 400);

    // ── Done ──
    await hold(1500, 400);
  });
});

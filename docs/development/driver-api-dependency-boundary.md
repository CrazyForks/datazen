# 驱动 ↔ 宿主解耦契约（Driver ↔ Host Dependency Boundaries）

> 本文件是 DataZen 驱动与宿主之间依赖边界的**唯一规范落点**。
> **Part 1** 约束 Rust 层 `packages/driver-api` 公共 API；**Part 2** 约束驱动前端（UI import 面、共享类型、i18n、宿主能力注入桥）。
> 历史名：Driver API Public Dependency Boundary（Part 1 即其原文）。
> 配套实操指南：[独立驱动开发指南（中文）](independent-driver-development.zh-CN.md) / [English](independent-driver-development.en.md)。

---

# Part 1 · Rust Driver API 公共依赖边界

`packages/driver-api` is the stable compile-time contract between DataZen and independent database driver extensions.

The API is published as the MIT-licensed `datazen-driver-api` crate. Its source of truth is the DataZen monorepo; there is no separate Driver API source repository.

## Public API rule

Public Driver API signatures and public fields may use:

- Rust primitives and standard-library types;
- types defined by `datazen-driver-api` itself;
- `serde` traits/attributes where required;
- `serde_json::Value` and other transport-neutral JSON data types.

They must not expose database implementation types.

## Forbidden public dependencies

The following must not appear in public traits, function signatures, public struct fields, enum variants, or public type aliases:

- `sqlx` types such as `Pool`, `Row`, `Transaction`, or database-specific errors;
- `tokio` runtime or synchronization types;
- database-specific crates such as `mongodb`, `redis`, `clickhouse`, `mysql_async`, `tokio-postgres`, and similar libraries;
- HTTP client implementation types such as `reqwest`;
- database pools, rows, transactions, cursors, or implementation-specific error types;
- any other third-party implementation type that an independent driver may reasonably need at a different version.

For example, this is forbidden:

```rust
pub trait DatabaseDriver {
    fn pool(&self) -> sqlx::Pool<sqlx::Postgres>;
}
```

Instead, the Driver API should expose an opaque handle:

```rust
pub struct ConnectionHandle {
    pub id: String,
    pub pool_id: String,
}
```

The driver owns and manages the real connection pool internally.

## Dependency layering

The intended dependency graph is:

```text
                         DataZen Host
                              │
                    datazen-driver-api
                              │
              ┌───────────────┼───────────────┐
              │               │               │
          Driver A         Driver B        Driver C
              │               │               │
           sqlx 0.7         sqlx 0.8        mongodb
              │               │               │
           private          private         private
```

Different drivers may use different database libraries or different versions of the same library. This is safe because implementation types never cross the API boundary.

## Foundation dependencies

`serde` and `serde_json` are allowed as transport-neutral data dependencies.

`async-trait` is currently used to express asynchronous driver traits. It is part of the Rust API implementation surface, but it is not a database implementation dependency.

`inventory` is intentionally used for compile-time driver registration. DataZen embeds drivers into the application binary rather than loading Rust shared libraries at runtime.

## Versioning

The Cargo crate version and the DataZen Driver protocol version are separate:

- **Crate version** follows Cargo/SemVer compatibility rules for the Rust API.
- **`PROTOCOL_VERSION`** represents DataZen ↔ Driver API protocol compatibility.

Internal dependency changes that do not affect public API types do not require a protocol-version change. Breaking public trait or protocol changes must be evaluated for both versions.

## Review checklist

Before merging a change to `packages/driver-api`:

- [ ] No `sqlx` type appears in public API.
- [ ] No database-specific crate type appears in public API.
- [ ] No `tokio` type appears in public API.
- [ ] Connection pools remain owned by the driver.
- [ ] Rows, cursors, and transactions use API-defined types or opaque handles.
- [ ] Cross-boundary errors use `DriverError` or another API-defined error type.
- [ ] Generic JSON data uses `serde_json` rather than a database-specific document type.
- [ ] New third-party dependencies are checked for accidental public exposure.
- [ ] Crate-version and protocol-version implications are considered.

## Development and publishing

DataZen itself consumes the crate through the workspace path dependency:

```toml
[workspace.dependencies]
datazen-driver-api = { path = "packages/driver-api" }
```

Independent extensions normally consume the published crate:

```toml
[dependencies]
datazen-driver-api = "0.1"
```

When developing an API change before publication, an independent extension can temporarily use a local path dependency pointing at `packages/driver-api`.

---

# Part 2 · 驱动前端与宿主解耦契约

> 适用范围：`packages/drivers/<id>/ui/**`（path 驱动与 git 驱动的前端代码，同一套规则）。
> 心智模型：驱动前端与 Rust 侧对偶——Rust 走 `datazen-driver-api` trait，前端走 `@datazen/driver-sdk` + `@datazen/ui` 两个包；宿主业务代码（`src/**`）对驱动是**不可见**的。

## 2.1 允许与禁止的 import 面

### 2.1.1 允许

驱动前端**只允许** import 以下四类来源：

| 允许来源 | 包名 / 形态 | 提供内容（以各包 `index.ts` 实际导出为准） |
| --- | --- | --- |
| 公共设计系统 | `@datazen/ui`（`packages/ui/src/index.ts`） | 基础组件 `Button` / `Input` / `Select` / `Dialog` / `Tabs` / `Badge` / `Label` / `Slider` / `TemporalValueInput` / `PathInput`；工具 `cn`；i18n 运行时 `t` / `useI18n` / `registerTranslations` / `getLocale` / `setLocale`（`setLocale` 的调用约束见 2.4）与类型 `I18nParams` |
| 驱动前端 SDK | `@datazen/driver-sdk`（`packages/driver-sdk/src/index.ts`） | 元数据契约 `DatabaseTypeMeta` / `ConnectionMode`；方言类型与 `BaseTableSqlGenerator`；下沉共享类型（`types/`：`ConnectionFormState`、`KeyEntry` / `KeyScanResult`、`NativeMenuItemDef` / `NativeMenuPredefined`、`ConnectionViewProps` 及配套）；Command IPC 封装 `driverCommands` / `fileCommands`；纯函数 `mergeDriverSettings` / `readBooleanField` / `applySchemaDefaults` / `listBooleanSchemaFields` / `listSchemaPropertyEntries` / `resolveEditorFontFamily` / `HOST_DEFAULT_EDITOR_FONT`；右键菜单 `showNativeContextMenu` / `hideNativeContextMenu` / `normalizeNativeMenuItems` / `nativeEditMenuItems` / `createNativeContextMenuHandler`；注入桥 `bind*` / `useBound*`（见 2.3）；Schema 同步 `syncSchemaTables` / `syncSchemaNamespace` / `registerPathAliases` / `getCachedPathItems` / `cachePathItems` / `subscribeSchemaPathItems` |
| 特权扩展点契约 | `@datazen/extension-points` | **仅 EP 契约类型**（扩展点定义 / 生命周期 / SQL Editor 增强契约）。普通数据库驱动通常不需要 import 它；该包**不导出任何 i18n 能力** |
| npm 依赖 | 驱动仓库自行声明的第三方包 | `react`、`react-dom` 及必要的 UI/工具库（自行承担版本与体积决策） |

裸包名 specifier 的解析方式（三处保持一致，均已存在）：

- 宿主应用构建：根 `tsconfig.json` 的 `paths` 与 `vite.config.ts` 的 `resolve.alias` 将 `@datazen/ui` / `@datazen/driver-sdk` 等映射到 `packages/*/src/index.ts`；
- 驱动单元测试：`vitest.drivers.config.ts` 的 `alias` 提供同样的映射，`pnpm test:unit:drivers` 即可脱离宿主跑驱动 UI 测试；
- 独立驱动仓库（git 驱动）：把宿主仓库的 `packages/ui`、`packages/driver-sdk` 作为本地 path 依赖引入同样的源码。

### 2.1.2 禁止

**禁止任何指向宿主 `src/**` 的 import**（含 `src/hooks`、`src/stores`、`src/lib`、`src/types`、`src/components`、`src/locales` 与 `src/extensions`），无论相对路径嵌套多深。

反例（❌ 均为违规写法，切勿照抄）：

```ts
// ❌ 反例 1：从宿主相对路径 import hook
import { useI18n } from '../../../../../src/hooks/useI18n';
// ❌ 反例 2：从宿主相对路径 import 工具 / 类型
import { cn } from '../../../../../src/lib/cn';
import type { KeyEntry } from '../../../../src/types';
```

正确写法（✅）：

```ts
// ✅ 一律经 @datazen/ui / @datazen/driver-sdk
import { cn, useI18n } from '@datazen/ui';
import type { KeyEntry } from '@datazen/driver-sdk';
```

补充约束：

- **唯一实现原则**：某能力一旦下沉到 `@datazen/ui` / `@datazen/driver-sdk`，宿主原路径（如 `src/lib/cn.ts`、`src/lib/nativeContextMenu.ts`、`src/commands/driver.ts`）只允许保留**薄再导出**（re-export 指向 SDK 单实现），不允许出现第二份实现；驱动永远 import 包名，不 import 宿主薄再导出路径。**薄再导出只为存量宿主消费方而留**：下沉时若全仓已无宿主 import 该路径，则宿主文件**直接删除、不留空壳**（`driverSettings` 即此例——`packages/driver-sdk/src/driverSettings.ts` 是唯一实现，宿主旧路径已不存在），消费点一并改为直接 import SDK。
- **SDK 的宿主防腐层**：`packages/driver-sdk/src/index.ts` 内部仍会以相对路径包装少量宿主模块（如方言与 `src/types` 的部分 type-only 出口）。这是 SDK 作为防腐层的允许行为，但**驱动侧不得效仿**——驱动可见面只有两个包的公开导出。
- **过渡期例外（截至本文件基准，实测全量清点）**：基线由下列命令得到，`packages/drivers/*/ui/**` 下指向宿主 `src/` 的相对 import 共 **34 处**：

  ```bash
  grep -rn "from '\.\./.*src/" packages/drivers/*/ui/
  ```

  1. **宿主 `useI18n` 相对 import：32 处 / 32 个文件**（**跨两个驱动，不止 redis**）——`packages/drivers/redis/ui/**` **31 处**（`connection/`、`value-editors/`、`key-browser/`、`observe/`、`console/`、`shared/` 等）+ `packages/drivers/sqlserver/ui/ConnectionFields.tsx:2` **1 处**。全部由并行轨 **`i18n-drivers`** 统一换源为 `@datazen/ui` 的 `useI18n`（见 2.4.5，同期落地），换源完成前该 32 处是唯一存量豁免，且**不得新增**。
  2. **宿主集成测试夹具：2 处 / 1 个文件**——`packages/drivers/redis/ui/__tests__/redisKeyWebContextMenu.test.tsx:5,9`（渲染宿主 `WebContextMenuHost`、断言宿主 `contextMenuStore`），协调者已裁决豁免、留待后续里程碑。

  另有 **8 处** `vi.mock` 指向宿主 `src/hooks/useI18n` 的相对路径（`packages/drivers/redis/ui/__tests__/` 下 8 个测试文件各 1 处）：因形态是 `vi.mock(...)` 而非 `from ...`，**不被上面那条命令命中**，但同属 `i18n-drivers` 换源范围。Wave 4 import 护栏若同时扫描 mock 路径，其白名单基线应为 **34 + 8 = 42 处**。

  **除上述登记范围（32 处 `useI18n` import + 2 处测试夹具 import + 8 处 `useI18n` mock）外不存在任何豁免。**

## 2.2 宿主能力取用模式（落点决策表）

驱动需要「宿主侧的东西」时，按下表决策，**按顺序**问自己：

| # | 问题的答案 | 落点 | 已有先例（可直接对照源码） |
| --- | --- | --- | --- |
| 1 | 纯函数 / 纯 IPC 封装，不读宿主 store、不依赖宿主模块状态？ | **下沉 `@datazen/driver-sdk`**（**移动**实现；宿主原路径**有存量消费方时**改薄再导出，**无消费方时直接移走、不留空壳**，见下方规则） | 留薄再导出壳：`src/lib/cn.ts` → `@datazen/ui`（整文件一行 `export { cn } from '@datazen/ui';`）；`src/lib/nativeContextMenu.ts:7-15` → `packages/driver-sdk/src/nativeContextMenu.ts`；`src/commands/driver.ts:6-11` → `packages/driver-sdk/src/ipc/driverCommands.ts`；`src/commands/file.ts:2/9` → 与 SDK `fileCommands` **合并再导出**（宿主另加 host-only 命令）。整体移走不留壳：`packages/driver-sdk/src/driverSettings.ts`（宿主 `src/lib/driverSettings.ts` 已于 `92a039383` 移走且不存在，宿主消费点 `JsonSchemaSettingsForm` / `DriverSettingsSection` 改为直接 import SDK） |
| 2 | 需要宿主的 zustand store / React hook 的**运行时状态或行为**？ | **建注入桥**：SDK 内新增 `xxxBridge.ts`，导出 `bindX()` + `useBoundX()`；宿主在 store/hook 定义处模块加载时 bind（见 2.3） | `settingsStoreBridge` / `connectionStoreBridge` / `confirmDialogBridge` / `schemaStoreBridge` |
| 3 | 纯共享**数据类型**（type-only）？ | **下沉 `packages/driver-sdk/src/types/*.ts`** 并从 index 导出；宿主源位置 re-export 兼容存量 | `types/kv.ts`（`KeyEntry` / `KeyScanResult`）、`types/menu.ts`、`types/connection-form.ts`、`types/connection-view.ts` |
| 4 | 只对宿主壳层有意义（窗口路由、面板布局、Tab 管理…）？ | **留在宿主**。驱动通过 props 回调（如 `ConnectionViewProps` 的 `ConnectionViewActions`）或 Driver Command 与之交互，宿主代码 import 驱动入口由 `generated.ts` codegen 完成 | `src/lib/connectionViews/types.ts`（re-export 自 SDK 类型） |
| 5 | 是对宿主核心表面（SQL 编辑器 / 图表）的特权深度增强，对键入延迟有严苛要求？ | **不是驱动，走 EP**：`@datazen/extension-points` 扩展点插槽（独立维度，见 [extensibility.md](../architecture/frontend/extensibility.md) 与 AGENTS.md 四维扩展体系） | `sqlEditorProEP` |

**为什么不做「bridge 式回退查表」**（防止后人重新引入）：任何「驱动查不到就悄悄回落到宿主实现/宿主字典」的隐式双源，都会在同一能力上产生宿主与包两份真值、掩盖真实耦合并使驱动无法独立编译与测试；显式 `bindX()` 把缺失绑定变成模块加载期的一次确定性抛错（`'<X> has not been bound to driver-sdk yet.'`），问题在开发期即刻暴露，而不是在用户机器上静默错乱。

## 2.3 能力注入桥清单与用法

### 2.3.1 现有 bridge 清单

| 能力 | SDK 模块 | 宿主注入 API | 驱动消费 API | 宿主 bind 时机（代码出处） |
| --- | --- | --- | --- | --- |
| 设置 store | `packages/driver-sdk/src/settingsStoreBridge.ts` | `bindSettingsStore(store)` | `useBoundSettingsStore`（selector / `getState` / `setState`） | `src/stores/settingsStore.ts` 文件末尾 `bindSettingsStore(useSettingsStore)` |
| 连接配置 store | `packages/driver-sdk/src/connectionStoreBridge.ts` | `bindConnectionStore(store)` | `useBoundConnectionStore`（selector / `getState`） | `src/stores/connectionStore.ts` 文件末尾 `bindConnectionStore(useConnectionStore)` |
| 确认对话框 | `packages/driver-sdk/src/confirmDialogBridge.ts` | `bindConfirmDialog(hook)` | `useBoundConfirmDialog(): [ConfirmDialogFn, ReactNode]` | `src/hooks/useConfirmDialog.tsx` 定义处 `bindConfirmDialog(useConfirmDialog)` |
| Schema store | `packages/driver-sdk/src/schemaStoreBridge.ts` | `bindSchemaStore(store)` | `useBoundSchemaStore` + `syncSchemaTables` / `syncSchemaNamespace` / `registerPathAliases` / `getCachedPathItems` / `cachePathItems` / `subscribeSchemaPathItems` | `src/stores/schemaStore.ts` 文件末尾 `bindSchemaStore(useSchemaStore)` |
| Web 右键菜单挂载 | `packages/driver-sdk/src/nativeContextMenu.ts` | `bindContextMenuBridge({ show, hide })` | `showNativeContextMenu` / `hideNativeContextMenu`（纯函数直接调用，无需 useBound*） | `src/stores/contextMenuStore.ts` 模块加载时 `bindContextMenuBridge({...})` |

约束（全部由现有实现强制，勿绕开）：

1. **bind 只发生在宿主侧、模块加载期**（store/hook 定义文件末尾），保证任何驱动 UI 被渲染时桥必已绑定；**驱动/测试从不调用 `bindX`**（单测例外：测试内可用 harness store 显式 bind，见 `packages/drivers/redis/ui/__tests__/useRedisGate.test.tsx` 的做法）。
2. 未绑定即消费 ⇒ 抛错 `'<X> has not been bound to driver-sdk yet.'`（`show/hideNativeContextMenu` 例外：`hide` 在未绑定时是安全的 no-op，因为 show 必先抛错、菜单不可能已打开）。
3. 消费形态模仿 zustand：`useBoundSettingsStore((s) => ...)` 在 React 组件内订阅；`useBoundSettingsStore.getState()` 在事件回调/异步路径命令式读取。桥类型只暴露驱动所需的**状态子集**（如 `SettingsBridgeState` 只有 `settings.safeMode / editorFontFamily / driverSettings`），新增字段须同时收窄评审。
4. SDK 包 `sideEffects: false`（`packages/driver-sdk/package.json`），因此**新增 bridge 模块不得引入顶层副作用**；宿主 bind 调用是宿主 store/hook 模块自身的顶层副作用，随该模块被宿主应用 import 而必然执行。

### 2.3.2 最小用法示例（与真实 API 签名一致）

宿主侧——在 store 定义文件末尾注入（真实出处：`src/stores/settingsStore.ts`）：

```ts
// 宿主 src/stores/settingsStore.ts（节选）
import { bindSettingsStore } from '@datazen/driver-sdk';

export const useSettingsStore = create<...>()(/* ... */);

// 模块加载即注入：驱动经 useBoundSettingsStore 读取，不 import 宿主代码
bindSettingsStore(useSettingsStore);
```

驱动侧——组件内订阅 + 事件路径命令式读取 + 确认对话框（真实出处：`packages/drivers/redis/ui/shared/SafeModeBadge.tsx`、`packages/drivers/redis/ui/shared/useRedisGate.ts`）：

```tsx
// 驱动 ui/xxx.tsx
import { useBoundSettingsStore, useBoundConfirmDialog } from '@datazen/driver-sdk';

function SafeModeBadge() {
  // React 订阅形态（zustand selector 形状）
  const safeMode = useBoundSettingsStore((s) => s.settings.safeMode);
  // ...
}

async function gateWrite(): Promise<boolean> {
  // 非渲染路径命令式读取
  const safeMode = useBoundSettingsStore.getState().settings.safeMode;
  const [confirm, dialog] = useBoundConfirmDialog(); // [ConfirmDialogFn, ReactNode]
  return confirm({ title: '...', message: '...', kind: 'warning' });
  // dialog 需在组件树中渲染一次
}
```

## 2.4 i18n 契约（单一运行时 + 词条自注册）

> 本节描述**终态契约**。其中「驱动词条自注册」与「驱动 UI 换源 `@datazen/ui` 的 `useI18n`」由并行轨 **`i18n-drivers` 同期落地**（截至本文件基准尚未合并）；已落地部分（单一运行时、宿主 `setLocale` 接线）在 2.4.1 / 2.4.2 标注。设计红线：**`@datazen/ui` 是唯一 i18n 实现；没有 bridge 概念、没有兼容 re-export；只有宿主调用 `setLocale`；词条由各 package 自己提供并自注册；驱动侧 `t()` key 是普通 `string`。**

### 2.4.1 唯一运行时（已由 i18n-core 轨落地）

全部查表 / 回落 / 插值逻辑只存在于一处：`packages/ui/src/i18n.ts`（经 `@datazen/ui` 导出），公开 API 仅五个：

```ts
setLocale(locale: string): void;                       // 切换语言并通知订阅者
getLocale(): string;                                    // 当前激活 locale
registerTranslations(
  resources: Record<string, Record<string, string>>,
): void;                                                // 唯一词条注册入口（重复注册为后写覆盖合并）
t(key: string, params?: I18nParams): string;            // registry[locale] ?? registry['en'] ?? key，再做 {param} 插值
useI18n(): { t: typeof t; language: string };           // useSyncExternalStore 订阅 locale 变化的 React hook
```

- 没有任何 Host↔包 locale bridge、没有第二套引擎、没有兼容 re-export 层（历史上 `@datazen/extension-points` 的 i18n bridge 模型已整体删除，该包不再导出任何 i18n 符号）。
- 宿主内部 `src/hooks/useI18n.ts` 是**宿主消费点别名**（re-export 自 `@datazen/ui`），仅宿主自身组件使用；驱动/扩展一律直接 `import { useI18n } from '@datazen/ui'`。

### 2.4.2 `setLocale` 只有宿主调用（已落地）

宿主唯一接线点：`src/lib/localeSync.ts` 的 `startLocaleSync()`——以 `settingsStore.settings.language` 播种并在其变化时调用 `setLocale`；由 `src/main.tsx` 启动时调用一次。驱动、扩展（含 Pro EP）生产路径出现任何 `setLocale` 调用即违规。编译期无法强制此约束，由 Wave 4 import 护栏（2.6）lint 兜底。

### 2.4.3 词条归属：各 package 自注册

| 词条集合 | 拥有者 | 注册方式 |
| --- | --- | --- |
| 宿主 UI 词条 | `src/locales/*`（领域包结构） | `src/locales/index.ts` 模块加载时把 eager 字典 `registerTranslations` 灌入共享注册表；lazy 域包经 `useLocaleDomains` / `ensureLocaleDomains` 按需注册 |
| 驱动词条 | `packages/drivers/<id>/locales/`（如 redis、mongodb 各语言文件） | **自注册（`i18n-drivers` 轨同期落地）**：新增纯副作用模块 `packages/drivers/<id>/locales/index.ts`，静态 import 本目录全部语言字典后一次性 `registerTranslations({...})`；由该驱动 UI 的入口模块（即 `generated.ts` 实际 import 的首个驱动 UI 模块，如 redis 的 `ui/shared/meta.ts`、mongodb 的 `ui/meta.ts`）挂一行 `import '../locales';` 副作用。驱动一经装载即完成注册，宿主不需要知道驱动有哪些语言包 |
| Pro 扩展词条 | `packages/pro-extensions/*` 各自 locales | 直接 `import { registerTranslations } from '@datazen/ui'`（EP 经 `globalThis.__DATAZEN_HOST__['@datazen/ui']` 与宿主共享同一单例，见 `src/main.tsx`） |

配套终态（同由 `i18n-drivers` 轨落地，勿提前按旧链路开发）：

- 宿主端 `DRIVER_LOCALES` 聚合链路**整体删除**：`src/extensions/generated-locales.ts` 及其在 `scripts/resolve-drivers.mjs` 中的 codegen、相关脚本引用一并移除——不存在「宿主替驱动收集词条」这一步。
- 语言 code 字面量与宿主保持一致（`zh-CN`、`zh-TW`、`pt-BR` 一律带连字符）。核对时注意**「仓库里有语言文件」≠「宿主已接线该语言」**，真值分三层各取不同出处：
  - **宿主实际接线的内置语言只有 `en` 与 `zh-CN`**：`src/locales/builtinLocales.ts:9` 的 `BUILTIN_LOCALES = ['en', 'zh-CN']`（真值源 `src/locales/builtin-locales.json`；`BUILTIN_LOCALE_LABELS` 同文件 :26-29 亦只有这两项；`src/locales/fullLocales.ts` 供测试/工具用，同样只含这两个）。
  - **其余 8 个语言目前只做 parity 校验、未进 `BUILTIN_LOCALES`**：`de`、`es`、`fr`、`ja`、`ko`、`pt-BR`、`ru`、`zh-TW`，以文件形态存在于 `src/locales/`（如 `src/locales/pt-BR.ts` + `src/locales/pt-BR/`），由 `scripts/i18n-sync-check.mjs:23` 的 `LOCALE_FILES` 逐个列表做词条校验；除 `src/locales/` 内部再导出外，生产路径无运行时 import。
  - 因此 **`zh-CN` 的连字符以 `BUILTIN_LOCALES` 为出处，`pt-BR` 的连字符以 `LOCALE_FILES`（`scripts/i18n-sync-check.mjs:23`）与语言文件名（`src/locales/pt-BR.ts`、`packages/drivers/redis/locales/pt-BR.ts`、`packages/drivers/mongodb/locales/pt-BR.ts`）为出处**。驱动包 `locales/` 现覆盖 10 个语言文件（redis、mongodb 各 10），其文件名必须与宿主同名同分隔符；新增语言只加文件，不改宿主 `BUILTIN_LOCALES`（除非该语言确已接线）。

### 2.4.4 key 命名与类型

- 驱动词条 key 必须带**驱动自有前缀**（现状：`redis.*`、`mongo.*`），与宿主前缀互斥，保证合并进同一注册表不碰撞；新增 key 只改本包 `en.ts`（唯一 source of truth），其余语言由同步工具补齐。
- 驱动侧 `t()` 的 key 是**普通 `string`**：没有编译期 `I18nKey` 字面量联合约束（宿主 `I18nKey` 是宿主内部编译期约束，与驱动无关），驱动组件中不得出现 `as I18nKey` 之类宿主类型断言。
- 词条完整性（parity）改由脚本扫描保证（`i18n-drivers` 轨同期落地）：`node scripts/i18n-sync-check.mjs` 以各包 `en.ts` 为 source 校验其余语言文件 key 集合一致（该脚本当前仅扫描宿主 `src/locales`，驱动目录扫描随该轨加入）。

### 2.4.5 驱动 UI 消费写法

```tsx
import { useI18n } from '@datazen/ui';

function RedisConsole() {
  const { t } = useI18n();
  return <span>{t('redis.console')}</span>;        // 普通 string key
}
```

非 React 上下文（如校验器）不 import i18n——由宿主/SDK 把 `t` 作为参数注入，先例：`@datazen/driver-sdk` 的 `DriverFormValidator` 类型第二参数即为 `t: (key: string) => string`。

### 2.4.6 语言切换行为

语言切换 = 宿主 settingsStore `language` 变化 → `setLocale` → 所有 `useI18n` 消费组件（宿主、驱动、EP）即时重渲染；驱动 UI 无需任何监听代码，也不允许自行持久化语言偏好。

## 2.5 新增宿主依赖时的标准流程

1. 按 2.2 决策表选落点；
2. 若下沉纯函数/IPC：**移动**实现进 SDK（禁止复制），宿主原路径**有存量消费方则改薄再导出、无消费方则连文件一并删除**，全仓保持单实现；
3. 若建注入桥：SDK 新增 `xxxBridge.ts`（`bindX` + 未绑定抛错 + `useBoundX` 收窄类型），宿主在对应 store/hook 定义处 bind，并为桥补 SDK 侧单测（先例：`packages/driver-sdk/__tests__/`）；
4. 驱动侧只 import 包名并更新本文件 2.3.1 清单表；
5. 生产代码零 `../../../src/` 新增（Wave 4 护栏将强制，见 2.6）。

## 2.6 Wave 4 import 护栏（预告）

上述禁止项将由 Wave 4 的构建期 import 护栏脚本强制执行（扫描 `packages/drivers/*/ui/**` 与 EP 包中的宿主相对 import、驱动侧 `setLocale` 调用等）。**具体脚本文件名与 CI 位置尚未确定（待 Wave 4 落地）**；在其出现之前，本文件 2.1–2.4 的约束以代码评审 + 2.5 自查清单执行。

## 2.7 契约自查清单（Reviewer / CI 预备）

- [ ] 驱动 UI 无任何 `.../src/` 形态宿主 import（2.1.2 登记的过渡期例外除外；现网基线 = `grep -rn "from '\.\./.*src/" packages/drivers/*/ui/` 命中 **34 处**（32 宿主 `useI18n` + 2 测试夹具）+ 8 处 `vi.mock` 宿主 `useI18n` 路径；**命中数超过该基线即为新增违规**，少于基线说明换源有进展应同步更新 2.1.2）。
- [ ] 驱动 UI 的组件/工具/类型仅来自 `@datazen/ui`、`@datazen/driver-sdk`、`@datazen/extension-points`（仅 EP 类型）、npm 依赖。
- [ ] 新共享类型为移动而非复制，宿主存量 import 零改动（薄 re-export）。
- [ ] 新 bridge 具备：宿主模块加载期 bind、未绑定抛错文案、消费侧类型收窄、SDK 侧单测。
- [ ] 驱动词条带自有前缀，只改本包 `en.ts`，经本包 `locales/index.ts` 自注册（不新增宿主聚合 codegen）。
- [ ] 驱动/扩展代码零 `setLocale` 调用；i18n 一律 `import { t | useI18n } from '@datazen/ui'`。

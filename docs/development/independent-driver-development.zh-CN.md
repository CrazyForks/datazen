# 独立驱动开发指南

本文介绍如何在独立 Git 仓库中开发 DataZen 数据库 Driver，并使用本地 DataZen 源码作为编译、运行和调试宿主。

DataZen Driver 在**编译期**集成，不通过运行时 Rust 动态库 ABI 加载。推荐开发目录布局：

```text
workspace/
├── datazen/
└── datazen-driver-mydb/
```

Driver 仓库保持独立，本地 DataZen 仓库仅用于将 Driver 与应用一起编译，并调试完整的 Rust + 前端集成。

## 1. 前置条件

安装 DataZen 的常规开发前置依赖，确保 DataZen 仓库能在添加 Driver 之前成功构建。

然后把 Driver 仓库放在 DataZen 同级目录：

```text
~/workspace/
├── datazen/
└── datazen-driver-mydb/
```

两个仓库不需要合并为一个 Git 仓库，Driver 也不需要成为 DataZen Git 仓库的成员。

## 2. 创建 Driver 仓库

Driver 应是一个独立的 Rust 项目。典型布局：

```text
datazen-driver-mydb/
├── Cargo.toml
├── Cargo.lock
├── src/
│   └── ...
├── ui/
│   └── ...
└── README.md
```

Rust 和前端的具体结构取决于 Driver 提供的能力。Driver 可以只包含 Rust 驱动，也可以提供前端组件（数据库元数据、连接表单、连接视图、设置、Schema 树、SQL 方言及相关 UI 集成）。

Driver 应依赖公开的 `datazen-driver-api`，不要依赖 DataZen 应用内部模块。

## 3. 在 DataZen 中注册本地 Driver

开发阶段在 `drivers-registry.json` 中使用 `source: "path"` 注册：

```json
{
  "mydb": {
    "source": "path",
    "path": "../datazen-driver-mydb",
    "feature": "driver-mydb",
    "description": "MyDB driver"
  }
}
```

路径相对于 DataZen 仓库。该 registry 已对内置 Driver 使用相同的 `source: "path"` 形式，也支持 `source: "git"` 的独立托管 Driver。参见 `drivers-registry.json` 现有条目。

> **开发工作流：** 本地修改 `drivers-registry.json` 是预期行为，不会影响 GitHub `main` 分支。只有提交并合并 PR 后才会成为共享配置。

### 可选的本地覆盖

DataZen 支持 `.drivers-dev.json` 作为 gitignored 的本地覆盖配置，用于不修改已提交的 `drivers-registry.json` 的场景：

```json
{
  "kiwi": {
    "source": "path",
    "path": "../datazen-driver-kiwi"
  }
}
```

对于新 Driver，直接编辑 `drivers-registry.json` 是让本地开发配置显式可复现的最简方式。

## 4. 用 Driver 构建 DataZen

DataZen 的 Driver 选择通过 `--drivers`（或 `DATAZEN_DRIVERS`）控制。Resolver 读取 `drivers-registry.json`，解析请求的 Driver ID，生成所需的构建配置，并注入选中的 Driver 依赖/Feature 到 DataZen 构建中。

```bash
cd ~/workspace/datazen
pnpm tauri:dev --drivers=mydb
```

也可以与内置 Driver 组合使用：

```bash
pnpm tauri:dev --drivers=basic,mydb
```

`basic` 展开为四个核心 Driver（`postgres`、`mysql`、`sqlite`、`redis`）。`all` 展开为 registry 中所有 `source: "path"` Driver。也支持自定义逗号分隔列表：

```bash
pnpm tauri:dev --drivers=postgres,mysql,mydb
```

### `--drivers` 实际做了什么

`--drivers` 是**构建时 Driver 选择**，不是运行时动态加载选项。概念流程：

```text
--drivers=mydb
        │
        ▼
drivers-registry.json
        │
        ▼
resolve-drivers.mjs
        │
        ├── Cargo dependency
        ├── Cargo feature
        └── generated frontend registry
        │
        ▼
DataZen binary containing the driver
```

Rust Driver 在构建时被编译并链接到 DataZen 应用中。运行时通过正常的 Driver 注册机制发现编译后的 Driver，不通过平台特定的共享库 ABI 加载。

## 5. 开发 Rust 端

在 Driver 仓库中直接修改代码：

```bash
cd ~/workspace/datazen-driver-mydb
```

然后在 DataZen 仓库中重新构建/运行：

```bash
cd ~/workspace/datazen
pnpm tauri:dev --drivers=mydb
```

因为 registry 使用本地 `path` 依赖，Cargo 会从 `../datazen-driver-mydb` 构建当前源码。无需将 Driver 源码复制到 `packages/`，也无需提交到 DataZen 仓库。

Driver 的 Rust 实现应使用 DataZen driver API，并通过 API 提供的注册机制注册 Driver，使编译后的 Driver 参与 DataZen 的正常 Driver Registry。

## 6. 开发前端

Driver 也可以贡献前端组件。选中 Driver 的前端集成与应用的其余部分一起包含在 DataZen 前端构建中。

```text
Driver 仓库
      │
      ├── Rust 实现
      │
      └── 前端实现
               │
               ▼
        DataZen 前端构建
               │
               ▼
          DataZen 应用
```

这便于调试——Driver UI 代码运行在真实的 DataZen 应用上下文中，而非独立的 Mock Host。可以在真实的 React/Tauri 环境中调试 Driver。

当前 Driver Resolver 从选中的 Driver 集合生成 gitignored 的 `src/extensions/generated.ts`。前端贡献与 Rust Driver 属于同一构建时选择。当这些文件缺失时，`pnpm install` / `pnpm build` 会自动运行 `--codegen-only`。

添加前端功能时，遵循 registry 中现有外部 Driver（如 Kiwi、OLAP、Superset）使用的结构和约定。

## 7. 迭代开发循环

标准开发流程：

```text
1. 编辑 Driver 源码
       ↓
2. 用 --drivers=mydb 启动/重启 DataZen
       ↓
3. DataZen 解析本地 path Driver
       ↓
4. Rust + 前端被编译到 DataZen 中
       ↓
5. 在真实 DataZen 应用中调试 Driver
       ↓
6. 重复
```

Rust 变更时，Cargo 重新编译受影响的 Driver 代码。前端变更时，使用正常的 DataZen 前端开发工具链调试 UI。

## 8. 独立测试 Driver

Driver 仓库应保留自己的测试和 CI。尽可能在不依赖 DataZen 应用的情况下独立测试 Driver。**禁止将 Driver 专属测试添加到 Host**（`src-tauri/`、`src/`、`e2e/specs/`）。本仓库的 Path Driver 遵循相同规则：测试位于 `packages/drivers/<id>/`（`#[cfg(test)]`、`tests/`、`ui/__tests__/`、`e2e/`）。详见 [AGENTS.md](../../AGENTS.md)「驱动测试落点」。

```bash
cd ~/workspace/datazen-driver-mydb
cargo test
```

Driver 有前端代码时，同时运行 Driver 仓库定义的前端检查。

这些测试验证 Driver 本身。用 `--drivers=mydb` 运行 DataZen 验证的是 Driver 与当前 DataZen 源码树的集成。

## 9. 发布前验证

Driver 应在两种形式下验证：

### 本地集成

```bash
cd ~/workspace/datazen
pnpm tauri:dev --drivers=mydb
```

验证当前 Driver 源码可以被编译并被 DataZen 使用。

### 独立构建/测试

```bash
cd ~/workspace/datazen-driver-mydb
cargo test
```

适用时同时运行 Driver 仓库的前端检查。

## 10. 从本地开发切换到 Git 依赖

Driver 发布后，DataZen 可以从独立 Git 仓库消费它。

开发阶段：

```json
{
  "mydb": {
    "source": "path",
    "path": "../datazen-driver-mydb",
    "feature": "driver-mydb"
  }
}
```

提交到 DataZen registry 时，可将 Driver 固定到特定 Git revision：

```json
{
  "mydb": {
    "source": "git",
    "git": "https://github.com/example/datazen-driver-mydb.git",
    "ref": "<commit-sha>",
    "feature": "driver-mydb"
  }
}
```

固定 commit 确保 DataZen 构建可复现，避免静默更换 Driver 版本。

切换流程：

```text
本地开发
source = path
path = ../datazen-driver-mydb
        │
        ▼
验证集成
        │
        ▼
发布 Driver 仓库
        │
        ▼
提交 DataZen registry PR
        │
        ▼
source = git
ref = <固定 commit>
```

## 11. 提交 DataZen Registry 变更

Driver 仓库和 DataZen 仓库保持独立。

Driver 准备好纳入 DataZen 时：

1. 推送 Driver 仓库并发布所需 revision。
2. 在 DataZen 仓库创建分支。
3. 将 Driver 的 registry 条目从本地 `path` 源切换为 Git 仓库和固定 revision。
4. 选中该 Driver 运行 DataZen 构建/测试。
5. 向 DataZen 仓库发起 Pull Request。
6. DataZen 仓库维护者审核并合并 registry 变更。

本地开发期间的 `drivers-registry.json` 修改不影响 GitHub `main`。只有合并的 PR 会改变共享 registry。

## 12. 推荐仓库布局

完整的独立驱动开发工作空间：

```text
~/workspace/
├── datazen/
│   ├── drivers-registry.json
│   ├── scripts/
│   ├── src/
│   ├── src-tauri/
│   └── ...
│
└── datazen-driver-mydb/
    ├── Cargo.toml
    ├── Cargo.lock
    ├── src/
    ├── ui/
    └── ...
```

两个仓库独立存在，但本地文件系统布局允许 DataZen 现有的 `source: "path"` 和 `--drivers` 机制将 Driver 编译到应用中。

## 13. 总结

推荐的开发模式：

- Driver 保留在**自己的 Git 仓库**中。
- Driver checkout 保持在 **DataZen checkout 旁边**。
- 开发期间在 DataZen 中用 `source: "path"` 注册 Driver。
- 用 `pnpm tauri:dev --drivers=<driver-id>` 运行 DataZen。
- 让 DataZen 在构建时将 Driver 编译到应用中。
- 使用真实的 DataZen 应用调试 Rust 集成和前端 UI。
- Driver 测试和 CI 保留在 Driver 仓库中。
- 准备发布时，通过 Pull Request 将 DataZen registry 条目切换为固定的 `source: "git"` revision。

此模式保持 Driver 源码独立，同时保留 DataZen 的编译时集成模型，避免运行时 Rust 动态库加载的 ABI/版本问题。

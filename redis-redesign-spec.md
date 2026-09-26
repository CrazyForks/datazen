# Redis Workbench 布局重新设计 - 设计规范

## 目标截图
参考 `redis-workbench-prototype.html`（已在 workspace 根目录）。

## 核心变化（对照当前代码 vs 目标）

### 1. 移除 WorkbenchToolbar（独立信息行）
- **文件**: `packages/drivers/redis/ui/key-browser/WorkbenchToolbar.tsx`
- **变化**: 删除 `WorkbenchToolbar` 组件（不是 BatchSummaryBanner，那个保留）
- **原因**: 目标布局中，db 名称、dbSize、loadedCount、import/export、flush 等信息不再单独占一行，已合并到 R1

### 2. R1 统一行重新设计
- **文件**: `packages/drivers/redis/ui/key-browser/KeyTreeHeader.tsx`
- **当前 R1 内容**: SearchModeTabs + 计数器 + 全选/清空/TTL/删除/刷新/新建 6 个按钮
- **目标 R1 内容**: SearchModeTabs + 分隔线 + 计数器 + spacer + 全选/刷新/新建 3 个按钮
- **删除的按钮**: 清空选择(XSquare)、批量TTL(Clock)、批量删除(Trash2)
- **保留的按钮**: 全选(CheckSquare)、刷新(RefreshCw)、新建(Plus)

### 3. R2 搜索行精简
- **文件**: `packages/drivers/redis/ui/key-browser/KeyTreeSearchRow.tsx`
- **变化**: 移除类型过滤 Select（`redis-tree-chip-type`）
- **保留**: 搜索框 + 模糊芯片 + 仅无过期芯片

### 4. 移除 R3 分组行
- **文件**: `packages/drivers/redis/ui/key-browser/KeyTreePane.tsx`
- **变化**: 删除 `KeyTreeGroupRow` 的渲染
- **文件**: `packages/drivers/redis/ui/key-browser/KeyTreeGroupRow.tsx`
- **变化**: 文件保留但不再被引用（可选删除）

### 5. RedisWorkbench.tsx 布局重组
- 删除 WorkbenchToolbar 的渲染
- BatchSummaryBanner 保留在 R1 下方
- BatchPatternBar 保留
- 左侧面板结构变为: R1 → R2 → KeyTreeColumn
- 右侧面板不变（RedisRightPanel 的 tabs 保持原位）

### 6. 样式一致性
- 使用现有的 `--c-surface-alt`、`--c-edge`、`--c-accent` 等 token
- 按钮使用 `Button` from `@datazen/ui`，variant="ghost"
- 芯片样式使用现有 Chip 组件模式
- 暗色主题下边框用 `border-edge`，背景用 `bg-surface-alt`

## 文件修改清单

| 文件 | 操作 |
|------|------|
| `packages/drivers/redis/ui/key-browser/KeyTreeHeader.tsx` | 修改：移除 3 个批量操作按钮，调整布局 |
| `packages/drivers/redis/ui/key-browser/KeyTreeSearchRow.tsx` | 修改：移除类型过滤 Select |
| `packages/drivers/redis/ui/key-browser/KeyTreePane.tsx` | 修改：移除 KeyTreeGroupRow 渲染 |
| `packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx` | 修改：移除 WorkbenchToolbar 渲染，调整布局 |
| `packages/drivers/redis/ui/key-browser/WorkbenchToolbar.tsx` | 保留（BatchSummaryBanner 还在用） |

## 禁止事项
- 不要修改主题色 token（`themes.css`）
- 不要修改 RedisRightPanel 的 tabs 布局
- 不要修改 DetailColumn
- 不要修改 KeyTreeColumn/KeyTreeList（列表渲染不变）
- 不要引入新的 CSS 文件或样式方案
- 不要修改 i18n key（只用现有 key）

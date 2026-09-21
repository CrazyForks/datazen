# PRD v2: 可视化查询构建器（Visual Query Builder）

> Feature ID: `QUERY_BUILDER` · Version: `2.0.0` · Status: Draft
> 参考：[Navicat Query Builder](https://www.navicat.com/en/company/aboutus/blog/673-design-select-queries-using-navicat-s-query-builder)、DataZen 原设计稿

## 1. 背景与动机

DataZen 的核心查询入口是基于 CodeMirror 的 SQL 编辑器，适合熟悉 SQL 的用户。但以下场景存在痛点：

- **探索性查询**：用户不确定表名/列名，需要先查 Schema 再手写 SQL。
- **复杂 JOIN**：多表关联查询的 ON 条件编写繁琐且易出错。
- **条件组合**：嵌套 `AND`/`OR` 条件在纯文本编辑器中难以可视化管理。
- **新用户门槛**：不熟悉 SQL 语法的用户需要频繁查阅文档。

**可视化查询构建器**参考 Navicat Query Builder 的交互范式，通过图形化界面降低门槛，同时生成标准 SQL 并可直接执行。

## 2. 设计参考：Navicat Query Builder 布局

Navicat Query Builder 采用**三区域布局**：

```
┌────────────┬──────────────────────────────────────────┐
│  数据库对象  │           图表设计区 (Diagram)              │
│  (对象树)    │   ┌─────────┐      ┌─────────┐          │
│            │   │ users   │─┬───│ orders  │          │
│  ☰ Schema  │   │ ☑ id    │ │   │ ☑ id    │          │
│  └─ Tables │   │ ☑ name  │ │   │ ☑ user_id│          │
│    ├ users │   │ ☐ email │ │   │ ☑ amount │          │
│    ├ orders│   └─────────┘ │   └─────────┘          │
│    └ films │               │ ON users.id =           │
│            │               │     orders.user_id       │
│            ├───────────────┴──────────────────────────┤
│            │           条件/配置区 (Criteria Grid)       │
│            │  Field | Table | Alias | Sort | Func |    │
│            │  ------|-------|-------|------|------|    │
│            │  id    | users |       | ASC  |      |    │
│            │  name  | users |       |      |      |    │
│            │  amount|orders |       | DESC |      |    │
│            ├──────────────────────────────────────────┤
│            │           SQL 语法区 (Syntax)              │
│            │  SELECT users.id, users.name, orders.*    │
│            │  FROM users JOIN orders ON ...             │
│            │  WHERE ... ORDER BY ...                   │
└────────────┴──────────────────────────────────────────┘
```

### 2.1 核心交互范式

| 交互 | 描述 |
|------|------|
| **拖入表** | 从左侧对象树拖拽表到图表区，或双击添加 |
| **勾选字段** | 在表卡片中勾选列，自动加入 SELECT |
| **自动 JOIN** | 检测外键关系，自动在图表区绘制连线 |
| **手动 JOIN** | 从一表的字段拖到另一表的字段建立 JOIN |
| **条件配置** | 在下方 Criteria Grid 中为字段设置 WHERE 条件 |
| **聚合/排序** | 在 Criteria Grid 中直接设置聚合函数和排序方向 |

## 3. 功能范围（v1.0）

### 3.1 核心功能（Must Have）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **数据库对象树** | 左侧面板展示当前数据库的 Schema → Table/View 树 | P0 |
| **图表区 (Diagram)** | 中间画布区域，表以卡片形式展示，可拖拽移动 | P0 |
| **表卡片** | 每个表显示为卡片，包含表名、所有列（列名 + 数据类型 + PK/FK 徽章） | P0 |
| **字段勾选** | 卡片内 Checkbox 勾选字段进入 SELECT 列表 | P0 |
| **表别名** | 支持为表设置别名（AS） | P0 |
| **自动 JOIN 检测** | 基于外键约束自动识别表间关系，在图表区绘制连线 | P0 |
| **手动 JOIN** | 从一表字段拖到另一表字段建立 JOIN 连线 | P0 |
| **JOIN 类型** | 支持 INNER / LEFT / RIGHT / FULL JOIN | P0 |
| **WHERE 条件** | 在 Criteria Grid 中为字段设置筛选条件 | P0 |
| **ORDER BY** | 在 Criteria Grid 中设置排序方向（ASC/DESC） | P0 |
| **聚合函数** | 在 Criteria Grid 中选择 COUNT/SUM/AVG/MIN/MAX | P0 |
| **GROUP BY** | 自动根据聚合函数推断，或手动设置分组字段 | P0 |
| **DISTINCT** | 勾选 DISTINCT 选项 | P0 |
| **LIMIT/OFFSET** | 设置分页参数 | P1 |
| **SQL 预览** | 底部实时生成对应方言的 SQL 语句 | P0 |
| **一键应用** | 将生成的 SQL 插入/替换 SQL 编辑器内容 | P0 |
| **方言适配** | PostgreSQL / MySQL / SQLite 三种方言 | P0 |

### 3.2 增强功能（Should Have，v1.1）

| 功能 | 描述 |
|------|------|
| **HAVING** | 聚合后的筛选条件 |
| **子查询** | 将构建器当前配置作为子查询嵌入外层 |
| **模板保存** | 保存/加载查询构建器配置模板 |
| **撤销/重做** | 操作历史栈 |

### 3.3 不在范围内（v1.0）

- INSERT/UPDATE/DELETE 等写操作构建
- 存储过程/函数调用构建
- 多数据库跨库查询构建

## 4. UI 详细设计

### 4.1 三区域布局

```
┌─────────────────────────────────────────────────────────┐
│ Header: [📊 Visual Builder] [DISTINCT ☐] [Reset] [✕]  │
├────────┬────────────────────────────────────────────────┤
│        │                                                │
│ 对象树  │              图表区 (Diagram)                   │
│ (200px)│                                                │
│        │   ┌──────────┐     JOIN 连线     ┌──────────┐  │
│ Schema │   │  users   │ ═══════════════ │  orders   │  │
│ ├─users│   │ ■ id PK  │                 │ ■ id      │  │
│ ├─orders│  │ □ name   │                 │ ■ user_id │  │
│ └─films│   │ □ email  │                 │ □ amount  │  │
│        │   └──────────┘                 └──────────┘  │
│        │                                                │
├────────┼────────────────────────────────────────────────┤
│        │           Criteria Grid (配置区)                │
│        │  ┌───────┬───────┬───────┬──────┬──────┬─────┐│
│        │  │ Field │ Table │Alias  │ Sort │ Func │Where││
│        │  ├───────┼───────┼───────┼──────┼──────┼─────┤│
│        │  │ id    │ users │       │ ASC  │      │     ││
│        │  │ name  │ users │       │      │      │     ││
│        │  │ amount│orders │       │ DESC │ SUM  │>100 ││
│        │  └───────┴───────┴───────┴──────┴──────┴─────┘│
├────────┼────────────────────────────────────────────────┤
│        │           SQL Preview (语法区)                  │
│        │  SELECT users.id, users.name,                  │
│        │         SUM(orders.amount)                     │
│        │  FROM users                                    │
│        │  INNER JOIN orders ON users.id = orders.user_id│
│        │  GROUP BY users.id, users.name                 │
│        │  HAVING SUM(orders.amount) > 100               │
│        │  ORDER BY users.id ASC                         │
│        │  LIMIT 50;                                     │
│        │                              [Apply SQL ▶]     │
└────────┴────────────────────────────────────────────────┘
```

### 4.2 表卡片设计

```
┌─ users ──────────────┐
│ 📋 users             │  ← 表名 + 图标
│ ─────────────────────│
│ ☑ id      INT    PK  │  ← Checkbox + 列名 + 类型 + PK 徽章
│ ☑ name    VARCHAR    │
│ ☐ email   VARCHAR    │
│ ☐ created_at TIMESTAMP│
│ ─────────────────────│
│ Alias: [        ]    │  ← 表别名输入框
└──────────────────────┘
```

**列项设计**：
- 左侧 Checkbox：勾选进入 SELECT
- 列名：显示列名
- 数据类型：灰色小字显示类型（INT, VARCHAR, TIMESTAMP 等）
- PK/FK 徽章：主键显示 `PK`（金色），外键显示 `FK`（蓝色）

### 4.3 JOIN 连线设计

```
┌──────────┐                              ┌──────────┐
│  users   │                              │  orders  │
│ ■ id  PK │══════════════════════════════│ ■ user_id│
│ □ name   │     ON users.id =            │ □ amount │
│ □ email  │         orders.user_id       │ □ status │
└──────────┘                              └──────────┘
```

**连线样式**：
- 实线：已建立的 JOIN
- 虚线：自动检测到的 FK 关系（未确认）
- 线上标签：显示 `ON table1.col = table2.col`
- 线上类型：显示 `INNER JOIN` / `LEFT JOIN` 等

**交互**：
- 从一表的字段拖到另一表的字段 → 建立 JOIN
- 点击连线 → 编辑 JOIN 类型（INNER/LEFT/RIGHT/FULL）
- 右键连线 → 删除 JOIN

### 4.4 Criteria Grid 设计

采用类似 Excel 的网格布局，每行一个字段，列包含：

| 列名 | 宽度 | 描述 |
|------|------|------|
| ☑ | 30px | 勾选是否包含在 SELECT 中 |
| Field | auto | 字段名（下拉选择） |
| Table | 100px | 所属表名（自动填充） |
| Alias | 100px | 字段别名（可选） |
| Sort | 80px | 排序方向（None/ASC/DESC 下拉） |
| Func | 100px | 聚合函数（None/COUNT/SUM/AVG/MIN/MAX） |
| Where | auto | WHERE 条件（操作符 + 值） |
| Group | 50px | 是否 GROUP BY（Checkbox） |

**WHERE 条件单元格**：
- 点击展开：`[操作符 ▼] [值输入框]`
- 操作符：=, !=, >, <, >=, <=, LIKE, NOT LIKE, IN, NOT IN, IS NULL, IS NOT NULL
- 多条件：支持 AND/OR 逻辑

### 4.5 SQL Preview 设计

- 底部只读区域，实时更新
- 语法高亮（关键字蓝色，字符串绿色，数字橙色）
- 字体：等宽字体（JetBrains Mono / Fira Code）
- 最大高度 200px，可拖拽调整

## 5. 状态模型

### 5.1 Zustand Store：`queryBuilderStore`

```typescript
interface QueryBuilderState {
  // ── 选择状态 ──
  selectedTables: string[];                    // 已选表名列表
  tableAliases: Record<string, string>;        // 表别名映射
  selectedColumns: QbColumnSelection[];        // 已选列

  // ── JOIN 状态 ──
  joins: QbJoin[];                            // JOIN 列表

  // ── 条件状态 ──
  where: QbConditionGroup;                    // WHERE 条件组

  // ── 排序/分组 ──
  orderBy: QbSortItem[];
  groupBy: Array<{ table: string; column: string }>;
  distinct: boolean;
  limit: number | null;
  offset: number | null;

  // ── UI 状态 ──
  isOpen: boolean;
  previewSql: string;
  canvasOffset: { x: number; y: number };     // 画布偏移
  zoom: number;                               // 缩放比例

  // ── 画布中表卡片位置 ──
  tablePositions: Record<string, { x: number; y: number }>;
}

interface QbJoin {
  id: string;
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
}

interface QbColumnSelection {
  table: string;
  column: string;
  alias?: string;
  aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  sort?: 'ASC' | 'DESC';
  groupBy?: boolean;
  where?: QbCondition;
}
```

### 5.2 SQL 生成器

基于当前 `src/lib/sqlDialects/queryBuilder.ts` 扩展，新增：
- `generateJoinClause(joins)` → 生成 JOIN 子句
- `generateLimitClause(limit, offset)` → 生成 LIMIT/OFFSET
- 增强 `generateWhereClause` 支持嵌套条件组

## 6. 用户交互流程

```
用户打开查询标签页
    ↓
点击工具栏「Visual Builder」按钮（魔棒图标）
    ↓
构建器面板展开（与 SQL 编辑器上下并列）
    ↓
┌─ 从左侧对象树拖入表 ─→ 表卡片出现在画布 ─→ 自动检测 FK 连线
│                                                    ↓
│                                          勾选字段（卡片内 Checkbox）
│                                                    ↓
│                                          在 Criteria Grid 配置条件/排序/聚合
│                                                    ↓
│                                          实时 SQL 预览更新
│                                                    ↓
└──────────────────────────── 点击「Apply SQL」
                                        ↓
                              SQL 编辑器内容更新
                                        ↓
                              用户可手动微调后执行
```

## 7. 非功能需求

| 维度 | 要求 |
|------|------|
| **性能** | Schema 元数据加载 < 500ms；SQL 预览实时更新无感知延迟 |
| **可用性** | 键盘导航（Tab 切换、Enter 确认、Esc 取消）；拖拽操作流畅 |
| **响应式** | 窗口宽度 < 800px 时切换为纵向堆叠布局 |
| **国际化** | 中英文完整支持 |
| **可访问性** | 所有交互元素可聚焦、有 ARIA 标签 |

## 8. 验收标准

1. 用户可以从左侧对象树拖入表到画布，表以卡片形式展示列信息（含 PK/FK 徽章和数据类型）。
2. 勾选卡片中的字段，自动加入 SELECT 列表，并在 Criteria Grid 中显示。
3. 自动检测外键关系并在画布上绘制 JOIN 连线；支持手动拖拽建立 JOIN。
4. JOIN 类型支持 INNER / LEFT / RIGHT / FULL。
5. Criteria Grid 中可配置 WHERE 条件、排序方向、聚合函数。
6. WHERE 条件支持 `=`、`!=`、`>`、`<`、`>=`、`<=`、`LIKE`、`IN`、`IS NULL`、`IS NOT NULL`。
7. 嵌套 AND/OR 条件生成正确括号。
8. LIMIT/OFFSET 可配置。
9. 生成的 SQL 可在 SQL 编辑器中直接执行并返回正确结果。
10. PostgreSQL / MySQL / SQLite 三种方言 SQL 生成正确。
11. 暗色主题样式一致。
12. 中英文切换正常。

## 9. 里程碑

| 阶段 | 交付物 | 预估工时 |
|------|--------|---------|
| M1: 类型定义 + Store（含 JOIN/画布状态） | 状态模型、类型系统 | 3d |
| M2: SQL 生成器（含 JOIN/LIMIT） | 纯函数 + 单元测试 | 3d |
| M3: 画布组件（表卡片 + 拖拽 + 连线） | Canvas/Diagram 组件 | 5d |
| M4: 对象树 + 字段勾选 | 左侧面板 + 卡片交互 | 3d |
| M5: Criteria Grid | 网格配置组件 | 4d |
| M6: SQL 预览 + 编辑器集成 | 实时预览 + 一键应用 | 2d |
| M7: i18n + 测试 + 文档 | 国际化、E2E、文档 | 3d |
| **合计** | | **23d** |

## 10. 与现有实现的差异

| 功能 | 当前实现 | v1.0 目标 |
|------|---------|-----------|
| 布局 | 两栏表单式 | 三栏画布式（对象树+图表区+配置区） |
| 表展示 | Checkbox 列表 | 画布内卡片（含列信息+PK/FK） |
| 表操作 | Checkbox 勾选 | 拖入画布 + 卡片内勾选 |
| JOIN | ❌ 缺失 | 自动检测 + 手动连线 |
| 条件配置 | WhereClause 组件 | Criteria Grid（类 Excel） |
| 排序配置 | SortClause 组件 | Criteria Grid 内置 |
| 分组配置 | GroupByClause 组件 | Criteria Grid 内置 |
| LIMIT | ❌ 缺失 | Criteria Grid / 独立配置 |

## 11. 技术方案要点

### 11.1 画布渲染

- 使用 `react-flow` 或自定义 Canvas/SVG 实现画布
- 表卡片作为可拖拽节点
- JOIN 连线作为 SVG 路径（贝塞尔曲线）
- 支持缩放和平移

### 11.2 外键检测

- 通过 Schema 元数据获取外键约束信息
- 自动在画布上绘制虚线表示 FK 关系
- 用户确认后转为实线（正式 JOIN）

### 11.3 Criteria Grid

- 自定义网格组件，支持行选择、单元格编辑
- 每行对应一个 SELECT 字段
- 列：Field / Table / Alias / Sort / Func / Where / Group
- 支持拖拽行排序

### 11.4 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/components/query-builder/` | **重构** | 画布组件、表卡片、Criteria Grid |
| `src/stores/queryBuilderStore.ts` | **重构** | 新增 JOIN/画布/LIMIT 状态 |
| `src/lib/sqlDialects/queryBuilder.ts` | **扩展** | 新增 JOIN/LIMIT 生成 |
| `src/windows/connection/query/QueryEditorSection.tsx` | 修改 | 面板布局调整 |
| `src/locales/*/query.ts` | 修改 | 新增 i18n key |

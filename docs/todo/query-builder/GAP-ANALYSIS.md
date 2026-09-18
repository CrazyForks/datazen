# Gap Analysis: 设计稿 vs 当前实现

> 日期: 2026-09-15 · 基于 PRD.md / DESIGN.md / IMPLEMENTATION.md / prototype.html
> 参考: [Navicat Query Builder](https://www.navicat.com/en/company/aboutus/blog/673-design-select-queries-using-navicat-s-query-builder)
> 重构目标: [PRD-v2.md](./PRD-v2.md)

## 1. 核心差距总览

| 维度 | 设计稿 | 当前实现 | 差距 |
|------|--------|---------|------|
| **布局模型** | 三栏画布式：左(对象树) + 中(画布) + 右(配置) + 底(SQL) | 两栏表单式：左(表/列选择) + 右(条件/排序/分组) + 底(SQL) | 🔴 架构级差异 |
| **表操作** | 拖拽表到画布，表以卡片形式展示列信息 | Checkbox 勾选表名 | 🔴 交互范式完全不同 |
| **列展示** | 卡片内列出列名 + 数据类型 + PK/FK 徽章 | Checkbox 勾选列名 | 🔴 信息密度与交互缺失 |
| **JOIN** | 拖拽连线建立 JOIN（SVG 动画线），自动识别主外键 | ❌ 完全缺失 | 🔴 核心功能缺失 |
| **可视化连线** | SVG 连线 + JOIN 标签 + 动画 | ❌ 无 | 🔴 设计核心卖点缺失 |
| **LIMIT/OFFSET** | 原型中有 LIM 配置行 | ❌ v1.0 PRD 未列入 | 🟡 原型有但 PRD 未要求 |
| **条件构建** | 右侧配置面板 | WhereClause 组件 | 🟢 已实现 |
| **排序** | 右侧配置面板 | SortClause 组件 | 🟢 已实现 |
| **分组** | 设计稿有 GROUP BY | GroupByClause 组件 | 🟢 已实现 |
| **聚合** | 设计稿有聚合函数 | ColumnSelector 支持聚合 | 🟢 已实现 |
| **SQL 预览** | 底部实时预览 | SqlPreview 组件 | 🟢 已实现 |
| **应用到编辑器** | 底部 Apply 按钮 | Apply SQL 按钮 | 🟢 已实现 |

## 2. 逐项详细差距

### 2.1 🔴 布局模型（架构级差异）

**设计稿描述**：
```
┌──────────┬──────────────────────────┬──────────────┐
│ 数据库对象 │       画布 (Canvas)       │   配置面板    │
│ (对象树)   │  ┌─────┐   SVG连线   ┌─────┐ │  SELECT 字段  │
│           │  │users│ ◄────────► │orders│ │  JOIN 关系    │
│           │  │     │           │     │ │  WHERE 条件   │
│           │  └─────┘           └─────┘ │  排序/限制    │
│  拖拽提示   │                          │              │
└──────────┴──────────────────────────┴──────────────┘
┌──────────────────────────────────────────────────────┐
│              实时生成的 SQL (预览)                      │
└──────────────────────────────────────────────────────┘
```

**当前实现**：
```
┌─ Header: Title | Distinct ☐ | Reset | Close ───────┐
│  ┌── 左栏 ──┐  ┌── 右栏 ─────────────────────────┐ │
│  │ Tables   │  │ WHERE                            │ │
│  │ ☑ users  │  │ [table] [col] [=] [value] [+ del]│ │
│  │ ☑ orders │  │ ORDER BY                         │ │
│  │          │  │ [col] [ASC/DESC] [+ del]         │ │
│  │ Columns  │  │ GROUP BY                         │ │
│  │ ☑ id     │  │ [col] [+ del]                    │ │
│  │ ☑ name   │  └──────────────────────────────────┘ │
│  └──────────┘                                       │
│  SQL Preview (只读)                                  │
│  [Apply SQL]                                        │
└─────────────────────────────────────────────────────┘
```

**差距**：设计稿是**画布式交互**（拖拽 + 连线），当前是**表单式交互**（勾选 + 下拉）。

### 2.2 🔴 表卡片与画布

**设计稿**：
- 每个表在画布上是一个**独立卡片**
- 卡片头部：表名 + 图标
- 卡片内容：列出所有列，每列显示列名 + 数据类型 + PK/FK 徽章
- 卡片可**拖拽移动**
- 卡片有 **hover 高亮**和**选中状态**

**当前实现**：
- 表只是 Checkbox 列表中的名称
- 无卡片视图
- 无列信息预览（需点击后才在 ColumnSelector 中显示）

### 2.3 🔴 JOIN 连线

**设计稿**：
- 从 `users.id` 拖到 `orders.user_id` 建立 JOIN
- 自动生成 SVG 连线（虚线 + 动画）
- 连线上显示 `ON users.id = orders.user_id` 标签
- 自动识别主外键关系

**当前实现**：
- 完全没有 JOIN 功能
- PRD v1.0 将 JOIN 列为"增强功能（v1.1）"
- 但设计稿和原型**明确展示了 JOIN 作为核心功能**

### 2.4 🔴 列信息展示

**设计稿**：
```
┌─ users ─────────────┐
│ ✓ id      INT   PK  │
│ ✓ name    VARCHAR   │
│ ✓ email   VARCHAR   │
│   created_at TIMESTAMP│
└─────────────────────┘
```

**当前实现**：
```
Columns
☑ id
☑ name
☑ email
☐ created_at
```

**差距**：缺少数据类型显示、PK/FK 徽章、表头分组。

## 3. 设计稿中的功能清单 vs 实现状态

| # | 功能 | 设计稿状态 | 实现状态 | 优先级 |
|---|------|-----------|---------|--------|
| 1 | 数据库对象树（Schema → Table） | ✅ 左侧面板 | ❌ 未实现（用 TableSelector 简化替代） | P0 |
| 2 | 画布式表卡片展示 | ✅ 中间画布 | ❌ 未实现 | P0 |
| 3 | 拖拽表到画布 | ✅ 拖拽交互 | ❌ 未实现 | P0 |
| 4 | 列信息卡片（名+类型+PK/FK） | ✅ 卡片内容 | ❌ 未实现 | P0 |
| 5 | 列勾选（进入 SELECT） | ✅ 卡片内 Checkbox | ⚠️ 在 ColumnSelector 中实现，非画布内 | P1 |
| 6 | 拖拽连线建 JOIN | ✅ SVG 连线 | ❌ 未实现 | P0 |
| 7 | JOIN ON 条件标签 | ✅ 连线标签 | ❌ 未实现 | P0 |
| 8 | 主外键自动识别 | ✅ PK/FK 徽章 | ❌ 未实现 | P1 |
| 9 | WHERE 条件构建 | ✅ 右侧配置 | ✅ WhereClause 实现 | P0 |
| 10 | ORDER BY 配置 | ✅ 右侧配置 | ✅ SortClause 实现 | P0 |
| 11 | GROUP BY 配置 | ✅ 右侧配置 | ✅ GroupByClause 实现 | P0 |
| 12 | 聚合函数 | ✅ 设计稿隐含 | ✅ ColumnSelector 支持 | P1 |
| 13 | DISTINCT | ✅ Header 区域 | ✅ Header Checkbox | P0 |
| 14 | SQL 预览（实时） | ✅ 底部 | ✅ SqlPreview 实现 | P0 |
| 15 | 应用到编辑器 | ✅ Apply 按钮 | ✅ Apply SQL 按钮 | P0 |
| 16 | LIMIT/OFFSET | ✅ 原型中有 | ❌ 未实现 | P2 |
| 17 | 方言适配 | ✅ DESIGN.md | ✅ queryBuilder.ts 实现 | P0 |
| 18 | i18n | ✅ DESIGN.md §7 | ✅ en/zh-CN 实现 | P0 |
| 19 | 单元测试 | ✅ DESIGN.md §8 | ✅ 132 个测试通过 | P0 |
| 20 | E2E 测试 | ✅ DESIGN.md §8 | ✅ journey 测试通过 | P0 |

## 4. 结论

当前实现是一个**功能正确的表单式查询构建器**，但与设计稿的**画布式交互范式**存在架构级差距：

- **已实现**：SQL 生成引擎、条件/排序/分组 UI、SQL 预览、应用到编辑器、方言适配、i18n、测试
- **未实现**：画布式布局、拖拽交互、表卡片视图、JOIN 连线、主外键识别、LIMIT/OFFSET

**核心问题**：设计稿描述的是一个类似 dbForge Query Builder / MySQL Workbench Data Modeler 风格的**可视化画布工具**，而当前实现更接近一个**结构化表单**。

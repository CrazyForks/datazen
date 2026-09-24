# ER 图 × Navicat 差距分析

> 状态：**分析完成，待排期**
> 基线：`main` @ 2026-09-21（只读 ER 视图 + FK 推测引擎已上线）
> 对标：Navicat Data Modeler / Navicat Premium 内的 Model 工具

## 0. 一句话结论

**两个东西不是同一类产品。** Navicat 的 ER 是"可编辑、可保存、可与库同步的模型"；
我们的 ER 是"库元数据的只读投影"。差距按性质分四层：

| 层 | 性质 | 处置 |
| --- | --- | --- |
| 一、读图体验 | 可补，成本低 | 排期做（P1） |
| 二、正确性缺口 | 缺陷，不是对标问题 | 立刻修（P0） |
| 三、建模工程能力 | 产品定位决策 | 单独立项（P3） |
| 四、差异化优势 | 我们的强项 | 别在对标中丢掉 |

---

## 1. 当前实现盘点

| 维度 | 现状 |
| --- | --- |
| 入口 | 工具栏/首页快捷入口；schema 树右键"聚焦此表"；连接窗口 panel tab |
| 渲染 | 表节点（列名 + 类型 + PK/FK 徽章、可折叠、列级连接点）；声明 FK 动画实线 / 推测关系琥珀虚线 / 歧义淡显无标签 |
| 交互 | 搜索高亮 + 变暗、焦点模式（只显示相关表）、缩放/适配/小地图、拖拽节点、右键（打开表/复制名/聚焦） |
| 输出 | PNG/SVG 导出（html-to-image）、表/关系/推测 统计 |
| 数据 | `get_er_data` 一次性取全库 `TableSchema`（列、主键、索引、外键），前端纯计算布局（连通性 BFS + 网格） |

---

## 2. 差距一：读图体验（对齐 Navicat 的 diagram 浏览）

Navicat 对应能力：Crow's Foot / IDEF1X / UML 三种记号法、display options（显示列注释/
仅键列/紧凑）、auto layout、layers、notes、undo/redo、导出 PNG/SVG/PDF/SQL/数据字典。

### 2.1 没有基数与可选性记号（价值最高）

Navicat 用记号法表达 1:1、1:n、可选/强制参与；我们只有箭头方向 + 列名标签，于是
`FK 列上有唯一索引` 的 1:1 与普通 n:1 长得一模一样，`nullable` 的"可选参与"完全没画。

**数据都已在手**，是纯渲染工作：

- `IndexInfo.isUnique` → 1:1 判定（`packages/driver-api/src/types.rs:369`）
- `ColumnSchema.nullable` → 可选/强制参与（`packages/driver-api/src/types.rs:357`）
- 落点：`src/windows/connection/er/buildErGraph.ts:233`、`er/TableNode.tsx:67`

### 2.2 列信息只画了 name + type

`comment` / `defaultValue` / `isAutoIncrement` 驱动已返回（`types.rs:354-362`），但
`buildErGraph.ts:234-239` 只映射了 4 个字段；`onUpdate` / `onDelete` 规则（`ForeignKeyInfo`）
也没上画布。

### 2.3 显示策略单一

全展开 + `max-h 300px` 滚动。缺：只看键列、自定义可见列、紧凑模式、按模块/前缀着色。

### 2.4 缺"读图"的交互

- 悬停表不高亮其关系（组件没挂 `onNodeMouseEnter`）
- 点连线无详情、无两侧跳转（没挂 `onEdgeClick`）
- 搜索只做高亮变暗，不能定位跳转；没有对象导航树

### 2.5 布局不持久

节点位置只在内存（`useNodesState`），切焦点或重开面板即回网格；无对齐/分布工具，
布局算法不可选。Navicat 的图是可保存的模型，不存在这个问题。

### 2.6 导出

- **背景色硬编码 `'#1a1a2e'`**（`ErDiagramView.tsx:255`、`:270`）——浅色主题下导出的图是深底，
  属于 bug 级
- 无 PDF / 打印 / 数据字典导出

### 2.7 大库性能

一次读全库所有表的所有列（N+1 次元数据查询），全量渲染所有节点与列；无表级概览模式、
无按需展开、无虚拟化。

---

## 3. 差距二：正确性缺口（不是对标问题，是缺陷）

### 3.1 PG 多 schema 被压平

- `get_tables` 返回 `(schema, bare name)`（`packages/drivers/postgres/src/connection.rs:112`）
- 但 `get_er_data` 调 `get_table_schema` 时丢掉了 `table.schema`
  （`src-tauri/src/commands/schema.rs:299`）
- 节点 id 用裸 `tableName`（`er/buildErGraph.ts:233`）

后果三条：

1. 同名表（`public.users` / `archive.users`）→ **重复 node id**，React Flow 冲突
2. 列读取按 `search_path` 解析，可能读到另一个 schema 的同名表
3. 跨 schema 外键认不出来（`visibleNames` 里根本没有限定名）

Navicat 的模型天然是 (schema, table) 二维，不存在此问题。

**修复方向**：`get_er_data` 传限定名（`schema.tableName`），节点 id 同步改为限定名；
PG 驱动已有 `parse_pg_table_ref` 支持限定名（`packages/drivers/postgres/src/schema.rs:79`）。
同期检查 `SchemaCache` 的 key 是否也按 (schema, table) 区分。

---

## 4. 差距三：建模与工程能力（最大鸿沟，但需产品决策）

Navicat Data Modeler 的能力集：概念/逻辑/物理三层模型、逆向工程（库或 SQL → 模型）、
正向工程（模型 → DDL/建库）、模型↔库同步比对、三种记号法、图层/便签/撤销重做、
PNG/SVG/PDF/SQL/数据字典导出、模型文件与云端协作、AI 辅助设计。

我们这一层全部没有；且 ER 与已有的 Schema Diff 子窗口是两套互不相通的东西
（一个看图、一个算 DDL 差异）。

**取舍要看清楚**：

| | 我们的图（投影） | Navicat 的图（模型） |
| --- | --- | --- |
| 一致性 | 永远与库一致 | 会漂移，须靠逆向/同步维持 |
| 维护成本 | 零 | 需要保存、版本、团队同步 |
| 能力上限 | 只读 | 可编辑、可正向工程 |

引入"模型态"涉及写库安全（Safe Mode）、DDL 生成、文件格式与版本迁移，成本量级与这个
tab 完全不同 —— **建议单独立项，不要塞进 ER tab**。

---

## 5. 差异化优势（对标时别丢掉）

- **无约束库的 FK 推测**：我们能在零外键的库上画出关系；Navicat 只能显示声明式约束
- **零配置**：打开即看，无模型文件、无逆向工程步骤
- **panel tab 集成**："看图 → 打开表"动线连续；Navicat 是独立模型工作区

---

## 6. 优先级建议

| 级别 | 项 | 说明 |
| --- | --- | --- |
| **P0** | 多 schema 限定（§3.1） | 正确性缺陷，后端一处小改 + node id 口径 |
| **P1** | 基数/可选性记号（§2.1） | 数据已在手，纯渲染；对"看懂"收益最大 |
| **P1** | 列注释与键列过滤（§2.2/2.3） | 数据已在手 |
| **P1** | 悬停高亮关系 + 连线详情（§2.4） | 读图动线 |
| **P1** | 导出背景跟随主题（§2.6） | bug 级 |
| **P1** | 节点位置持久化（§2.5） | 按 `dbSessionId`/`database` 存 |
| **P2** | 大库按需加载 / 表级概览模式（§2.7） | 需先定规模目标（多少表算大库） |
| **P2** | 与 Schema Diff 打通（"从 ER 生成差异"） | 两套东西收敛 |
| **P3** | 可编辑模型 / 模型文件 / 正向工程（§4） | 单独立项，产品定位决策 |

---

## 附：Navicat 能力来源

- <https://www.navicat.com.cn/products/navicat-data-modeler.html>
- <https://www.navicat.com/en/products/navicat-data-modeler>
- <https://m.php.cn/faq/3071916.html>（Navicat 建 ER 图流程）
- <https://m.php.cn/faq/2195689.html>（正向工程建表）

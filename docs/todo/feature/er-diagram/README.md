# ER 图（Entity-Relationship Diagram）

把数据库结构画成可读的关系图，作为连接窗口的一个 panel tab，目标是"看懂这个库"，
而不是"设计这个库"。

- [Navicat 差距分析与优先级](./gap-navicat.zh-CN.md) — 现状盘点、四层差距、P0~P3 排期建议
- 实现现状见 `docs/architecture/frontend/components.md` §8

## 定位

> **库的投影，不是模型。**

ER 图每次从元数据现算（`get_er_data` → `buildErGraph`），永远与库一致、零维护、零配置文件；
代价是不可编辑、布局不落盘。要不要引入"模型态"（可编辑 + 存盘 + 正向工程）是产品定位决策，
不塞进这个 tab，见差距分析第四节。

## 差异化（相对 Navicat）

- **无声明外键的库也能画出关系**（推测引擎，见 `docs/todo/feature/fk-prediction/`）；
  Navicat 只渲染声明的约束，零外键的库要么空白要么手工画
- **打开即看**：不需要建模型、不需要逆向工程动作
- 与数据/结构面板同为 panel tab，"看图 → 打开表"动线连续

## 状态

**只读视图已上线**（含推测关系、搜索、聚焦、折叠、PNG/SVG 导出）。
差距分析已落档，P0/P1 待排期。

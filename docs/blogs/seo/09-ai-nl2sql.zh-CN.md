---
title: "AI 驱动的 SQL 编辑器：DataZen NL2SQL 功能详解"
description: "DataZen 内置 AI Chat 面板，支持自然语言转 SQL 查询（NL2SQL）。输入一句中文描述，即可自动生成、解释和诊断 SQL，支持 OpenAI、Anthropic、DeepSeek、Ollama 等多种 AI Provider。"
date: 2026-10-10
slug: ai-nl2sql
keywords:
  - AI SQL 生成
  - 自然语言查数据库
  - NL2SQL
  - AI 辅助
---

# AI 驱动的 SQL 编辑器：DataZen NL2SQL 功能详解

每个团队里都有那么几个人——他们清楚自己想从数据库里查什么，但面对 `SELECT ... FROM ... WHERE ...` 就犯怵。运营想知道上周新增了多少用户，产品经理想看某个功能的使用频率，老板想看本月的销售趋势。这些问题的答案都在数据库里，但 SQL 这道门槛，把大多数人挡在了门外。

DataZen 的 AI Chat 面板，正是为此而生。

## 自然语言，直接问

打开 DataZen，连接好你的数据库，在右侧找到 AI Chat 面板。你不需要记任何语法，直接用日常语言描述你的需求就行：

![AI Chat 面板](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/09-ai-chat.png)

比如输入：

> 查询过去 7 天每天新增的用户数量，按日期倒序排列

AI 会立刻理解你的意图，结合当前连接数据库的表结构，生成对应的 SQL：

```sql
SELECT DATE(created_at) AS day, COUNT(*) AS new_users
FROM users
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY day DESC;
```

生成的 SQL 会直接显示在编辑器中，你可以一键执行，也可以根据需要微调。从"我想查什么"到"看到结果"，整个过程可能只需要 10 秒钟。

![AI 生成的 SQL](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/09-ai-sql-generated.png)

## 上下文感知：AI 懂你的数据库

这不只是一个简单的文本转 SQL 工具。DataZen 的 AI Chat 拥有完整的上下文感知能力——它知道你当前连接的是什么数据库（PostgreSQL 还是 MySQL？），知道你有哪些表、每个表有哪些字段、字段是什么类型、哪些是主键和外键。

这意味着：

- 你不需要告诉 AI 表名叫什么，它自己会去 Schema 里找。
- 你不需要担心语法差异，AI 会根据数据库类型生成正确的方言。
- 你提到的业务术语（"用户表"、"订单"），AI 会尝试在你的 Schema 中匹配对应的表。

举个例子，你可以说"帮我统计每个客户的订单总金额"，AI 会自动找到 `customers` 表和 `orders` 表，识别出它们的关联字段，生成正确的 JOIN 查询。这种能力来自于 DataZen 对数据库 Schema 的深度集成，而非通用大模型的泛化能力。

## 多种 AI Provider，按需选择

DataZen 支持多种 AI Provider，你可以根据自己的偏好和需求选择：

| Provider | 特点 | 适用场景 |
|----------|------|----------|
| OpenAI (GPT-4o) | 综合能力强，SQL 生成准确率高 | 通用场景首选 |
| Anthropic (Claude) | 上下文理解优秀，擅长复杂查询 | 长 SQL、多表关联 |
| DeepSeek | 国内访问快，性价比高 | 国内用户推荐 |
| Ollama (本地模型) | 完全离线，数据不出本机 | 数据敏感场景 |

配置非常简单——在 DataZen 设置中填入 API Key，选择模型即可。如果你不想把数据发送到外部服务，用 Ollama 跑一个本地模型就能完全离线使用。

## SQL 解释：不只是生成，还能帮你理解

AI Chat 不仅能生成 SQL，还能帮你理解已有的 SQL。

选中一段 SQL，右键选择"让 AI 解释"，AI 会用通俗易懂的语言告诉你这段查询在做什么：

- 每一行的逻辑是什么？
- JOIN 是怎么关联的？
- WHERE 条件过滤了哪些数据？
- GROUP BY 和 HAVING 的区别在这里是什么？

这对于接手别人的项目、理解遗留代码中的复杂查询特别有用。再也不用对着一段嵌套三层子查询的 SQL 逐行拆解了。

## AI 诊断：找出 SQL 的性能瓶颈

当你发现一条 SQL 执行得很慢，却不知道问题出在哪里时，AI 诊断功能就派上用场了。

在 SQL 编辑器中，点击"AI 诊断"按钮，AI 会分析你的 SQL 执行计划（EXPLAIN 输出），然后给出具体的优化建议：

![AI 诊断面板](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/09-ai-diagnosis.png)

常见的诊断结果包括：

- **缺少索引**：AI 会指出 WHERE 或 JOIN 条件中缺少索引的字段，并建议创建索引。
- **全表扫描**：提醒你某张大表在没有 WHERE 条件的情况下被全量扫描。
- **N+1 查询**：检测到循环中重复执行的查询，建议用批量查询替代。
- **SELECT \***：建议明确指定字段名，避免拉取不必要的数据。

这些诊断并非纸上谈兵——AI 会结合你的实际 Schema 信息，给出可直接执行的优化 SQL。

## 从自然语言到执行结果：完整流程演示

让我们走一遍完整的流程：

1. **连接数据库**：打开 DataZen，选择已有的 PostgreSQL 连接。
2. **打开 AI Chat**：在右侧面板切换到 AI Chat。
3. **输入需求**：在输入框中打字——"找出过去一个月消费金额排名前 10 的客户，显示客户名称和总消费"。
4. **AI 生成 SQL**：AI 分析你的 Schema，识别出 `customers` 和 `orders` 表，生成包含 JOIN、GROUP BY、ORDER BY 和 LIMIT 的完整查询。
5. **一键执行**：点击执行按钮，结果以表格形式展示。
6. **导出或继续**：将结果导出为 CSV，或者继续用自然语言追问——"把结果按地区分组看看"。

整个过程不需要你记住一个 SQL 关键字，真正做到了"用人话查数据"。

## 安全保障：AI 生成 ≠ 盲目信任

DataZen 在 AI 生成 SQL 的流程中内置了安全网——**SQL Guard**。

无论 SQL 是你手写的还是 AI 生成的，在执行前都会经过 SQL Guard 的安全检查。如果 AI 生成了一条包含 `DELETE` 或 `DROP TABLE` 的语句，SQL Guard 会拦截并提示你确认。你可以在只读模式下工作，确保任何写操作都不会意外执行。

此外，AI 生成的 SQL 会在编辑器中完整展示，你有机会在执行前仔细审查。AI 是助手，不是决策者——最终执行什么，由你说了算。

## 写在最后

NL2SQL 不是一个噱头，而是一个真正能提升效率的实用功能。它降低了数据库查询的门槛，让非技术人员也能自助获取数据，也让开发者从重复编写样板 SQL 中解放出来。

无论你是想快速验证一个业务假设的数据分析师，还是想从遗留 SQL 中理清逻辑的开发者，DataZen 的 AI Chat 都能帮你更快地得到答案。

现在就试试吧——完全免费，无需注册。

---

**[立即下载 DataZen](https://flyxl.github.io/datazen/download.html)** · [GitHub 源码](https://github.com/flyxl/datazen)

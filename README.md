# Pi Shadow Mind

[中文](#中文) · [English](#english)

## 中文

Shadow Mind 是一个 Pi 扩展。它会在主 Agent 工作时，偶尔启动多个相互独立、用完即弃的临时 Agent Session，承担检查、审阅或并行任务。

每个 Shadow Mind 都是一个 Markdown 实体，可以单独配置职责、适用模型、激活概率、工具、运行模型、thinking level、超时时间和 debug 日志。

### 工作方式

每次主 Agent `turn_end` 时进行一次 heartbeat：heartbeat 默认以 `1/3` 的概率触发，符合条件的 Shadow Mind 再按照各自的激活概率独立抽选，默认最多同时运行两个。

Shadow Session 继承主 Agent 原封不动的 system prompt，但只接收净化后的文本轨迹：思考内容会被移除，工具调用后仅保留确定性的结果概述。Shadow 会先判断轨迹是否与自己的职责相关；无关时直接结束，不调用工具或 `report_to_main`。需要向主 Agent 提交发现时，通过 `report_to_main` 上报并立即结束本轮。

### 安装

```bash
pi install npm:pi-shadow-mind@0.1.10
```

开发模式：

```powershell
npm install
pi -e ./src/index.ts
```

### 全局文件

首次启动 Session 时，扩展会创建：

```text
~/.pi/agent/shadow-minds/
  config.json
  *.md
  logs/<shadow-id>/*.jsonl   # 仅在 debug: true 时生成
```

扩展不会默认创建 Shadow Mind。一个最小定义如下：

```markdown
---
id: project-grounding
name: Project grounding
activation_probability: 0.3
active_for_models: ["openai/gpt-5"]
tools: [read, grep]
---

检查主 Agent 是否编造了项目事实。必要时查看仓库，只报告有具体证据的偏差。
```

全局默认超时为 300 秒，单个 Shadow 可通过 `timeout_seconds` 覆盖。

使用 `/shadow` 显示或隐藏状态面板，`/shadow status` 查看摘要，`/shadow pause` 和 `/shadow resume` 暂停或恢复当前 Session。扩展也提供管理工具，用于查询、创建、更新、启用、禁用和删除 Shadow Mind，以及读取或修改全局配置。所有写操作都需要用户确认。

完整行为约定见 [DESIGN.md](./DESIGN.md)，Benchmark 方法与经验见 [BENCHMARK.md](./BENCHMARK.md)。

### 构建与分发

```powershell
npm run build
npm pack
```

生成的 `pi-shadow-mind-<version>.tgz` 包含编译后的 `dist/` 扩展。也可以解压 standalone ZIP 后安装目录：

```powershell
pi install ./pi-shadow-mind-0.1.10
```

## English

Shadow Mind is a Pi extension that occasionally starts multiple independent, disposable agent sessions beside the main agent. They can review the main agent, verify its work, or pursue parallel tasks.

Each Shadow Mind is a Markdown entity with its own responsibility, model filter, activation probability, tools, runtime model, thinking level, timeout, and optional debug log.

### How it works

The extension evaluates a heartbeat after every main-agent `turn_end`. By default, the heartbeat fires with probability `1/3`; eligible Shadow Minds then roll independently using their own activation probabilities, with at most two running concurrently.

Shadow sessions inherit the main agent's unchanged system prompt but receive only a sanitized plain-text trajectory. Assistant thinking is removed, while tool calls retain deterministic result summaries. A Shadow first decides whether the trajectory is relevant to its responsibility. If unrelated, it exits without calling tools or `report_to_main`. When the main agent should receive a concrete result, the Shadow calls `report_to_main`, which immediately ends that run.

### Installation

```bash
pi install npm:pi-shadow-mind@0.1.10
```

For development:

```powershell
npm install
pi -e ./src/index.ts
```

### Global files

On the first session start, the extension creates:

```text
~/.pi/agent/shadow-minds/
  config.json
  *.md
  logs/<shadow-id>/*.jsonl   # only when debug: true
```

No default Shadow Mind is created. A minimal definition is:

```markdown
---
id: project-grounding
name: Project grounding
activation_probability: 0.3
active_for_models: ["openai/gpt-5"]
tools: [read, grep]
---

Check whether the main agent is inventing project facts. Inspect the repository when needed and report only concrete discrepancies.
```

The global timeout defaults to 300 seconds. Individual Shadows may override it with `timeout_seconds`.

Use `/shadow` to toggle the compact status panel, `/shadow status` for a summary, and `/shadow pause` or `/shadow resume` for the current session. The extension also exposes tools to list, create, update, enable, disable, and delete Shadow Minds, plus read or update the global configuration. Every write requires user confirmation.

See [DESIGN.md](./DESIGN.md) for the complete behavioral contract and [BENCHMARK.md](./BENCHMARK.md) for benchmark methodology and lessons learned.

### Build and distribution

```powershell
npm run build
npm pack
```

The generated `pi-shadow-mind-<version>.tgz` contains the compiled `dist/` extension. You can also unpack the standalone ZIP and install the directory:

```powershell
pi install ./pi-shadow-mind-0.1.10
```

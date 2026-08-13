# Terminal-Bench 2.1 evaluation

Shadow Mind 的目标基准固定为 Terminal-Bench 2.1：

```text
terminal-bench/terminal-bench-2-1
```

核心问题只有一个：在模型、Pi 版本、任务、超时、资源和主 Agent 工具完全相同的条件下，启用 Shadow Mind 是否提高任务成功率，其额外成本是多少。

## Comparison

使用同一个自定义 Harbor Agent，只切换运行配置：

- `baseline`：Pi 以 `--no-extensions` 启动，不加载任何插件。
- `shadow`：只安装并加载固定版本的 Shadow Mind 包和同一组 Shadow 定义。

两组都从 Main Agent 工具列表中排除 Shadow 实体管理工具，避免无关工具定义进入模型上下文。Shadow 默认保持只读；首轮实验不允许 Shadow 并行修改文件。

Shadow 与 Main 使用同一个模型；Main 使用 `high`，短任务型 Shadow 使用 `off`，避免审查线程把预算消耗在冗长思考上。若以后测试异构模型，必须作为单独的 multi-model 配置报告，不能与单模型结果混合。

## Required runtime work

正式运行前必须完成：

1. 为 Pi headless 模式增加 bounded drain：Main settled 后等待已启动的 Shadow 和报告批次完成，再退出；达到硬期限后取消。
2. 增加可记录的随机 seed，使同一 trial 可复现，同时保留未指定 seed 时的生产随机行为。
3. 实现 Harbor `BaseInstalledAgent` adapter，通过 `--agent-import-path` 加载，不修改 Harbor 本体。
4. Adapter 在沙箱中安装固定版本的 Pi 和 Shadow Mind 包，注入独立的 `PI_CODING_AGENT_DIR`、配置、Shadow MD 和模型凭据。
5. 以 Pi JSON/headless 模式执行任务，并输出 Harbor 可读取的轨迹。Shadow 运行至少要在 trial artifacts 中记录激活、模型调用、报告、超时、取消和耗时。
6. 固定所有版本与配置，并保存任务 ID、seed、模型、thinking level、Pi 版本、插件版本和 Harbor 版本。

不得修改 Terminal-Bench 的任务 timeout、CPU、内存或其他资源限制。

## Run stages

### 1. Adapter smoke test

选择 1 个快速任务，分别运行 baseline 和 shadow。只验证安装、工具执行、headless drain、结果收集及 verifier 全链路。

### 2. Pilot

固定抽取 10 个任务，每组每题运行 1 次。该阶段用于发现崩溃、模型鉴权、网络、超时、Shadow 无法反馈和轨迹缺失等基础问题，不据此宣称效果。

### 3. Paired comparison

在固定的代表性任务子集上，每组使用相同 trial seeds，至少运行 3 次。确认成功率方向、方差和成本在可接受范围后，再决定是否扩大。

### 4. Full benchmark

89 个任务，每组每题至少 5 次，遵循 Terminal-Bench 2.1 的正式运行口径。官方社区提交重新开放前，结果作为公开可复现的本地 A/B 报告保存。

## Metrics

主要指标：

- task success rate，以及 baseline 与 shadow 的配对差值；
- 95% bootstrap confidence interval。

次要指标：

- 总费用、输入/输出 token、LLM 调用数和墙钟时间；
- 每个 Main turn 的 Shadow 激活率；
- report、silent、timeout、abort、error 数量；
- 每个成功任务的平均成本；
- baseline 失败而 shadow 成功，以及 baseline 成功而 shadow 失败的任务清单。

所有失败都要区分 verifier failure 与 infrastructure failure；模型 API、安装、网络、容器或 adapter 故障不能直接计作能力失败。

在当前 WSL + Windows 代理环境中，Agent 与 verifier 都要显式传入代理；同时必须设置 `NO_PROXY=localhost,127.0.0.1`（含小写形式），否则 Selenium 会把本机 chromedriver 请求发到代理并得到 502。缺少代理导致 verifier 无法安装 `uv`，或缺少 `NO_PROXY` 导致 WebDriver 失败的 trial，均属于 infrastructure failure。

`break-filter-js-from-html` 可用于安装、日志、报告回注与 headless drain 冒烟，但 DeepSeek V4 Flash 在该任务上多次接近或命中 Agent timeout，不适合作为唯一的快速 A/B 样例。pilot 应加入耗时更短且稳定的任务。

## Reproducibility

每次实验保存：

```text
benchmark-results/<run-id>/
  manifest.json
  harbor-job/
  shadow-config.json
  shadow-minds/
  summary.json
  summary.md
```

`manifest.json` 必须包含精确版本、命令、环境、任务列表和 seeds。任何 Shadow prompt 或概率变化都视为新的实验配置。

# 多引擎写作：引擎模型配置能力（Pending）

> 本文记录当前「写作引擎模型可配置」相关的现状、问题与待办，作为未来扩展的追溯依据。当前功能暂不实现，仅归档设计点与坑位。

---

## 1. 当前行为快照（2026-03-17）

### 1.1 引擎抽象层

- 统一引擎入口：`scripts/llm_engine.sh`
- 决策写作引擎的优先级：
  1. 显式环境变量：`WRITING_ENGINE=claude|opencode`
  2. 配置文件：`scripts/settings.conf` 中的 `WRITING_ENGINE_DEFAULT=claude|opencode`
  3. 硬编码回退：`opencode`
- 引擎分支：
  - `WRITING_ENGINE=claude` → `run_claude`
  - `WRITING_ENGINE=opencode` → `run_opencode`

### 1.2 Claude 引擎模型配置

- `run_claude` 内部逻辑（摘要）：

```bash
env -u CLAUDECODE ANTHROPIC_BASE_URL="https://api.anthropic.com" \
  claude -p --dangerously-skip-permissions < "$INPUT_FILE" > "$OUTPUT_FILE"
```

- 模型选择完全由 Claude Code 自己的配置系统（例如 `.claude/settings.local.json`、CLI 选项等）管理，本项目不再在脚本层写死模型名。

### 1.3 OpenCode 引擎模型配置（当前硬编码）

- `run_opencode` 使用 Python + `pty.spawn` 调用 `opencode run`，目的是规避 `opencode serve` HTTP 模式在 `/session/:id/message` 上出现的 hanging / 空 body 已知 bug。
- 当前实现中，**模型为硬编码**：

```python
cmd = [
    "opencode",
    "run",
    "-m",
    "minimax-cn-coding-plan/MiniMax-M2.5",
    "--format",
    "json",
    prompt,
]
```

- 也就是说，在仓库维度：
  - OpenCode 写作路径始终使用 `minimax-cn-coding-plan/MiniMax-M2.5`
  - 无法通过配置文件 / 环境变量切换到其他 OpenCode 模型（例如 `MiniMax-M2.5-highspeed`）
  - 若要切换，只能直接改 `llm_engine.sh` 里的这行代码。

---

## 2. 目前搁置的需求与难点

### 2.1 搁置的需求（未来要做的能力）

1. **在项目层面配置 OpenCode 模型**
   - 与 `WRITING_ENGINE_DEFAULT` 类似，引入例如：
     - `WRITING_OPENCODE_MODEL_DEFAULT=minimax-cn-coding-plan/MiniMax-M2.5`
   - 存放位置优先考虑：
     - `scripts/settings.conf` 中新增键
   - 行为：
     - 默认仍是 `MiniMax-M2.5`，但可通过修改配置切换到 `MiniMax-M2.5-highspeed` 等模型。

2. **支持单次覆盖 OpenCode 模型**
   - 类似 `WRITING_ENGINE` 的单次覆盖逻辑，引入：
     - `WRITING_OPENCODE_MODEL=...`
   - 优先级设想：
     1. 显式 `WRITING_OPENCODE_MODEL`
     2. `WRITING_OPENCODE_MODEL_DEFAULT`（settings.conf）
     3. 硬编码默认 `minimax-cn-coding-plan/MiniMax-M2.5`

3. **GUI / agent-service 侧切换模型**
   - 在 GUI 的设置面板中，允许为 OpenCode 写作引擎选择不同模型（在一个下拉框里列出常用模型）。
   - agent-service 暴露 HTTP 接口去读写上述配置文件字段。

### 2.2 当前没有立即实现的原因

1. **优先级与复杂度权衡**
   - 当前主要目标是「多引擎写作」本身能跑通，且 OpenCode 模型链路稳定。
   - 在这个目标下，固定使用一个性能/体验较好的模型（`MiniMax-M2.5`）即可满足需求。

2. **OpenCode 生态本身仍在快速迭代**
   - OpenCode 的 provider / model 列表来源于 models.dev，升级频率较快。
   - 过早在项目内引入“模型名枚举/校验”等逻辑，可能会引入额外维护负担。

3. **`opencode run` 的行为差异**
   - 当前 `run_opencode` 使用 `opencode run --format json` + PTY 包装。
   - 配置模型时，需要同步考虑：
     - 非 PTY 环境（CI / agent-service）是否完全稳定
     - 不同模型在 tokens、latency 上的变化对流水线整体的影响

---

## 3. 未来实现建议（草案）

> 以下内容只是为未来实现预留设计思路，**本次不执行**。

### 3.1 配置接口设计草案

在 `scripts/settings.conf` 中扩展：

```bash
WRITING_ENGINE_DEFAULT=opencode
WRITING_OPENCODE_MODEL_DEFAULT=minimax-cn-coding-plan/MiniMax-M2.5
```

在 `llm_engine.sh` 中：

```bash
OPENCODE_MODEL_RAW="${WRITING_OPENCODE_MODEL:-${WRITING_OPENCODE_MODEL_DEFAULT:-minimax-cn-coding-plan/MiniMax-M2.5}}"
# 可选：做一层简单白名单校验，否则直接回退为硬编码默认
```

再将 `cmd` 中硬编码的 `"minimax-cn-coding-plan/MiniMax-M2.5"` 替换为上述变量。

### 3.2 GUI / agent-service 集成草案

1. **agent-service HTTP 接口：**
   - `GET /api/settings/writing-engine`
     - 返回：
       ```json
       {
         "engineDefault": "opencode",
         "opencodeModelDefault": "minimax-cn-coding-plan/MiniMax-M2.5"
       }
       ```
   - `PATCH /api/settings/writing-engine`
     - Body：
       ```json
       {
         "engineDefault": "claude" | "opencode",
         "opencodeModelDefault": "minimax-cn-coding-plan/MiniMax-M2.5" | "minimax-cn-coding-plan/MiniMax-M2.5-highspeed" | ...
       }
       ```
     - 实现上只写 `scripts/settings.conf` 对应键值。

2. **GUI 设置面板：**
   - Engine：`Claude` / `OpenCode`
   - OpenCode Model（仅当 Engine=OpenCode 时可选）：
     - 从 agent-service 获取一个可选模型列表（或写死几个常用选项）。

---

## 4. 待办列表（不在当前迭代执行）

1. 为 OpenCode 写作引擎引入可配置模型（`WRITING_OPENCODE_MODEL_DEFAULT` + `WRITING_OPENCODE_MODEL`）。
2. 在 CLI / GUI 层暴露一个简单的「默认模型选择」界面或命令。
3. 根据实际使用情况，评估是否需要按任务类型选择不同模型（例如 article 用标准版、summary 用 highspeed）。

---

## 5. 结论

- 当前版本中，**引擎可切换**（Claude / OpenCode），但 **模型不可配置**：
  - Claude 模型由 Claude Code 自身配置管理。
  - OpenCode 模型固定为 `minimax-cn-coding-plan/MiniMax-M2.5`。
- 本文记录了这一限制与未来的扩展方向，为后续需求迭代提供追溯依据。今后若有模型多样化需求，可基于此文档实现「OpenCode 模型配置能力」而无需重新调研现状。


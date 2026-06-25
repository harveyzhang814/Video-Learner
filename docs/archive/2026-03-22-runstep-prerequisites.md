# runStep 层必需物检查规范（Agent 分步调用）

## 目的与范围

- **目标**：当 GUI / Agent Service **独立调用** `runStep(taskId, stepName)` 时，在 **编排层（`core/orchestrator` 的 `runStep`）** 统一做「能否执行该步」的判定，避免无意义地 spawn 脚本、并给出稳定、可解析的错误信息。
- **原则**：**主检查在 `runStep`**；各 `scripts/*.sh` 仍保留参数与非空校验等**最小自检**（见 CLAUDE.md 与现有脚本约定）。
- **本文档**：描述**建议实现的检查清单**；与当前代码可能尚未完全一致，实现时以本文为准对齐行为。

路径约定：`work/<id>/` 为任务目录，`<id>` 为任务 ID（`sha1(url)` 前 12 位）。

### 两层分工（重要）

| 层次 | 职责 | 典型依据 |
|------|------|----------|
| **A. 必需物检查（本文档 / `runStep` 内）** | 只回答：**要跑这一步，输入是否齐、环境是否允许写**？ | URL、目录可写、磁盘上是否已有 `.vtt` / `original_*.md` / `article.md` 等**物或条件**。**不**读取 `steps.fetch` 等上游步骤是否 `completed`。 |
| **B. 编排 / DAG / 调度** | 回答：**现在该不该调这一步**？是否违反依赖顺序？ | SQLite `steps`、任务策略、并行规则等。例如「先 fetch 再 video」由 **B** 保证；**A** 只保证一旦调用 video，URL 与目录就绪。 |

二者可同时在产品里存在：**B** 未放行时不必调用 `runStep`；**A** 在 `runStep` 入口防止「缺件仍 spawn」。

**B 层专文**：[编排层 DAG / 调度](2026-03-22-orchestrator-dag-scheduler.md)（逻辑依赖、`mode`、失败传播、与现 `runTask` 关系）。

**状态权威（补充）**：任务进度、标题时长等仍以 **SQLite** 等为权威；**本文的必需物检查不替代 B 层**，也**不以**「`fetch` 是否完成」作为 video/subs 的硬条件。

**关于 `meta.json`**：当前主路径往往不落盘；必需物检查**不要**把它当作 video/subs 的前提。若某步真需要文件级元数据，应写清具体路径或改由 DB 字段表达，并归入 **A**（物/字段存在）或 **B**（策略）。

---

## 全局（任意步骤前）


| 检查项        | 说明                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------- |
| 任务存在       | `taskId` 在 SQLite 中有对应任务，且 `ensureTask` 能还原 `params`（含 `rootDir`、`url`、`mode`、`force` 等）。 |
| `rootDir`  | 已解析且为有效工程根（目录存在或可写）。                                                                      |
| `url`      | 非空字符串（创建任务时已校验；恢复任务时若缺失应拒绝执行依赖 URL 的步骤）。                                                  |
| `stepName` | 属于白名单：`fetch`，`video`，`audio`，`subs`，`vtt2md`，`md2vtt`，`article`，`summary`。 |


---

## 按步骤：检查矩阵


| 步骤          | mode / 跳过                                | 执行前必需（硬条件）                                              | 说明                                                                                    |
| ----------- | ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **fetch**   | 无                                        | `url`、`rootDir` 有效；可写 `work/<id>/`。                     | 通常不要求目录已存在；由本步创建 `transcript/`、`media/`、`writing/` 等。若任务目录已存在且**禁止覆盖**（策略项，可选），可另定规则。 |
| **video**   | `mode === 'audio'` → **skipped**，不 spawn | **`url` 非空**；**`work/<id>/` 可写**：目录已存在则可写，不存在则 **`work/` 可写** 以便创建 `<id>`（脚本会 `mkdir -p`）。 | **不**检查 `fetch` 或其它步骤的 SQLite 状态；**不**要求 `meta.json`。`video.mp4` 是否存在由脚本结合 `force` 处理。 |
| **audio**   | `mode === 'video'` → **skipped**         | 同 **video**：`url` + 任务目录可写（或可创建）。                       | 同上。                                                                                   |
| **subs**    | 无                                        | 同 **video**：`url` + 任务目录可写（或可创建）；脚本会创建 `transcript/subs/`。 | 不在本层判断 `subs` 之前是否必须先 `fetch`；由 **B 层** 管顺序。                                                              |
| **vtt2md**  | 无                                        | `work/<id>/transcript/subs/` 存在，且其中**至少一个** `*.vtt` 文件。 | 无 VTT 时应 **failed** 并明确错误（避免静默「零文件成功」）。若未来支持「无字幕仅 ASR」路径，可单独增加步骤与条件。                  |
| **md2vtt**  | 无                                        | `transcript/` 下至少一份 **`original_*.md`**（任意语言后缀，不限于 `en`/`zh`）。 | 规范语义；**当前实现**仅对 `original_en.md`、`original_zh.md` 调用脚本，若仅有其它后缀需后续改 `runStep` 与下游约定。 |
| **article** | 无                                        | 至少一份 **`original_*.md`**（与写作链路的「主逐字稿」选择规则一致）。                | 现 `runStep` 为优先 `original_en.md`，否则 `original_zh.md`；其它后缀需产品/实现扩展。                                      |
| **summary** | 无                                        | `work/<id>/writing/article.md` 存在。                      | 已实现；`focus` 缺省可用任务内 focus 或产品默认文案，不作为硬阻塞。                                             |


---

## 按步骤：细化说明

### fetch

- **输入**：`url`、`work/<id>/`（目标路径）。
- **检查**：全局项；`url` + `rootDir`；目标任务目录可创建/可写。
- **可选（策略）**：重复 fetch、与 `force` 的关系由 **B 层** 或产品规则决定；`transcript_done` 等与 **DB + 文件扫** 对齐，不属于本文「单步必需物」核心表。

### video / audio

- **硬依赖（仅 A 层）**：任务 **`url` 已具备**（非空）；**`work/<id>/` 可写或可创建**（父目录 `work/` 可写）。
- **不检查**：任何上游步骤的 `steps.*.status`；`transcript/meta.json`；`yt-dlp`/网络；已有 `video.mp4`/`audio.m4a`（脚本内 skip / `force`）。
- **mode**：与现逻辑一致，不符合 mode 时标记 `skipped`，不视为失败。

### subs

- **硬依赖（仅 A 层）**：同 video/audio：**`url` + 任务目录可写或可创建**。
- **不检查**：`fetch` 是否已跑；是否一定能下到字幕（运行时失败由脚本与 exit code 表达）。若无任何 `.vtt` 产出，**vtt2md** 仍仅按「有无 `.vtt` 文件」在 **A 层** 失败。

### vtt2md

- **硬依赖**：`transcript/subs/` 路径可用（目录存在**或**其父链可写以便创建），且其中**至少一个** `*.vtt`。
- **不检查**：`subs` 步骤在 DB 中是否 `completed`；允许手工放入 VTT 后直跑本步，只要文件满足上表。
- **输出命名（与现编排一致）**：对每个 `subs/*.vtt`，`runStep` 用文件名中**第一段「夹在两个点之间」的语言 token**（正则 `\.([^.]+)\.` 的首次匹配）作为 `lang`，写出 `transcript/original_${lang}.md`；匹配失败时默认 `lang=en`。例如 `.{id}.en.original.vtt` → `original_en.md`；`.{id}.zh.original.vtt` → `original_zh.md`。

### md2vtt

- **硬依赖（规范）**：至少一份 **`transcript/original_*.md`**，不限于 `en` / `zh`。
- **不检查**：`vtt2md` 步骤的 DB 状态；仅检查磁盘上是否存在符合条件的 md。
- **与 B 层 DAG**：`md2vtt` 在 **`vtt2md` 之后**与 **`article` 无先后依赖**，可并行；**A 层**只认本步所需文件，不推断 article 是否已跑。
- **仅繁体中文字幕时落盘叫什么**：`download_subs.sh` 里无论轨是 `zh-Hans`、`zh`、`zh-TW` 还是 `zh-Hant`，写入磁盘的 VTT 基名都使用 **`target_lang=zh`**，即 **`work/<id>/transcript/subs/<id>.zh.original.vtt`**（或 `.zh.auto.vtt`）。经上述 vtt2md 规则后，逐字稿文件为 **`original_zh.md`**（繁体内容也在该文件内，文件名仍是 `_zh` 而非 `_zh-Hant`）。
- **实现差距**：当前 `core/orchestrator` 的 `md2vtt` 分支**只**对 `original_en.md`、`original_zh.md` 调 `convert_md_vtt.sh`；若将来存在仅 `original_ja.md` 等，需在实现中扩展 glob/遍历，与本文「任意 `original_*.md`」对齐。

### article

- **硬依赖**：至少一份符合产品规则的逐字稿 **`original_*.md`**（实现上可先维持 en/zh 优先）。
- **不检查**：`md2vtt` / `vtt2md` 的 DB 状态。
- **输出目录**：`writing/` 不存在时可由 `runStep` 或脚本 `mkdir -p`，不作为失败条件（父目录可写即可）。

### summary

- **硬依赖**：`writing/article.md` 存在。
- **不检查**：`article` 步骤在 DB 中是否 `completed`。
- **focus**：允许缺省，从任务 `focus` 或默认字符串填充（与现 `runStep` 行为一致）。

---

## 失败语义（建议）


| 类别         | 行为                                                                             |
| ---------- | ------------------------------------------------------------------------------ |
| 硬前置不满足     | 不 spawn 脚本；`step` 标记 `failed`（或未来引入 `blocked`）；`error` 为简短英文或中英键值，便于 Agent 解析。 |
| mode 导致不适用 | `skipped`，`success: true, skipped: true`（与现行为对齐）。                              |
| 脚本执行失败     | 保持现有 exit code + `formatStepError` 逻辑。                                         |


---

## 与「逻辑 DAG」的衔接（备忘）

- **本文矩阵描述的是 A 层（必需物）**，不是 DAG 边。DAG 上例如「`video` 应在 `fetch` 之后」完全由 **B 层**实现（读 `steps`、拓扑排序、策略）。
- **A 与 B 的配合**：B 决定调用顺序；`runStep` 入口的 A 避免在缺 URL、目录不可写、缺 `.vtt`/缺 `article.md` 时仍 spawn。
- **视频失败、字幕继续** 等：用 B 把媒体链与 subs 链**解耦**即可；A 层 **subs** 仍只要求 `url` + 可写目录，**vtt2md** 只要求有 `.vtt` 文件，**不**要求 `video` 成功。
- **`md2vtt` 与 `article`**：B 层 DAG 上**无依赖**，可在 **`vtt2md` 完成后并行**；详见 B 层专文。

---

## 维护

- 修改步骤拆分或目录约定时，同步更新本文件与 `docs/PROJECT_KNOWLEDGE.md` 相关小节。
- **DAG / 调度（B 层）**：[2026-03-22-orchestrator-dag-scheduler.md](./2026-03-22-orchestrator-dag-scheduler.md)
- **已实现（A 层代码）**：`core/orchestrator/stepArtifacts.js`（`validateStepArtifacts` 等）+ `runStep` 在 mode 跳过之后、`running` 之前调用；不满足时不发 `step.started`、步骤记 `failed`。落地说明见 [implementation plan](./2026-03-22-runstep-prerequisites-implementation.md)。


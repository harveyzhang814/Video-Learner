# 如何使用 `vdl` CLI

## 安装

```bash
cd /path/to/Video-Learner
npm link          # 全局注册 vdl
```

## 基本用法

```bash
# 处理一个 YouTube 视频（会交互询问关注点）
vdl https://www.youtube.com/watch?v=XXXX

# 指定关注点和模式
vdl https://www.youtube.com/watch?v=XXXX --focus "技术架构" --mode transcript

# 输出 JSON（供脚本使用）
vdl https://www.youtube.com/watch?v=XXXX --focus "核心论点" --json
```

## 子命令

```bash
vdl status <task_id>                          # 查看任务状态
vdl result <task_id> --type summary           # 打印摘要到 stdout
vdl result <task_id> --type article           # 打印文章到 stdout
vdl rerun  <task_id> <step>                   # 从某步骤重跑（默认级联下游）
vdl rerun  <task_id> <step> --reset step      # 仅重跑该步骤
vdl list                                       # 列出最近任务
```

## 与 GUI / HTTP Service 并发使用

- **若 Electron 已在运行**：CLI 自动复用 Electron 启动的 HTTP 服务（读 `/tmp/vl-agent-token`），两者共享同一 SQLite 数据库。
- **若无服务在运行**：CLI 自动在后台启动 HTTP 服务，退出时自动关闭。

## 卸载

```bash
npm unlink vdl
```

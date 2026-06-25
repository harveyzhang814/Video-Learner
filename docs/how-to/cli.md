# 如何使用 `vdl` CLI

## 安装

### 正式安装（推荐）

从仓库打包后全局安装，安装完成后**可删除仓库**，`vdl` 独立运行：

```bash
cd /path/to/Video-Learner
npm pack                               # 生成 video-learner-x.x.x.tgz
npm install -g ./video-learner-*.tgz   # 真实拷贝，删仓库后 vdl 仍可运行
rm video-learner-*.tgz                 # 清理临时包文件
```

首次运行任意 `vdl` 命令时，会自动创建 `~/.config/vdl/settings.conf` 并询问数据目录（默认 `~/vdl-work`）。

### 开发安装

仓库目录下直接运行，无需全局安装，改代码立即生效：

```bash
node cli/index.js <url>          # 直接调用入口
node cli/index.js config get
```

若希望在开发期间也能用 `vdl` 命令，可用 symlink 安装（**仅开发用**，依赖仓库存在）：

```bash
npm link          # 注册 symlink
npm unlink vdl    # 开发结束后取消
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
vdl gui                                        # 后台启动 Electron GUI，终端立刻返回
```

## 与 GUI / HTTP Service 并发使用

CLI、Electron GUI 和 `npm run agent:serve` 三种方式共用 **同一个后端实例**（固定端口 3000）。

- **若服务已在运行**（任意方式启动）：CLI 自动连接，读取 `/tmp/vl-agent-token`，注册心跳，共享同一 SQLite 数据库。
- **若无服务在运行**：CLI 自动在后台启动 HTTP 服务（`AUTO_SHUTDOWN=1`）；CLI 退出时注销心跳，服务在无客户端 30s 后自动退出。
- **`npm run agent:serve`**：服务永久运行，不会因 CLI 退出而关闭。

## 卸载

```bash
npm uninstall -g video-learner
```

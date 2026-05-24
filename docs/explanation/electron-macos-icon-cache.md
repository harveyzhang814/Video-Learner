# macOS Dock 图标为什么在 Electron 开发模式下不生效

## 背景

在开发模式下启动 Electron（`npm start` / `electron .`），Dock 里显示的始终是通用 Electron logo，即使代码里调用了 `app.dock.setIcon()` 或 `BrowserWindow` 设置了 `icon` 选项。

## 根本原因：图标来源有三层，优先级不同

macOS 显示应用图标时按以下顺序取值，找到就停止：

```
1. .app bundle 内的 .icns（CFBundleIconFile → Contents/Resources/*.icns）
2. app.dock.setIcon() 运行时覆盖
3. 系统 Icon Services 缓存（最近一次读取的结果）
```

开发模式下，实际运行的进程是：

```
electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
```

这是从 npm 安装的**通用 Electron 二进制**，它的 `Contents/Resources/electron.icns` 就是官方 logo。

`BrowserWindow` 的 `icon` 选项在 macOS 上**不影响 Dock**，只影响 Windows/Linux 的任务栏。`app.dock.setIcon()` 虽然会临时覆盖，但有两个问题：

1. 系统 Icon Services 会从 bundle 读取并缓存图标，缓存优先于运行时设置。
2. 退出 app 后图标立刻恢复为 bundle 里的值。

## macOS Icon Services 缓存

macOS 在 `~/Library/Caches/com.apple.iconservices.store` 维护一个全局图标缓存。该缓存在以下情况下**不会自动失效**：

- 替换了 `.icns` 文件但没有通知系统
- 仅执行 `killall Dock`（Dock 重启后从缓存读，缓存未清除）

必须同时执行：

```bash
sudo rm -rf /Library/Caches/com.apple.iconservices.store   # 系统级缓存
rm -rf ~/Library/Caches/com.apple.iconservices.store        # 用户级缓存（如有）
killall Dock
killall SystemUIServer
```

才能让系统重新从磁盘读取图标。

## 为什么替换 electron.icns 是正确解法

直接替换 `node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns` 使得第一层优先级的图标变成自定义图标，`app.dock.setIcon()` 成为锦上添花（让图标在打包前保持一致）而不是主要依赖。

**局限：** `node_modules` 在 `npm install` 后会被还原。每次重装依赖需要重新替换，或通过 `postinstall` 脚本自动化。

打包后（`electron-builder`/`electron-forge`）不存在此问题，打包工具会自动将项目配置的 `.icns` 写入 bundle。

## 相关文档

- 操作步骤见 [how-to/electron-dev-icon.md](electron-dev-icon.md)（链接指向 how-to 目录）

# 在 Electron 开发模式下设置自定义 Dock 图标（macOS）

> **原理说明**见 [explanation/electron-macos-icon-cache.md](../explanation/electron-macos-icon-cache.md)

## 前提

- 准备好源图片：PNG，建议 **1024×1024 或 2048×2048**，RGBA 格式
- macOS（需要 `sips` 和 `iconutil`，系统自带）

---

## 第一步：生成 .icns 文件

```bash
SRC="path/to/your-icon.png"
mkdir -p electron/assets/icon.iconset

# 生成所有必需尺寸
for size in 16 32 64 128 256 512 1024; do
  case $size in
    16)   name="icon_16x16.png" ;;
    32)   name="icon_16x16@2x.png" ;;
    64)   name="icon_32x32@2x.png" ;;
    128)  name="icon_128x128.png" ;;
    256)  name="icon_128x128@2x.png" ;;
    512)  name="icon_256x256@2x.png" ;;
    1024) name="icon_512x512@2x.png" ;;
  esac
  sips -z $size $size "$SRC" --out "electron/assets/icon.iconset/$name" >/dev/null
done

sips -z 32  32  "$SRC" --out "electron/assets/icon.iconset/icon_32x32.png"  >/dev/null
sips -z 256 256 "$SRC" --out "electron/assets/icon.iconset/icon_256x256.png" >/dev/null
sips -z 512 512 "$SRC" --out "electron/assets/icon.iconset/icon_512x512.png" >/dev/null

iconutil -c icns electron/assets/icon.iconset -o electron/assets/icon.icns
rm -rf electron/assets/icon.iconset   # 中间产物，不需要提交
```

生成结果：`electron/assets/icon.icns`

---

## 第二步：替换 Electron.app bundle 内的图标

```bash
# 备份原始图标
cp electron/node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns \
   electron/node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns.bak

# 替换
cp electron/assets/icon.icns \
   electron/node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns
```

> ⚠️ `npm install` 会还原此文件。可在 `package.json` 加 `postinstall` 脚本自动执行复制。

---

## 第三步：清除 macOS 图标缓存

**仅 `killall Dock` 不够**，必须同时清缓存：

```bash
sudo rm -rf /Library/Caches/com.apple.iconservices.store
rm -rf ~/Library/Caches/com.apple.iconservices.store 2>/dev/null || true
killall Dock
killall SystemUIServer
```

---

## 第四步：更新 main.js（运行时设置，锦上添花）

```js
// electron/src/main.js
const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.icns');

// BrowserWindow（对 Windows/Linux 生效，macOS 无效但保留以备跨平台）
mainWindow = new BrowserWindow({
  icon: ICON_PATH,
  // ...
});

// macOS Dock 运行时图标
app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(ICON_PATH); } catch (_) {}
  }
  // ...
});
```

---

## 第五步：重启 Electron

```bash
bash start-electron.sh
```

Dock 图标应已更新为自定义图标。

---

## 故障排查

| 现象 | 原因 | 解法 |
|------|------|------|
| 重启 Dock 后图标还是旧的 | Icon Services 缓存未清除 | 执行第三步，必须加 `sudo rm` |
| `npm install` 后图标恢复 | node_modules 被覆盖 | 加 `postinstall` 脚本重新复制 |
| 打包后图标正常 | 打包工具自动写入 bundle | 无需处理，仅开发模式需要此流程 |

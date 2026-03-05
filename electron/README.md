# YouTube Pipeline - Electron Desktop App

## 快速开始

### 1. 安装依赖
```bash
cd electron
npm install
```

### 2. 运行应用
```bash
npm start
```

### 3. 打包为 macOS 应用
```bash
npm install -g electron-builder
electron-builder --mac
```

## 功能

- 输入 YouTube URL
- 设置 FOCUS (可选)
- 自动下载字幕、生成 article.md 和 summary.md
- 历史记录
- 查看生成的文档

## 项目结构

```
electron/
├── package.json
└── src/
    ├── main.js          # 主进程
    ├── preload.js      # 预加载脚本
    └── renderer/
        └── index.html   # 前端界面
```

## 注意事项

- 首次运行需要网络下载字幕
- FOCUS 用于指定总结重点（如"技术细节"、"主要论点"）
- 生成的文档保存在 work/<id>/ 目录下

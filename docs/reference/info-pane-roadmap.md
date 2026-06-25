# Info Pane — 待实现字段

GUI 信息面板（`#infoPane`）目前展示：标题、创作者、URL、时长、输出语言、关注点、处理进度、创建/更新时间。

以下字段**已从占位 UI 中移除**（见 git history `feature/gui-redesign`），等 DB 和 fetch 脚本支持后补充：

| 字段 | DB 列 | 数据来源 |
|------|--------|---------|
| 发布日期 | `upload_date` | yt-dlp `--print upload_date` |
| 播放量 | `view_count` | yt-dlp `--print view_count` |
| 点赞数 | `like_count` | yt-dlp `--print like_count` |
| 视频简介 | `description` | yt-dlp `--print description` |
| 封面缩略图 | `thumbnail` | yt-dlp `--print thumbnail` → 存路径或 URL |
| 分辨率/帧率 | `width`, `height`, `fps` | yt-dlp `--print width,height,fps` |

## 实现步骤

1. `scripts/fetch.sh` — 增加 `--print` 字段输出，写入 `meta.json`
2. `core/orchestrator/db.js` — migration 新增对应列
3. `services/http-server/index.js` — `GET /tasks/:id` response 含新字段
4. `electron/src/renderer/index.html` — 在 `#infoPane` 对应 section 中添加 `.info-pane-field` 并绑定 JS

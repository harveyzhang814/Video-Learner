const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// 引入数据库管理
const DatabaseManager = require('./db');

// 引入编排层
const Orchestrator = require('./orchestrator');

// 引入 WebSocket 服务器
const WebSocketServer = require('./websocket-server');

let orchestrator;
let wsServer;

let db;
const DB_PATH = path.join(__dirname, '../..', 'work', 'database.sqlite');

let mainWindow;
let currentProcess = null;
let currentProcessId = null;

// 初始化编排层（延迟到 createWindow 后获取 mainWindow）
function initOrchestrator() {
    const baseDir = path.join(__dirname, '../..');
    orchestrator = new Orchestrator(baseDir,
        (text) => {
            // 实时推送输出到前端
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('pipeline-output', text);
            }
            // Also broadcast to WebSocket clients
            if (wsServer) {
                wsServer.broadcast('task:output', { text });
            }
        },
        (task) => {
            // 推送 task-created 事件
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('task-created', task);
            }
            // Also broadcast to WebSocket clients
            if (wsServer) {
                wsServer.broadcast('task:created', task);
            }
        },
        (task) => {
            // 推送 task-updated 事件
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('task-updated', task);
            }
        },
        (type, payload) => {
            // 推送步骤事件到 WebSocket 客户端
            if (wsServer) {
                wsServer.broadcast(type, payload);
            }
        }
    );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 初始化编排层（在 mainWindow 创建之后）
  initOrchestrator();

  // 初始化数据库
  db = new DatabaseManager(DB_PATH);

  // 启动 WebSocket 服务器
  wsServer = new WebSocketServer(8765);
  wsServer.start();

  // 设置命令处理回调
  wsServer.onCommand = async (data) => {
      console.log('[WS] Received command:', data);
      switch (data.type) {
          case 'task:cancel':
              // Handle cancel - stop current pipeline
              if (currentProcess) {
                  currentProcess.kill('SIGTERM');
                  currentProcess = null;
              }
              break;
          case 'task:pause':
              // TODO: Handle pause - implement pause mechanism if needed
              break;
          case 'task:resume':
              // TODO: Handle resume - implement resume mechanism if needed
              break;
          case 'task:refresh':
              // Handle refresh - send current status
              if (orchestrator) {
                  const status = orchestrator.getStatus(data.payload.id);
                  wsServer.send('task:status', status);
              }
              break;
      }
  };
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Run pipeline script using orchestrator
/**
 * downloadVideo 参数说明:
 * - 'video': 下载视频
 * - 'audio': 下载音频
 * - 其他: 不下载媒体
 */
ipcMain.handle('run-pipeline', async (event, { url, focus, force, downloadVideo, id }) => {
  try {
    console.log('[DEBUG] run-pipeline called with:', { url, focus, force, downloadVideo, id });

    // 确定是否下载视频
    let shouldDownloadVideo = false;
    let shouldDownloadAudio = false;
    if (downloadVideo === 'video') {
      shouldDownloadVideo = true;
    } else if (downloadVideo === 'audio') {
      shouldDownloadAudio = true;
    }
    console.log('[DEBUG] resolved download options:', { shouldDownloadVideo, shouldDownloadAudio });

    // 使用编排层执行
    const result = await orchestrator.run(url, {
      downloadVideo: shouldDownloadVideo,
      downloadAudio: shouldDownloadAudio,
      focus,
      force: force || false,
      output_lang: 'zh-CN'
    });

    // 更新 meta.json 的 task_status 字段
    // 更新任务完成状态
    if (db) {
      db.updateStep(result.id, 'summary', 'completed');
      db.updateDownload(result.id, 'completed');
    }

    return { success: true, id: result.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 单步执行
ipcMain.handle('run-step', async (event, { id, step, options = {} }) => {
  try {
    const result = await orchestrator.runStep(id, step, options);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 重试步骤
ipcMain.handle('retry-step', async (event, { id, step }) => {
  try {
    const result = await orchestrator.retryStep(id, step);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 跳过步骤
ipcMain.handle('skip-step', async (event, { id, step }) => {
  try {
    const result = orchestrator.skipStep(id, step);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 获取任务状态
ipcMain.handle('get-task-status', async (event, id) => {
  try {
    const status = orchestrator.getStatus(id);
    return status;
  } catch (e) {
    return null;
  }
});

// Stop running pipeline
ipcMain.handle('stop-pipeline', async (event, id) => {
  const fs = require('fs').promises;

  // Kill the current process if running
  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
  }

  // Delete the work directory if id provided
  if (id) {
    const workDir = path.join(__dirname, '../..', 'work', id);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore deletion errors
    }
  }

  currentProcessId = null;
  return { success: true };
});

// Read generated files
ipcMain.handle('read-file', async (event, filePath) => {
  const fs = require('fs').promises;
  const fullPath = path.join(__dirname, '../..', filePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (e) {
    return null;
  }
});

// Write files
ipcMain.handle('write-file', async (event, { filePath, content }) => {
  const fs = require('fs').promises;
  const fullPath = path.join(__dirname, '../..', filePath);
  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    return true;
  } catch (e) {
    console.error('Write file error:', e);
    return false;
  }
});

// List work directories
ipcMain.handle('list-works', async () => {
  try {
    if (!db) return [];
    const tasks = db.listTasks();
    return tasks.map(t => ({
      id: t.id,
      title: t.title || 'Untitled',
      ts: t.ts,
      status: t.download_status === 'success' ? 'completed' :
              t.download_status === 'failed' ? 'failed' : 'running'
    }));
  } catch (e) {
    console.error('list-works error:', e);
    return [];
  }
});

// Open folder in Finder
ipcMain.handle('open-folder', async (event, folderPath) => {
  const { shell } = require('electron');
  const fullPath = path.join(__dirname, '../..', folderPath);
  shell.openPath(fullPath);
});

// Delete work directory
ipcMain.handle('delete-work', async (event, id) => {
  const fs = require('fs').promises;
  const workDir = path.join(__dirname, '../..', 'work', id);
  try {
    await fs.rm(workDir, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Get media file paths (video and audio)
ipcMain.handle('get-media-path', async (event, id) => {
  const fs = require('fs').promises;
  const mediaDir = path.join(__dirname, '../..', 'work', id, 'media');

  try {
    const files = await fs.readdir(mediaDir);
    const videoFile = files.find(f => f.startsWith('video.') && !f.endsWith('.log'));
    const audioFile = files.find(f => f.startsWith('audio.') && !f.endsWith('.log'));

    return {
      video: videoFile ? path.join(mediaDir, videoFile) : null,
      audio: audioFile ? path.join(mediaDir, audioFile) : null
    };
  } catch (e) {
    return { video: null, audio: null };
  }
});

// Get video file path (legacy)
ipcMain.handle('get-video-path', async (event, id) => {
  const fs = require('fs').promises;
  const mediaDir = path.join(__dirname, '../..', 'work', id, 'media');

  try {
    const files = await fs.readdir(mediaDir);
    const videoFile = files.find(f => f.startsWith('video.') && !f.endsWith('.log'));
    if (videoFile) {
      return path.join(mediaDir, videoFile);
    }
    return null;
  } catch (e) {
    return null;
  }
});

// Get subtitle file path
ipcMain.handle('get-subtitle-path', async (event, id) => {
  const fs = require('fs').promises;
  const subsDir = path.join(__dirname, '../..', 'work', id, 'transcript', 'subs');

  try {
    const files = await fs.readdir(subsDir);
    const vttFile = files.find(f => f.endsWith('.vtt'));
    if (vttFile) {
      return path.join(subsDir, vttFile);
    }
    return null;
  } catch (e) {
    return null;
  }
});

// Read and parse subtitle file (prefer cleaned original.vtt over raw subs/*.vtt)
ipcMain.handle('read-subtitle', async (event, id) => {
  const fs = require('fs').promises;
  const path = require('path');
  const { exec } = require('child_process');
  const transcriptDir = path.join(__dirname, '../..', 'work', id, 'transcript');
  const originalMdPath = path.join(transcriptDir, 'original.md');
  const originalVttPath = path.join(transcriptDir, 'original.vtt');
  const subsDir = path.join(transcriptDir, 'subs');

  try {
    // Check if original.vtt exists, if not generate from original.md
    try {
      await fs.access(originalVttPath);
    } catch {
      // original.vtt doesn't exist, generate from original.md
      if (originalMdPath) {
        try {
          await fs.access(originalMdPath);
          await new Promise((resolve, reject) => {
            exec(`python3 "${__dirname}/../../scripts/md2subtitle.py" "${originalMdPath}" -f vtt -o "${originalVttPath}"`, (err, stdout, stderr) => {
              if (err) {
                console.error('Failed to generate subtitle:', stderr);
                reject(err);
              } else {
                console.log('Generated subtitle:', stdout);
                resolve();
              }
            });
          });
        } catch (e) {
          console.error('original.md not found, fallback to subs');
        }
      }
    }

    // Try to read original.vtt first
    try {
      const content = await fs.readFile(originalVttPath, 'utf-8');
      return content;
    } catch {
      // Fallback to subs/*.vtt
      const files = await fs.readdir(subsDir);
      const vttFile = files.find(f => f.endsWith('.vtt'));
      if (!vttFile) return null;

      const content = await fs.readFile(path.join(subsDir, vttFile), 'utf-8');
      return content;
    }
  } catch (e) {
    console.error('Error reading subtitle:', e);
    return null;
  }
});

// Read bilingual subtitle (en or zh)
ipcMain.handle('read-subtitle-bilingual', async (event, { id, lang }) => {
  const fs = require('fs').promises;
  const path = require('path');
  const transcriptDir = path.join(__dirname, '../..', 'work', id, 'transcript');

  try {
    const vttPath = path.join(transcriptDir, `original_${lang}.vtt`);
    try {
      const content = await fs.readFile(vttPath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  } catch (e) {
    console.error('Error reading bilingual subtitle:', e);
    return null;
  }
});

// Get available subtitles
ipcMain.handle('get-available-subtitles', async (event, id) => {
  const fs = require('fs').promises;
  const path = require('path');
  const transcriptDir = path.join(__dirname, '../..', 'work', id, 'transcript');

  try {
    const metaPath = path.join(transcriptDir, 'meta.json');
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent);

      // Return transcripts info from meta
      if (meta.transcripts) {
        return {
          en: meta.transcripts.en || null,
          zh: meta.transcripts.zh || null,
          articleSource: meta.article_source_lang || null
        };
      }
    } catch {
      // meta.json doesn't exist
    }

    // Fallback: check if original_en.vtt or original_zh.vtt exist
    const enPath = path.join(transcriptDir, 'original_en.vtt');
    const zhPath = path.join(transcriptDir, 'original_zh.vtt');

    const result = { en: null, zh: null, articleSource: null };

    try {
      await fs.access(enPath);
      result.en = { type: 'unknown', done: true };
    } catch {}

    try {
      await fs.access(zhPath);
      result.zh = { type: 'unknown', done: true };
    } catch {}

    return result;
  } catch (e) {
    console.error('Error getting available subtitles:', e);
    return { en: null, zh: null, articleSource: null };
  }
});

// Reset task step
ipcMain.handle('reset-task-step', async (event, { id, step }) => {
  const fs = require('fs');
  const path = require('path');
  const metaPath = path.join(__dirname, '../..', 'work', id, 'transcript', 'meta.json');

  if (!fs.existsSync(metaPath)) {
    throw new Error('任务不存在');
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  // 根据步骤更新状态
  switch (step) {
    case 'video':
      meta.download_status = 'pending';
      meta.download_attempts = 0;
      break;
    case 'transcript':
      meta.transcript_done = false;
      break;
    case 'article':
      meta.article_done = false;
      break;
    case 'summary':
      meta.summary_done = false;
      break;
    default:
      throw new Error('未知步骤: ' + step);
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { success: true };
});

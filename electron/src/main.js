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
const baseDir = path.resolve(__dirname, '..', '..');
console.log('[DEBUG] baseDir:', baseDir);
const DB_PATH = path.join(baseDir, 'work', 'database.sqlite');

let mainWindow;
let currentProcess = null;
let currentProcessId = null;

// 初始化编排层（延迟到 createWindow 后获取 mainWindow）
function initOrchestrator() {
    let outputCounter = 0;
    orchestrator = new Orchestrator(baseDir,
        (text) => {
            outputCounter++;
            // Debug: log first few outputs to trace duplicates
            if (outputCounter <= 20 || text.includes('[STATUS]')) {
                console.log(`[DEBUG] output #${outputCounter}:`, text.substring(0, 100));
            }
            // Broadcast to WebSocket clients for log display
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
            console.log(`[WS] onStepEvent: ${type}`, payload);
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

  // 捕获渲染进程的 console 消息 (旧 API，有警告但兼容性好)
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelMap = { 0: 'debug', 1: 'info', 2: 'warn', 3: 'error' };
    const levelName = levelMap[level] || 'log';
    if (message) console.log(`[Renderer ${levelName}] ${message}`);
  });

  // 捕获渲染进程未处理的错误
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Renderer] Process gone:', details.reason);
  });

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
          case 'task:run':
              // Handle run - start pipeline
              const { url, focus, downloadVideo, force } = data.payload || {};
              if (!url) {
                  wsServer.send('task:error', { error: 'URL is required' });
                  return;
              }
              try {
                  const result = await orchestrator.run(url, {
                      downloadVideo: downloadVideo === 'video',
                      downloadAudio: downloadVideo === 'audio',
                      focus: focus || '',
                      force: force || false,
                      output_lang: 'zh-CN'
                  });
                  wsServer.send('task:complete', result);
              } catch (err) {
                  wsServer.send('task:error', { error: err.message });
              }
              break;
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

    // 立即生成 task ID 并返回，让前端可以立即更新 UI
    const taskId = orchestrator.generateId(url);
    console.log('[DEBUG] generated task ID:', taskId);

    // 在后台启动任务执行（不等待完成）
    orchestrator.run(url, {
      downloadVideo: shouldDownloadVideo,
      downloadAudio: shouldDownloadAudio,
      focus,
      force: force || false,
      output_lang: 'zh-CN'
    }).then(result => {
      // 任务完成后广播 task:complete 消息
      console.log('[DEBUG] background task completed:', result.id);
      if (wsServer) {
        wsServer.broadcast('task:complete', { id: result.id, success: true });
      }
      // 更新数据库中的任务完成状态
      if (db) {
        db.updateStep(result.id, 'summary', 'completed');
        db.updateDownload(result.id, 'completed');
      }
    }).catch(err => {
      console.error('[DEBUG] background task error:', err);
      if (wsServer) {
        wsServer.broadcast('task:error', { id: taskId, error: err.message });
      }
    });

    // 立即返回 ID 给前端
    return { success: true, id: taskId };
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

// Get task details from database
ipcMain.handle('get-task-details', async (event, id) => {
  try {
    if (!db) return null;
    const task = db.getTask(id);
    if (!task) return null;

    const steps = db.getSteps(id);
    const download = db.getDownload(id);

    // Convert steps array to object
    const stepStatus = {};
    steps.forEach(s => {
      stepStatus[s.step_name] = s.status;
    });

    return {
      id: task.id,
      url: task.url,
      title: task.title,
      lang: task.lang,
      duration: task.duration,
      output_lang: task.output_lang,
      focus: task.focus,
      download_status: download ? download.status : 'pending',
      download_attempts: download ? download.attempts : 0,
      download_error: download ? download.error : null,
      step_status: stepStatus,
      transcript_done: stepStatus.subs === 'completed',
      article_done: stepStatus.article === 'completed',
      summary_done: stepStatus.summary === 'completed'
    };
  } catch (e) {
    console.error('get-task-details error:', e);
    return null;
  }
});

// Update task details in database
ipcMain.handle('update-task-details', async (event, { id, data }) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    db.updateTask(id, data);
    return { success: true };
  } catch (e) {
    console.error('update-task-details error:', e);
    return { success: false, error: e.message };
  }
});

// Open folder in Finder
ipcMain.handle('open-folder', async (event, folderPath) => {
  const { shell } = require('electron');
  const fullPath = path.join(baseDir, folderPath);
  shell.openPath(fullPath);
});

// Delete work directory
ipcMain.handle('delete-work', async (event, id) => {
  const fs = require('fs').promises;
  const workDir = path.join(baseDir, 'work', id);
  try {
    await fs.rm(workDir, { recursive: true, force: true });
    // Also delete from database (in correct order for foreign keys)
    if (db) {
      db.db.prepare('DELETE FROM steps WHERE task_id = ?').run(id);
      db.db.prepare('DELETE FROM downloads WHERE task_id = ?').run(id);
      db.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    }
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
  try {
    // Get transcripts from database
    const transcripts = db ? db.getTranscripts(id) : {};

    // Check article source language from tasks table
    const task = db ? db.getTask(id) : null;

    // Return transcripts info from database
    return {
      en: transcripts.en || null,
      zh: transcripts.zh || null,
      articleSource: task ? task.article_source_lang || null : null
    };
  } catch (e) {
    console.error('get-available-subtitles error:', e);
    return { en: null, zh: null, articleSource: null };
  }
});

// Reset task step
ipcMain.handle('reset-task-step', async (event, { id, step }) => {
  // Check if task exists in database
  const task = db.getTask(id);
  if (!task) {
    throw new Error('任务不存在');
  }

  // 根据步骤更新状态
  switch (step) {
    case 'video':
      db.updateDownload(id, 'pending', null, null);
      break;
    case 'transcript':
      db.updateStep(id, 'subs', 'pending');
      break;
    case 'article':
      db.updateStep(id, 'article', 'pending');
      break;
    case 'summary':
      db.updateStep(id, 'summary', 'pending');
      break;
    default:
      throw new Error('未知步骤: ' + step);
  }

  return { success: true };
});

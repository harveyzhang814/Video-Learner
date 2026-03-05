const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;

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
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Run pipeline script
ipcMain.handle('run-pipeline', async (event, { url, focus, force, downloadVideo, id }) => {
  return new Promise((resolve, reject) => {
    const mode = downloadVideo ? 'both' : 'transcript';
    let args;

    if (id) {
      // Continue/resume existing task
      args = ['scripts/run.sh', `ID=${id}`, `MODE=${mode}`];
    } else {
      // New task
      args = ['scripts/run.sh', url, `MODE=${mode}`];
    }

    if (focus) args.push(`FOCUS=${focus}`);
    if (force) args.push('FORCE=1');

    const proc = spawn('bash', args, {
      cwd: path.join(__dirname, '../..'),
      shell: true
    });

    let output = '';
    let error = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      mainWindow.webContents.send('pipeline-output', text);
    });

    proc.stderr.on('data', (data) => {
      error += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        resolve({ success: false, error: error || output, code });
      }
    });
  });
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
  const fs = require('fs').promises;
  const workDir = path.join(__dirname, '../..', 'work');

  try {
    const entries = await fs.readdir(workDir, { withFileTypes: true });
    const dirs = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaPath = path.join(workDir, entry.name, 'transcript', 'meta.json');
        try {
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);
          dirs.push({
            id: entry.name,
            title: meta.title || 'Untitled',
            ts: meta.ts,
            done: meta.summary_done
          });
        } catch (e) {
          dirs.push({ id: entry.name, title: 'Unknown', done: false });
        }
      }
    }

    return dirs.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  } catch (e) {
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

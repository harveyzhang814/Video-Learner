# Electron → Web Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron renderer with a brand-new React/TypeScript Web frontend (Forest Calm, reading-first), served by the existing Koa HTTP backend on `127.0.0.1:3000`. Electron shell stays as a thin BrowserWindow pointing at the same URL during transition.

**Architecture:** Single Koa server hosts both `/api/*` (unchanged backend) and `/` (new SPA from `web/dist/`). Token injected into `index.html` via meta tag at serve time. Web app is vanilla SPA: react-router v7, TanStack Query for HTTP, Zustand for UI state, EventSource for SSE. No SSR, no PWA. CLI remains sole task creator.

**Tech Stack:** Vite 6 · React 19 · TypeScript strict · Tailwind v4 · TanStack Query v5 · Zustand · cmdk · react-markdown · media-chrome · Framer Motion (light usage).

**Spec:** `docs/superpowers/specs/2026-06-16-electron-to-web-migration-design.md`
**Mockups:** `docs/superpowers/specs/mockups-2026-06-16-electron-to-web/*.html`

**Deferred to future plans** (called out in §11):
- ZIP export endpoint + button
- `wavesurfer.js` audio waveform
- Full immersive mode UI
- Playwright E2E suite
- `/legacy` route (旧 Electron renderer fallback)
- Electron `electron/` directory deletion

**Test discipline:**
- Backend: existing project convention — `node tests/xxx.test.js` (no framework). New tests follow same pattern.
- Frontend: Vitest + Testing Library. Each pure component / hook gets a unit test before implementation.
- Commit after every passing-green step. Frequent commits.

---

## File Structure

### Backend additions
| File | Responsibility |
|---|---|
| `services/http-server/static-serve.js` | Read `web/dist/index.html`, inject `<meta name="vdl-token">`, return; static middleware for `/assets/*` |
| `services/http-server/reveal.js` | Spawn OS opener for task folder; loopback-only guard |
| `services/http-server/index.js` | Wire static-serve + reveal into Koa app |
| `tests/http-static-serve.test.js` | Token injection + asset serving |
| `tests/http-reveal.test.js` | Spawn invoked; non-loopback rejected |

### Frontend (new `web/` workspace)
| File | Responsibility |
|---|---|
| `web/package.json` | Vite + React + TS + Tailwind v4 + libs |
| `web/vite.config.ts` | Dev proxy `/api`, `/events`, `/healthz` → `:3000` |
| `web/tsconfig.json` | strict mode, paths |
| `web/index.html` | Root document; meta token placeholder |
| `web/src/main.tsx` | React bootstrap |
| `web/src/styles/globals.css` | Tailwind v4 + Forest Calm CSS variables |
| `web/src/lib/api.ts` | Typed fetch client (Bearer from meta tag) |
| `web/src/lib/sse.ts` | EventSource wrapper |
| `web/src/lib/time.ts` | Duration / timestamp formatting |
| `web/src/hooks/use-tasks.ts` | TanStack Query — list/get/cancel/resume/delete |
| `web/src/hooks/use-task-stream.ts` | SSE → invalidateQueries bridge |
| `web/src/hooks/use-hotkeys.ts` | ⌘K / F / ESC global hotkeys |
| `web/src/stores/ui-store.ts` | Theme, palette open, current filter |
| `web/src/stores/player-store.ts` | Video time, active subtitle index |
| `web/src/components/task-row.tsx` | Single list item |
| `web/src/components/filter-bar.tsx` | inline 全部/进行中/已完成/失败 |
| `web/src/components/subtitle-list.tsx` | Transcript with active highlight |
| `web/src/components/reader.tsx` | react-markdown + remark-gfm + rehype-shiki |
| `web/src/components/toc.tsx` | TOC + scroll-spy |
| `web/src/components/player.tsx` | media-chrome wrapper |
| `web/src/components/command-palette.tsx` | cmdk panel |
| `web/src/routes/_layout.tsx` | App shell (theme provider, hotkeys mount) |
| `web/src/routes/_index.tsx` | Home: task list |
| `web/src/routes/tasks.$id.tsx` | Task detail page |
| `web/src/test/setup.ts` | Vitest jsdom + cleanup |
| `web/vitest.config.ts` | Vitest config |

### Electron change (final task)
| File | Change |
|---|---|
| `electron/src/main.js` | `win.loadURL('http://127.0.0.1:3000')` instead of `loadFile` |

---

## Task 1: Backend — token-injecting static serve

**Files:**
- Create: `services/http-server/static-serve.js`
- Modify: `services/http-server/index.js` (insert before `/api` routes)
- Test: `tests/http-static-serve.test.js`

- [ ] **Step 1.1: Write the failing test**

Create `tests/http-static-serve.test.js`:
```javascript
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { createApp } = require('../services/http-server');

(async () => {
  // Set up a fake web/dist with index.html
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-web-'));
  const distDir = path.join(tmp, 'web', 'dist');
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'),
    '<!doctype html><html><head><title>VDL</title></head><body><div id="root"></div></body></html>');
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("ok");');

  const app = createApp({ rootDir: tmp, token: 'test-token-abc' });
  const server = http.createServer(app.callback()).listen(0);
  const port = server.address().port;

  // GET / returns HTML with injected token
  const homeRes = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(homeRes.status, 200);
  assert.match(homeRes.headers.get('content-type'), /text\/html/);
  const homeBody = await homeRes.text();
  assert.match(homeBody, /<meta name="vdl-token" content="test-token-abc">/);
  assert.match(homeBody, /<div id="root"><\/div>/);

  // Cache-Control: no-store on HTML
  assert.equal(homeRes.headers.get('cache-control'), 'no-store');

  // GET /assets/app.js returns asset
  const assetRes = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
  assert.equal(assetRes.status, 200);
  assert.match(await assetRes.text(), /console\.log/);

  // Missing dist returns 404, not crash
  fs.rmSync(distDir, { recursive: true, force: true });
  const missingRes = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(missingRes.status, 404);

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS http-static-serve');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
node tests/http-static-serve.test.js
```
Expected: FAIL (route `/` not yet defined).

- [ ] **Step 1.3: Create static-serve middleware**

Create `services/http-server/static-serve.js`:
```javascript
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8'
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/**
 * Create middleware that serves the Web SPA from <rootDir>/web/dist.
 * - GET /            → web/dist/index.html with <meta name="vdl-token"> injected
 * - GET /assets/*    → static files
 * Falls through (next()) for any other path so /api/* still matches downstream.
 */
function createStaticServe({ rootDir, token }) {
  const distDir = path.join(rootDir, 'web', 'dist');
  const assetsDir = path.join(distDir, 'assets');

  return async function staticServe(ctx, next) {
    const { method, path: urlPath } = ctx;
    if (method !== 'GET' && method !== 'HEAD') return next();

    // index
    if (urlPath === '/' || urlPath === '/index.html') {
      const indexPath = path.join(distDir, 'index.html');
      if (!fs.existsSync(indexPath)) {
        ctx.status = 404;
        ctx.body = 'web/dist/index.html not built';
        return;
      }
      const html = fs.readFileSync(indexPath, 'utf8');
      const meta = `<meta name="vdl-token" content="${escapeHtml(token)}">`;
      const injected = html.includes('</head>')
        ? html.replace('</head>', `  ${meta}\n</head>`)
        : html.replace(/<head[^>]*>/i, (m) => `${m}\n  ${meta}`);
      ctx.type = 'text/html; charset=utf-8';
      ctx.set('Cache-Control', 'no-store');
      ctx.body = injected;
      return;
    }

    // assets — only paths under /assets/ (and a small allowlist of root files)
    const isAsset = urlPath.startsWith('/assets/');
    if (!isAsset) return next();

    // Prevent path traversal
    const rel = urlPath.replace(/^\/assets\//, '');
    const filePath = path.join(assetsDir, rel);
    if (!filePath.startsWith(assetsDir + path.sep) && filePath !== assetsDir) {
      ctx.status = 403;
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return next();
    }
    const ext = path.extname(filePath).toLowerCase();
    ctx.type = MIME[ext] || 'application/octet-stream';
    ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
    ctx.body = fs.createReadStream(filePath);
  };
}

module.exports = { createStaticServe };
```

- [ ] **Step 1.4: Wire static-serve into Koa app**

Modify `services/http-server/index.js`. Add require near top:
```javascript
const { createStaticServe } = require('./static-serve');
```

Find the section where `app.use(bodyParser());` appears (around line 608) and **insert this BEFORE bodyParser** so static GETs short-circuit:
```javascript
  // SPA static serve (must come before /api routes to claim "/")
  app.use(createStaticServe({ rootDir: ROOT_DIR, token }));
```

- [ ] **Step 1.5: Run test to verify it passes**

```bash
node tests/http-static-serve.test.js
```
Expected: `PASS http-static-serve`.

- [ ] **Step 1.6: Add npm script and commit**

In root `package.json` add to scripts:
```json
"test:http-static-serve": "node tests/http-static-serve.test.js",
```

Then commit:
```bash
git add services/http-server/static-serve.js services/http-server/index.js tests/http-static-serve.test.js package.json
git commit -m "feat(http): serve web/dist SPA with injected token meta"
```

---

## Task 2: Backend — reveal endpoint

**Files:**
- Create: `services/http-server/reveal.js`
- Modify: `services/http-server/index.js`
- Test: `tests/http-reveal.test.js`

- [ ] **Step 2.1: Write the failing test**

Create `tests/http-reveal.test.js`:
```javascript
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { createApp } = require('../services/http-server');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-reveal-'));

  // Stub task dir
  const taskId = 'abc123abc123';
  fs.mkdirSync(path.join(tmp, 'work', taskId), { recursive: true });

  const calls = [];
  const fakeSpawn = (cmd, args) => { calls.push({ cmd, args }); return { unref(){}, on(){} }; };

  const app = createApp({ rootDir: tmp, token: 'tk', spawn: fakeSpawn, host: '127.0.0.1' });
  const server = http.createServer(app.callback()).listen(0);
  const port = server.address().port;
  const auth = { Authorization: 'Bearer tk' };

  // Happy path
  const okRes = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/reveal`,
    { method: 'POST', headers: auth });
  assert.equal(okRes.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args[0].endsWith(path.join('work', taskId)));

  // Missing task
  const missRes = await fetch(`http://127.0.0.1:${port}/api/tasks/nope/reveal`,
    { method: 'POST', headers: auth });
  assert.equal(missRes.status, 404);

  // Non-loopback bind → 403
  server.close();
  const appLan = createApp({ rootDir: tmp, token: 'tk', spawn: fakeSpawn, host: '0.0.0.0' });
  const lanServer = http.createServer(appLan.callback()).listen(0);
  const lanPort = lanServer.address().port;
  const lanRes = await fetch(`http://127.0.0.1:${lanPort}/api/tasks/${taskId}/reveal`,
    { method: 'POST', headers: auth });
  assert.equal(lanRes.status, 403);
  lanServer.close();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS http-reveal');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
node tests/http-reveal.test.js
```
Expected: FAIL (404 on unknown route or `host` option ignored).

- [ ] **Step 2.3: Implement reveal helper**

Create `services/http-server/reveal.js`:
```javascript
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn: realSpawn } = require('node:child_process');

function pickOpener() {
  switch (process.platform) {
    case 'darwin': return 'open';
    case 'win32': return 'explorer';
    default: return 'xdg-open';
  }
}

function registerRevealRoute(router, { rootDir, host, spawn = realSpawn }) {
  router.post('/tasks/:taskId/reveal', async (ctx) => {
    if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      ctx.status = 403;
      ctx.body = { error: { code: 'NOT_LOOPBACK', message: 'reveal disabled when bound to non-loopback' } };
      return;
    }
    const { taskId } = ctx.params;
    const dir = path.join(rootDir, 'work', taskId);
    if (!fs.existsSync(dir)) {
      ctx.status = 404;
      ctx.body = { error: { code: 'NOT_FOUND', message: 'task folder not found' } };
      return;
    }
    const child = spawn(pickOpener(), [dir], { detached: true, stdio: 'ignore' });
    if (child && typeof child.unref === 'function') child.unref();
    ctx.status = 200;
    ctx.body = { ok: true };
  });
}

module.exports = { registerRevealRoute };
```

- [ ] **Step 2.4: Wire reveal into router and accept `host` + `spawn` options**

Modify `services/http-server/index.js`. Near `const { createStaticServe } = require('./static-serve');` add:
```javascript
const { registerRevealRoute } = require('./reveal');
```

Inside `createApp(options)`, capture host:
```javascript
  const HOST = options.host ?? '127.0.0.1';
```

Pass `host` to staticServe (no-op there, but for consistency) and register reveal **after the `router` is created** (place right after the last `router.post(...)` block but before the `app.use(bodyParser())` line):
```javascript
  registerRevealRoute(router, { rootDir: ROOT_DIR, host: HOST, spawn: options.spawn });
```

- [ ] **Step 2.5: Run test to verify it passes**

```bash
node tests/http-reveal.test.js
```
Expected: `PASS http-reveal`.

- [ ] **Step 2.6: Commit**

```bash
git add services/http-server/reveal.js services/http-server/index.js tests/http-reveal.test.js
git commit -m "feat(http): add POST /api/tasks/:id/reveal (loopback only)"
```

---

## Task 3: Web — Vite + React + TS scaffold

**Files:**
- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.node.json`
- Create: `web/vite.config.ts`
- Create: `web/src/main.tsx`
- Create: `web/.gitignore`

- [ ] **Step 3.1: Create directory and package.json**

```bash
mkdir -p web/src/{routes,components,hooks,lib,stores,styles,test}
```

Create `web/package.json`:
```json
{
  "name": "video-learner-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --ext .ts,.tsx"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.0.0",
    "@tanstack/react-query": "^5.59.0",
    "zustand": "^5.0.0",
    "cmdk": "^1.0.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "rehype-highlight": "^7.0.0",
    "media-chrome": "^4.0.0",
    "framer-motion": "^11.11.0",
    "lucide-react": "^0.460.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.0",
    "typescript": "^5.6.3",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vitest": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.0",
    "eslint": "^9.13.0",
    "@typescript-eslint/parser": "^8.10.0",
    "@typescript-eslint/eslint-plugin": "^8.10.0"
  }
}
```

- [ ] **Step 3.2: Create tsconfig files**

Create `web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Create `web/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 3.3: Create vite.config.ts with backend proxy**

Create `web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    port: 5173,
    proxy: {
      '/api':      { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/events':   { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/healthz':  { target: 'http://127.0.0.1:3000', changeOrigin: false }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true
  }
});
```

- [ ] **Step 3.4: Create root index.html with token placeholder**

Create `web/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="vdl-token" content="" />
    <title>Video Learner</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3.5: Create entry main.tsx (stub)**

Create `web/src/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/globals.css';

function App() {
  return <div className="p-8">Video Learner — scaffold ok.</div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 3.6: Stub globals.css**

Create `web/src/styles/globals.css`:
```css
@import "tailwindcss";
body { font-family: system-ui, sans-serif; }
```

- [ ] **Step 3.7: Create .gitignore**

Create `web/.gitignore`:
```
node_modules
dist
*.local
.vite
```

- [ ] **Step 3.8: Install and verify dev server boots**

```bash
cd web && npm install
npm run dev
```
Expected: Vite reports `Local: http://localhost:5173/`. Open in browser → see "Video Learner — scaffold ok."
Stop with Ctrl-C.

- [ ] **Step 3.9: Commit**

```bash
cd ..
git add web/package.json web/index.html web/tsconfig*.json web/vite.config.ts web/src web/.gitignore
git commit -m "chore(web): scaffold Vite + React 19 + TS + Tailwind v4"
```

---

## Task 4: Web — Forest Calm design tokens

**Files:**
- Modify: `web/src/styles/globals.css`

- [ ] **Step 4.1: Replace globals.css with full design tokens**

Replace `web/src/styles/globals.css`:
```css
@import "tailwindcss";

@theme inline {
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

:root {
  --bg-canvas:     #F9F8F4;
  --bg-surface:    #FFFFFF;
  --bg-elevated:   #F1EFE9;
  --border-subtle: #E5E2DA;
  --border-strong: #CFCBC0;
  --text-primary:   #2C2A24;
  --text-secondary: #67645E;
  --text-tertiary:  #9C9890;
  --accent-3:  #EBF1E8;
  --accent-9:  #5A8A5A;
  --accent-10: #466F46;
  --accent-11: #3D5E3D;
  --accent-12: #243B24;
  --status-ok:   #4A8A5A;
  --status-err:  #B05050;
  --status-busy: #C28A3D;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-canvas:     #1A1A18;
    --bg-surface:    #232322;
    --bg-elevated:   #2A2A28;
    --border-subtle: #2E2E2B;
    --border-strong: #3D3E3B;
    --text-primary:   #E8E8E6;
    --text-secondary: #9A9B98;
    --text-tertiary:  #6B6C69;
    --accent-3:  #2A3A2A;
    --accent-9:  #7DAE7D;
    --accent-10: #6FA06F;
    --accent-11: #9BC79B;
    --accent-12: #C8E0C8;
  }
}

html, body {
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* Chinese reading line-height */
:lang(zh), .chinese { line-height: 1.75; }
.prose-cn {
  line-height: 1.85;
  font-size: 14px;
  color: var(--text-primary);
}
.prose-cn h2 {
  font-size: 18px; font-weight: 600;
  margin: 32px 0 12px; letter-spacing: -0.005em;
}
.prose-cn h3 {
  font-size: 14.5px; font-weight: 600;
  margin: 22px 0 8px;
}
.prose-cn p { margin: 14px 0; }
.prose-cn blockquote {
  border-left: 2px solid var(--accent-9);
  padding: 4px 0 4px 14px;
  margin: 18px 0;
  color: var(--text-secondary);
}
.prose-cn code {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--accent-11);
  background: var(--accent-3);
  padding: 1px 6px;
  border-radius: 3px;
}
.prose-cn ul { padding-left: 20px; margin: 12px 0; }
.prose-cn li { margin: 8px 0; }
.prose-cn strong { color: var(--text-primary); font-weight: 600; }
```

- [ ] **Step 4.2: Verify in browser**

```bash
cd web && npm run dev
```
Expected: page background is `#F9F8F4` (暖纸底). Stop.

- [ ] **Step 4.3: Commit**

```bash
cd .. && git add web/src/styles/globals.css
git commit -m "feat(web): Forest Calm design tokens (light + dark)"
```

---

## Task 5: Web — API + SSE layer

**Files:**
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/sse.ts`
- Create: `web/src/lib/time.ts`
- Create: `web/src/lib/time.test.ts`
- Create: `web/src/test/setup.ts`

- [ ] **Step 5.1: Create test setup**

Create `web/src/test/setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); });
```

- [ ] **Step 5.2: Write time.test.ts (failing)**

Create `web/src/lib/time.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { formatDuration, formatRelativeTime } from './time';

describe('formatDuration', () => {
  it('formats short durations as M:SS', () => {
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(932)).toBe('15:32');
  });
  it('formats long durations as H:MM:SS', () => {
    expect(formatDuration(3742)).toBe('1:02:22');
    expect(formatDuration(6501)).toBe('1:48:21');
  });
});

describe('formatRelativeTime', () => {
  it('returns "刚刚" for <60s', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
  });
  it('returns "N 分钟前" for minutes', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
  });
});
```

- [ ] **Step 5.3: Run failing**

```bash
cd web && npx vitest run src/lib/time.test.ts
```
Expected: FAIL (no exports).

- [ ] **Step 5.4: Implement time.ts**

Create `web/src/lib/time.ts`:
```typescript
export function formatDuration(totalSeconds: number): string {
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 7) return `${day} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

- [ ] **Step 5.5: Run passing**

```bash
npx vitest run src/lib/time.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5.6: Implement api.ts**

Create `web/src/lib/api.ts`:
```typescript
function readToken(): string {
  const el = document.querySelector('meta[name="vdl-token"]');
  return el?.getAttribute('content') ?? '';
}

const TOKEN = readToken();

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

async function request<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (TOKEN) headers.set('Authorization', `Bearer ${TOKEN}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(input, { ...init, headers });
  if (!res.ok) {
    let detail: Json = null;
    try { detail = await res.json(); } catch {}
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(detail)}`);
  }
  return res.status === 204 ? (undefined as T) : (await res.json() as T);
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';
export type TaskMode = 'media' | 'audio' | 'transcript' | 'full';

export interface Task {
  id: string;
  url: string;
  title?: string;
  uploader?: string;
  duration_seconds?: number;
  mode: TaskMode;
  output_lang?: string;
  focus?: string;
  status: TaskStatus;
  progress?: number;
  current_step?: string;
  error_message?: string;
  created_at: number;
  updated_at: number;
}

export interface Step {
  name: string;
  status: TaskStatus;
  started_at?: number;
  finished_at?: number;
  error_message?: string;
}

export const api = {
  listTasks: (limit = 200) => request<{ tasks: Task[] }>(`/api/tasks?limit=${limit}`),
  getTask:   (id: string) => request<{ task: Task }>(`/api/tasks/${id}`),
  getSteps:  (id: string) => request<{ steps: Step[] }>(`/api/tasks/${id}/steps`),
  getContent:(id: string, type: 'summary' | 'article' | 'transcript') =>
    fetch(`/api/tasks/${id}/result/content?type=${type}`, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
    }).then((r) => r.ok ? r.text() : ''),
  cancel:  (id: string) => request<{ ok: true }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  resume:  (id: string) => request<{ ok: true }>(`/api/tasks/${id}/resume`, { method: 'POST' }),
  remove:  (id: string, reset_scope: 'off' | 'step' | 'downstream' = 'off') =>
    request<{ ok: true }>(`/api/tasks/${id}?reset_scope=${reset_scope}`, { method: 'DELETE' }),
  reveal:  (id: string) => request<{ ok: true }>(`/api/tasks/${id}/reveal`, { method: 'POST' }),
  runStep: (id: string, step: string) =>
    request<{ ok: true }>(`/api/tasks/${id}/steps/${step}/run`, { method: 'POST' }),
  cancelStep: (id: string, step: string) =>
    request<{ ok: true }>(`/api/tasks/${id}/steps/${step}/cancel`, { method: 'POST' }),
  token: () => TOKEN
};
```

- [ ] **Step 5.7: Implement sse.ts**

Create `web/src/lib/sse.ts`:
```typescript
import { api } from './api';

export type SSEEvent =
  | { type: 'task.created'; taskId: string }
  | { type: 'task.update';  taskId: string }
  | { type: 'task.deleted'; taskId: string }
  | { type: 'step.update';  taskId: string; step: string }
  | { type: 'heartbeat' };

export function openEventStream(onEvent: (e: SSEEvent) => void): () => void {
  const token = api.token();
  const url = `/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const es = new EventSource(url);
  es.onmessage = (m) => {
    try {
      const parsed = JSON.parse(m.data);
      onEvent(parsed as SSEEvent);
    } catch (err) {
      console.warn('[sse] parse error', err);
    }
  };
  es.onerror = (err) => {
    // EventSource auto-reconnects; just log.
    console.warn('[sse] error', err);
  };
  return () => es.close();
}
```

- [ ] **Step 5.8: Commit**

```bash
cd .. && git add web/src/lib web/src/test
git commit -m "feat(web): api client, sse wrapper, time utils"
```

---

## Task 6: Web — Zustand stores

**Files:**
- Create: `web/src/stores/ui-store.ts`
- Create: `web/src/stores/player-store.ts`
- Create: `web/src/stores/player-store.test.ts`

- [ ] **Step 6.1: Write failing player-store test**

Create `web/src/stores/player-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from './player-store';

beforeEach(() => {
  usePlayerStore.getState().reset();
});

describe('player-store', () => {
  it('updates currentTime', () => {
    usePlayerStore.getState().setCurrentTime(42);
    expect(usePlayerStore.getState().currentTime).toBe(42);
  });

  it('derives active subtitle index from timestamps', () => {
    const segs = [{ start: 0 }, { start: 30 }, { start: 60 }, { start: 90 }];
    usePlayerStore.getState().setSubtitles(segs);
    usePlayerStore.getState().setCurrentTime(45);
    expect(usePlayerStore.getState().activeIndex).toBe(1);
    usePlayerStore.getState().setCurrentTime(120);
    expect(usePlayerStore.getState().activeIndex).toBe(3);
    usePlayerStore.getState().setCurrentTime(0);
    expect(usePlayerStore.getState().activeIndex).toBe(0);
  });

  it('reset clears state', () => {
    usePlayerStore.getState().setCurrentTime(99);
    usePlayerStore.getState().reset();
    expect(usePlayerStore.getState().currentTime).toBe(0);
    expect(usePlayerStore.getState().subtitles).toEqual([]);
  });
});
```

- [ ] **Step 6.2: Run failing**

```bash
cd web && npx vitest run src/stores/player-store.test.ts
```
Expected: FAIL.

- [ ] **Step 6.3: Implement player-store.ts**

Create `web/src/stores/player-store.ts`:
```typescript
import { create } from 'zustand';

export interface Subtitle { start: number; text?: string; }

interface PlayerState {
  currentTime: number;
  duration: number;
  playing: boolean;
  subtitles: Subtitle[];
  activeIndex: number;
  immersive: boolean;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setPlaying: (p: boolean) => void;
  setSubtitles: (s: Subtitle[]) => void;
  setImmersive: (b: boolean) => void;
  reset: () => void;
}

function deriveActive(subs: Subtitle[], t: number): number {
  if (!subs.length) return -1;
  let idx = 0;
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].start <= t) idx = i; else break;
  }
  return idx;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTime: 0,
  duration: 0,
  playing: false,
  subtitles: [],
  activeIndex: -1,
  immersive: false,
  setCurrentTime: (t) => set({ currentTime: t, activeIndex: deriveActive(get().subtitles, t) }),
  setDuration: (d) => set({ duration: d }),
  setPlaying: (p) => set({ playing: p }),
  setSubtitles: (s) => set({ subtitles: s, activeIndex: deriveActive(s, get().currentTime) }),
  setImmersive: (b) => set({ immersive: b }),
  reset: () => set({ currentTime: 0, duration: 0, playing: false, subtitles: [], activeIndex: -1, immersive: false })
}));
```

- [ ] **Step 6.4: Run passing**

```bash
npx vitest run src/stores/player-store.test.ts
```
Expected: PASS.

- [ ] **Step 6.5: Implement ui-store.ts**

Create `web/src/stores/ui-store.ts`:
```typescript
import { create } from 'zustand';

export type Theme = 'system' | 'light' | 'dark';
export type StatusFilter = 'all' | 'running' | 'done' | 'failed';

interface UiState {
  theme: Theme;
  paletteOpen: boolean;
  statusFilter: StatusFilter;
  setTheme: (t: Theme) => void;
  setPaletteOpen: (open: boolean) => void;
  setStatusFilter: (f: StatusFilter) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  paletteOpen: false,
  statusFilter: 'all',
  setTheme: (theme) => set({ theme }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setStatusFilter: (statusFilter) => set({ statusFilter })
}));
```

- [ ] **Step 6.6: Commit**

```bash
cd .. && git add web/src/stores
git commit -m "feat(web): player + ui Zustand stores"
```

---

## Task 7: Web — TanStack Query hooks + SSE bridge

**Files:**
- Create: `web/src/hooks/use-tasks.ts`
- Create: `web/src/hooks/use-task-stream.ts`
- Create: `web/src/hooks/use-hotkeys.ts`

- [ ] **Step 7.1: Implement use-tasks.ts**

Create `web/src/hooks/use-tasks.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Task } from '@/lib/api';

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => (await api.listTasks(200)).tasks,
    staleTime: 60_000
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: async () => (await api.getTask(id!)).task,
    enabled: Boolean(id),
    staleTime: 30_000
  });
}

export function useSteps(id: string | undefined) {
  return useQuery({
    queryKey: ['task', id, 'steps'],
    queryFn: async () => (await api.getSteps(id!)).steps,
    enabled: Boolean(id),
    staleTime: 10_000
  });
}

export function useContent(id: string | undefined, type: 'summary' | 'article' | 'transcript') {
  return useQuery({
    queryKey: ['task', id, 'content', type],
    queryFn: () => api.getContent(id!, type),
    enabled: Boolean(id),
    staleTime: Infinity
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancel(id),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: ['task', id] })
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] })
  });
}

export function useReveal() {
  return useMutation({ mutationFn: (id: string) => api.reveal(id) });
}

export type { Task };
```

- [ ] **Step 7.2: Implement use-task-stream.ts**

Create `web/src/hooks/use-task-stream.ts`:
```typescript
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openEventStream } from '@/lib/sse';

export function useTaskStream() {
  const qc = useQueryClient();
  useEffect(() => {
    const close = openEventStream((e) => {
      switch (e.type) {
        case 'task.created':
        case 'task.deleted':
          qc.invalidateQueries({ queryKey: ['tasks'] });
          break;
        case 'task.update':
          qc.invalidateQueries({ queryKey: ['task', e.taskId] });
          qc.invalidateQueries({ queryKey: ['tasks'] });
          break;
        case 'step.update':
          qc.invalidateQueries({ queryKey: ['task', e.taskId, 'steps'] });
          break;
      }
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        qc.invalidateQueries({ queryKey: ['tasks'] });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { close(); document.removeEventListener('visibilitychange', onVisible); };
  }, [qc]);
}
```

- [ ] **Step 7.3: Implement use-hotkeys.ts**

Create `web/src/hooks/use-hotkeys.ts`:
```typescript
import { useEffect } from 'react';
import { useUiStore } from '@/stores/ui-store';
import { usePlayerStore } from '@/stores/player-store';

export function useGlobalHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUiStore.getState().setPaletteOpen(!useUiStore.getState().paletteOpen);
      } else if (e.key === 'Escape') {
        if (useUiStore.getState().paletteOpen) useUiStore.getState().setPaletteOpen(false);
        if (usePlayerStore.getState().immersive) usePlayerStore.getState().setImmersive(false);
      } else if (e.key.toLowerCase() === 'f' && !meta && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        usePlayerStore.getState().setImmersive(!usePlayerStore.getState().immersive);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
```

- [ ] **Step 7.4: Commit**

```bash
git add web/src/hooks
git commit -m "feat(web): TanStack Query hooks + SSE bridge + global hotkeys"
```

---

## Task 8: Web — Router shell + Root layout

**Files:**
- Create: `web/src/routes/_layout.tsx`
- Create: `web/src/routes/_index.tsx` (placeholder)
- Create: `web/src/routes/tasks.$id.tsx` (placeholder)
- Modify: `web/src/main.tsx`

- [ ] **Step 8.1: Create _layout.tsx**

Create `web/src/routes/_layout.tsx`:
```typescript
import { Outlet } from 'react-router';
import { useTaskStream } from '@/hooks/use-task-stream';
import { useGlobalHotkeys } from '@/hooks/use-hotkeys';

export default function RootLayout() {
  useTaskStream();
  useGlobalHotkeys();
  return <Outlet />;
}
```

- [ ] **Step 8.2: Create placeholder home + detail routes**

Create `web/src/routes/_index.tsx`:
```typescript
export default function Home() {
  return <div className="p-8">Home (placeholder)</div>;
}
```

Create `web/src/routes/tasks.$id.tsx`:
```typescript
import { useParams } from 'react-router';
export default function TaskDetail() {
  const { id } = useParams();
  return <div className="p-8">Task detail: {id}</div>;
}
```

- [ ] **Step 8.3: Wire router in main.tsx**

Replace `web/src/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RootLayout from './routes/_layout';
import Home from './routes/_index';
import TaskDetail from './routes/tasks.$id';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } }
});

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/tasks/:id', element: <TaskDetail /> }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 8.4: Verify dev**

```bash
cd web && npm run dev
```
Open `http://localhost:5173/` (home) and `http://localhost:5173/tasks/test123` (detail placeholder). Both should render. Stop.

- [ ] **Step 8.5: Commit**

```bash
cd .. && git add web/src/main.tsx web/src/routes
git commit -m "feat(web): router shell + QueryClient + global wiring"
```

---

## Task 9: Web — Home page

**Files:**
- Create: `web/src/components/filter-bar.tsx`
- Create: `web/src/components/task-row.tsx`
- Create: `web/src/components/task-row.test.tsx`
- Modify: `web/src/routes/_index.tsx`

- [ ] **Step 9.1: Write failing TaskRow test**

Create `web/src/components/task-row.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TaskRow } from './task-row';
import type { Task } from '@/lib/api';

const baseTask: Task = {
  id: 'abc',
  url: 'https://youtube.com/watch?v=x',
  title: 'Test Video',
  mode: 'media',
  duration_seconds: 932,
  status: 'done',
  created_at: Date.now() - 5 * 60_000,
  updated_at: Date.now() - 5 * 60_000
};

describe('TaskRow', () => {
  it('renders title and meta', () => {
    render(<MemoryRouter><TaskRow task={baseTask} /></MemoryRouter>);
    expect(screen.getByText('Test Video')).toBeInTheDocument();
    expect(screen.getByText(/media · 15:32/)).toBeInTheDocument();
  });

  it('shows progress bar only while running', () => {
    const { container, rerender } = render(
      <MemoryRouter><TaskRow task={baseTask} /></MemoryRouter>
    );
    expect(container.querySelector('[data-testid="progress"]')).toBeNull();

    rerender(
      <MemoryRouter>
        <TaskRow task={{ ...baseTask, status: 'running', progress: 47, current_step: '正在转录' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('progress')).toBeInTheDocument();
    expect(screen.getByText(/正在转录 47%/)).toBeInTheDocument();
  });

  it('renders failure message', () => {
    render(
      <MemoryRouter>
        <TaskRow task={{ ...baseTask, status: 'failed', error_message: 'fetch HTTP 403' }} />
      </MemoryRouter>
    );
    expect(screen.getByText(/失败.*HTTP 403/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9.2: Run failing**

```bash
cd web && npx vitest run src/components/task-row.test.tsx
```
Expected: FAIL.

- [ ] **Step 9.3: Implement TaskRow**

Create `web/src/components/task-row.tsx`:
```typescript
import { Link } from 'react-router';
import type { Task } from '@/lib/api';
import { formatDuration, formatRelativeTime } from '@/lib/time';

export function TaskRow({ task }: { task: Task }) {
  const isRunning = task.status === 'running';
  const isFailed  = task.status === 'failed';
  const duration  = task.duration_seconds ? formatDuration(task.duration_seconds) : '';
  const meta = [
    task.mode,
    duration,
    isRunning && task.current_step && task.progress != null ? `${task.current_step} ${task.progress}%` : null,
    task.focus
  ].filter(Boolean).join(' · ');

  return (
    <li className="task-row py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
      <Link to={`/tasks/${task.id}`} className="block">
        <div className="flex items-baseline gap-3 mb-1.5">
          <h2 className="chinese text-[15.5px] font-medium flex-1 truncate"
              style={{ color: isFailed ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
            {task.title || task.url}
          </h2>
          <span className="text-xs mono flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
            {formatRelativeTime(task.updated_at)}
          </span>
        </div>
        {isFailed ? (
          <div className="text-xs mono truncate" style={{ color: 'var(--status-err)' }}>
            失败 · {task.error_message || 'unknown error'}
          </div>
        ) : (
          <div className="text-xs mono truncate mb-2" style={{ color: 'var(--text-tertiary)' }}>
            {meta}
          </div>
        )}
        {isRunning && task.progress != null && (
          <div data-testid="progress" className="max-w-md h-0.5 rounded-full overflow-hidden"
               style={{ background: 'var(--border-subtle)' }}>
            <span className="block h-full pulse" style={{ width: `${task.progress}%`, background: 'var(--accent-9)' }} />
          </div>
        )}
      </Link>
      <style>{`
        .task-row { transition: background 160ms ease-out; }
        .task-row:hover { background: var(--bg-surface); }
        .mono { font-family: var(--font-mono); }
        .pulse { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
      `}</style>
    </li>
  );
}
```

- [ ] **Step 9.4: Run passing**

```bash
npx vitest run src/components/task-row.test.tsx
```
Expected: PASS.

- [ ] **Step 9.5: Implement FilterBar**

Create `web/src/components/filter-bar.tsx`:
```typescript
import { useUiStore, type StatusFilter } from '@/stores/ui-store';
import type { Task } from '@/lib/api';

const OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all',     label: '全部' },
  { value: 'running', label: '进行中' },
  { value: 'done',    label: '已完成' },
  { value: 'failed',  label: '失败' }
];

export function FilterBar({ tasks }: { tasks: Task[] }) {
  const filter = useUiStore((s) => s.statusFilter);
  const setFilter = useUiStore((s) => s.setStatusFilter);

  const counts: Record<StatusFilter, number> = {
    all: tasks.length,
    running: tasks.filter((t) => t.status === 'running' || t.status === 'pending').length,
    done: tasks.filter((t) => t.status === 'done').length,
    failed: tasks.filter((t) => t.status === 'failed').length
  };

  return (
    <nav className="flex items-center gap-6 mb-6 text-sm">
      {OPTIONS.map((o) => {
        const active = filter === o.value;
        return (
          <button key={o.value}
                  onClick={() => setFilter(o.value)}
                  className="cursor-pointer transition-colors"
                  style={{
                    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: active ? 500 : 400
                  }}>
            {o.label} <span className="text-xs ml-0.5" style={{ fontFamily: 'var(--font-mono)' }}>
              {counts[o.value]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 9.6: Wire Home route**

Replace `web/src/routes/_index.tsx`:
```typescript
import { useTasks } from '@/hooks/use-tasks';
import { useUiStore } from '@/stores/ui-store';
import { TaskRow } from '@/components/task-row';
import { FilterBar } from '@/components/filter-bar';

export default function Home() {
  const { data: tasks = [], isLoading } = useTasks();
  const filter = useUiStore((s) => s.statusFilter);

  const filtered = tasks.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'running') return t.status === 'running' || t.status === 'pending';
    return t.status === filter;
  });

  return (
    <div className="max-w-3xl mx-auto px-8 pt-16 pb-24">
      <header className="flex items-baseline justify-between mb-10">
        <h1 className="text-lg font-semibold tracking-tight">Video Learner</h1>
        <button className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          搜索 <kbd className="ml-1.5 px-1.5 py-0.5 rounded border text-[11px]"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>⌘K</kbd>
        </button>
      </header>

      <FilterBar tasks={tasks} />

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
          暂无任务<br/>
          新建任务：终端输入 <code className="mono" style={{ color: 'var(--accent-11)' }}>vdl &lt;URL&gt;</code>
        </div>
      ) : (
        <ul>
          {filtered.map((t) => <TaskRow key={t.id} task={t} />)}
        </ul>
      )}

      <div className="mt-16 text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
        新建任务：在终端输入 <code className="mono" style={{ color: 'var(--accent-11)' }}>vdl &lt;URL&gt;</code>
      </div>
    </div>
  );
}
```

- [ ] **Step 9.7: Smoke test with real backend**

In one terminal start backend:
```bash
npm run agent:serve
```
In another:
```bash
cd web && npm run dev
```
Open `http://localhost:5173/`. Expected: existing tasks list rendered. Click one row → detail placeholder shows the id.

- [ ] **Step 9.8: Commit**

```bash
cd .. && git add web/src/components/filter-bar.tsx web/src/components/task-row.tsx web/src/components/task-row.test.tsx web/src/routes/_index.tsx
git commit -m "feat(web): home page with filter + task list (TanStack Query + SSE)"
```

---

## Task 10: Web — Detail page shell

**Files:**
- Modify: `web/src/routes/tasks.$id.tsx`

- [ ] **Step 10.1: Build detail page shell**

Replace `web/src/routes/tasks.$id.tsx`:
```typescript
import { useParams, Link } from 'react-router';
import { useState } from 'react';
import { useTask } from '@/hooks/use-tasks';

export default function TaskDetail() {
  const { id = '' } = useParams();
  const { data: task, isLoading } = useTask(id);
  const [tab, setTab] = useState<'summary' | 'article'>('summary');

  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>;
  if (!task) return <div className="p-8 text-sm" style={{ color: 'var(--status-err)' }}>未找到任务</div>;

  return (
    <div className="h-screen flex flex-col">
      {/* 顶栏 */}
      <header className="h-12 flex items-center justify-between px-5 border-b"
              style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-4 min-w-0">
          <Link to="/" className="text-sm" style={{ color: 'var(--text-tertiary)' }}>←</Link>
          <h1 className="chinese text-sm font-medium truncate">{task.title || task.url}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <span>沉浸 <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>F</kbd></span>
          <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>⌘K</kbd>
          <button>⋯</button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left 42% — player + transcript (filled in next tasks) */}
        <section className="w-[42%] flex flex-col border-r" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="aspect-video bg-black flex items-center justify-center text-white/30 text-xs">
            player placeholder
          </div>
          <div className="flex-1 overflow-y-auto p-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            transcript placeholder
          </div>
        </section>

        {/* Right 58% — tabs + reading */}
        <section className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-12 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex">
              {(['summary', 'article'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                        className="py-2.5 mr-6 text-sm border-b-2 transition-colors cursor-pointer"
                        style={{
                          borderColor: tab === t ? 'var(--accent-9)' : 'transparent',
                          color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                          fontWeight: tab === t ? 500 : 400
                        }}>
                  {t === 'summary' ? '总结' : '文章'}
                </button>
              ))}
            </div>
            <button className="text-xs py-3" style={{ color: 'var(--text-tertiary)' }}>复制</button>
          </div>
          <div className="flex-1 overflow-y-auto px-12 py-14 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            reading placeholder (tab = {tab})
          </div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Smoke test**

Visit detail page for an existing task. Expected: shell renders with 42:58 split, tabs switch.

- [ ] **Step 10.3: Commit**

```bash
git add web/src/routes/tasks.$id.tsx
git commit -m "feat(web): task detail shell with 42:58 split + tabs"
```

---

## Task 11: Web — Reader (Markdown + TOC)

**Files:**
- Create: `web/src/components/reader.tsx`
- Create: `web/src/components/toc.tsx`
- Modify: `web/src/routes/tasks.$id.tsx`

- [ ] **Step 11.1: Implement Reader**

Create `web/src/components/reader.tsx`:
```typescript
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface ReaderProps {
  content: string;
}

export function Reader({ content }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  return (
    <article className="prose-cn">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {md}
      </ReactMarkdown>
    </article>
  );
}
```

- [ ] **Step 11.2: Implement TOC with scroll-spy**

Create `web/src/components/toc.tsx`:
```typescript
import { useEffect, useRef, useState } from 'react';

export interface TocItem { id: string; text: string; level: 2 | 3; }

export function extractToc(markdown: string): TocItem[] {
  const lines = markdown.split('\n');
  const items: TocItem[] = [];
  for (const line of lines) {
    const m2 = line.match(/^##\s+(.+)$/);
    const m3 = line.match(/^###\s+(.+)$/);
    const text = (m2 ?? m3)?.[1]?.trim();
    if (!text) continue;
    const id = text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '');
    items.push({ id, text, level: m2 ? 2 : 3 });
  }
  return items;
}

export function Toc({ items, containerSelector = 'article.prose-cn' }: { items: TocItem[]; containerSelector?: string }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const obs = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const root = document.querySelector(containerSelector);
    if (!root) return;
    const headings = Array.from(root.querySelectorAll('h2, h3'));
    headings.forEach((h, i) => {
      if (items[i] && !h.id) h.id = items[i].id;
    });
    obs.current = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '0px 0px -70% 0px' });
    headings.forEach((h) => obs.current?.observe(h));
    return () => obs.current?.disconnect();
  }, [items, containerSelector]);

  return (
    <aside className="w-44 px-6 py-14 flex-shrink-0">
      <nav className="sticky top-14">
        {items.map((it) => (
          <a key={it.id} href={`#${it.id}`}
             className="block py-1 text-[12.5px] transition-colors"
             style={{
               color: active === it.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
               fontWeight: active === it.id ? 500 : 400,
               paddingLeft: it.level === 3 ? 12 : 0
             }}>
            {it.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 11.3: Wire Reader + TOC into detail page**

Modify `web/src/routes/tasks.$id.tsx`. Add imports near top:
```typescript
import { useContent } from '@/hooks/use-tasks';
import { Reader } from '@/components/reader';
import { Toc, extractToc } from '@/components/toc';
import { useMemo } from 'react';
```

Inside `TaskDetail` after `useTask`:
```typescript
  const { data: content = '' } = useContent(id, tab);
  const toc = useMemo(() => extractToc(content), [content]);
```

Replace the reading placeholder div with:
```typescript
          <div className="flex-1 overflow-y-auto">
            <div className="flex max-w-5xl mx-auto">
              <div className="flex-1 px-12 py-14">
                <Reader content={content} />
              </div>
              <Toc items={toc} />
            </div>
          </div>
```

- [ ] **Step 11.4: Smoke test**

Navigate to a completed task. Expected: summary renders as styled Markdown, TOC on right shows ## headings, scroll-spy highlights current heading.

- [ ] **Step 11.5: Commit**

```bash
git add web/src/components/reader.tsx web/src/components/toc.tsx web/src/routes/tasks.$id.tsx
git commit -m "feat(web): Markdown reader + TOC with scroll-spy"
```

---

## Task 12: Web — Subtitle list + player-store sync

**Files:**
- Create: `web/src/components/subtitle-list.tsx`
- Modify: `web/src/routes/tasks.$id.tsx`

- [ ] **Step 12.1: Implement SubtitleList**

Create `web/src/components/subtitle-list.tsx`:
```typescript
import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';

interface Segment { start: number; end?: number; text: string; }

interface SubtitlesPayload {
  tracks: { lang: string; segments: Segment[] }[];
}

export function SubtitleList({ taskId }: { taskId: string }) {
  const [tracks, setTracks] = useState<SubtitlesPayload['tracks']>([]);
  const [lang, setLang] = useState<string>('zh-CN');
  const setSubtitles = usePlayerStore((s) => s.setSubtitles);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const activeIndex = usePlayerStore((s) => s.activeIndex);
  const containerRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tasks/${taskId}/subtitles`, {
      headers: { Authorization: `Bearer ${api.token()}` }
    })
      .then((r) => r.ok ? r.json() : { tracks: [] })
      .then((data: SubtitlesPayload) => {
        if (cancelled) return;
        setTracks(data.tracks ?? []);
        const first = data.tracks?.[0];
        if (first) {
          setLang(first.lang);
          setSubtitles(first.segments);
        }
      });
    return () => { cancelled = true; };
  }, [taskId, setSubtitles]);

  // auto-scroll active row into view
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = containerRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  const current = tracks.find((t) => t.lang === lang) ?? tracks[0];
  const segments = current?.segments ?? [];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="px-4 py-2.5 flex items-center gap-4 text-xs border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {tracks.map((t) => (
          <button key={t.lang} onClick={() => { setLang(t.lang); setSubtitles(t.segments); }}
                  className="cursor-pointer"
                  style={{
                    color: lang === t.lang ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: lang === t.lang ? 500 : 400
                  }}>
            {t.lang === 'zh-CN' ? '中文' : t.lang === 'en' ? 'EN' : t.lang}
          </button>
        ))}
        <span className="ml-auto" style={{ color: 'var(--text-tertiary)' }}>{segments.length} 段</span>
      </div>
      <ul ref={containerRef} className="py-2 flex-1 overflow-y-auto">
        {segments.map((seg, idx) => (
          <li key={idx} data-idx={idx}
              onClick={() => setCurrentTime(seg.start)}
              className="px-4 py-2.5 cursor-pointer subtitle-row"
              style={{
                background: idx === activeIndex ? 'var(--accent-3)' : 'transparent'
              }}>
            <div className="mono text-xs mb-1"
                 style={{ color: idx === activeIndex ? 'var(--accent-11)' : 'var(--text-tertiary)' }}>
              {formatDuration(seg.start)}
            </div>
            <p className="chinese text-[13.5px]"
               style={{ color: idx === activeIndex ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {seg.text}
            </p>
          </li>
        ))}
      </ul>
      <style>{`
        .subtitle-row { transition: background 120ms ease-out; }
        .subtitle-row:hover { background: var(--bg-canvas); }
        .mono { font-family: var(--font-mono); font-size: 12.5px; }
        .chinese { line-height: 1.75; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 12.2: Wire into detail page**

Modify `web/src/routes/tasks.$id.tsx`. Add import:
```typescript
import { SubtitleList } from '@/components/subtitle-list';
```

Replace transcript placeholder:
```typescript
          <SubtitleList taskId={id} />
```

- [ ] **Step 12.3: Smoke test**

Open a completed task with subtitles. Expected: list of timestamped segments visible. Click a segment → no effect yet (player not wired); active class moves to clicked segment via store. Lang switch toggles.

- [ ] **Step 12.4: Commit**

```bash
git add web/src/components/subtitle-list.tsx web/src/routes/tasks.$id.tsx
git commit -m "feat(web): subtitle list with timestamp sync + lang switch"
```

---

## Task 13: Web — Media player wired to store

**Files:**
- Create: `web/src/components/player.tsx`
- Modify: `web/src/routes/tasks.$id.tsx`

- [ ] **Step 13.1: Implement Player**

Create `web/src/components/player.tsx`:
```typescript
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';

export function Player({ taskId, kind }: { taskId: string; kind: 'video' | 'audio' }) {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const playing = usePlayerStore((s) => s.playing);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const duration = usePlayerStore((s) => s.duration);

  // External time changes (e.g. subtitle click) → seek
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (Math.abs(el.currentTime - currentTime) > 0.5) {
      el.currentTime = currentTime;
    }
  }, [currentTime]);

  // Build authenticated media URL — backend serves /api/tasks/:id/media
  const src = `/api/tasks/${taskId}/media?token=${encodeURIComponent(api.token())}`;

  const Media = kind === 'video' ? 'video' : 'audio';

  return (
    <div className="relative bg-black flex-shrink-0" style={{ aspectRatio: kind === 'video' ? '16/9' : 'auto', height: kind === 'audio' ? 120 : undefined }}>
      <Media
        ref={ref as React.RefObject<HTMLVideoElement & HTMLAudioElement>}
        src={src}
        className="w-full h-full object-contain"
        onLoadedMetadata={(e) => setDuration((e.currentTarget as HTMLMediaElement).duration)}
        onTimeUpdate={(e) => setCurrentTime((e.currentTarget as HTMLMediaElement).currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        controls={kind === 'audio'}
      />
      {kind === 'video' && (
        <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/70 to-transparent">
          <div className="flex items-center gap-3 text-white text-xs">
            <button className="text-base"
                    onClick={() => { const el = ref.current; if (!el) return; playing ? el.pause() : el.play(); }}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="mono text-white/70">
              {formatDuration(currentTime)} / {formatDuration(duration || 0)}
            </span>
            <div className="flex-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full"
                   style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%',
                            background: 'var(--accent-9)' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 13.2: Wire into detail page**

Modify `web/src/routes/tasks.$id.tsx`. Add import:
```typescript
import { Player } from '@/components/player';
```

Replace player placeholder in left section:
```typescript
          <Player taskId={id} kind={task.mode === 'audio' ? 'audio' : 'video'} />
```

- [ ] **Step 13.3: Smoke test**

Open completed media task. Expected: video loads, plays, current subtitle highlights as time progresses. Click subtitle → video seeks.

- [ ] **Step 13.4: Commit**

```bash
git add web/src/components/player.tsx web/src/routes/tasks.$id.tsx
git commit -m "feat(web): media player wired to player-store (two-way sync)"
```

---

## Task 14: Web — Copy + reveal actions

**Files:**
- Modify: `web/src/routes/tasks.$id.tsx`

- [ ] **Step 14.1: Implement copy + reveal handlers**

Modify `web/src/routes/tasks.$id.tsx`. Add imports:
```typescript
import { useReveal } from '@/hooks/use-tasks';
```

Inside `TaskDetail` after existing hooks:
```typescript
  const reveal = useReveal();

  const onCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
  };

  const onReveal = () => reveal.mutate(id);
```

Replace the existing 复制 button:
```typescript
            <div className="flex items-center gap-3 py-3 text-xs">
              <button onClick={onCopy} style={{ color: 'var(--text-tertiary)' }}
                      className="hover:text-[var(--text-secondary)]">复制</button>
              <button onClick={onReveal} style={{ color: 'var(--text-tertiary)' }}
                      className="hover:text-[var(--text-secondary)]">显示文件</button>
            </div>
```

- [ ] **Step 14.2: Smoke test**

Open a task. Click 复制 → paste into terminal → verify Markdown text. Click 显示文件 → Finder opens `work/<task_id>/`.

- [ ] **Step 14.3: Commit**

```bash
git add web/src/routes/tasks.$id.tsx
git commit -m "feat(web): copy summary + reveal task folder actions"
```

---

## Task 15: Web — Command palette (⌘K)

**Files:**
- Create: `web/src/components/command-palette.tsx`
- Modify: `web/src/routes/_layout.tsx`

- [ ] **Step 15.1: Implement CommandPalette**

Create `web/src/components/command-palette.tsx`:
```typescript
import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import { useUiStore } from '@/stores/ui-store';
import { useTasks } from '@/hooks/use-tasks';
import { formatDuration, formatRelativeTime } from '@/lib/time';

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setTheme = useUiStore((s) => s.setTheme);
  const navigate = useNavigate();
  const { data: tasks = [] } = useTasks();

  if (!open) return null;

  const close = () => setOpen(false);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4"
         style={{ background: 'rgba(31,37,32,0.12)' }}
         onClick={close}>
      <Command label="Command Menu"
               className="w-full max-w-xl rounded-xl overflow-hidden"
               style={{
                 background: 'var(--bg-surface)',
                 boxShadow: '0 24px 64px -16px rgba(31,37,32,.18), 0 0 0 1px var(--border-subtle)'
               }}
               onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="mr-3" style={{ color: 'var(--text-tertiary)' }}>🔍</span>
          <Command.Input placeholder="搜索任务、命令…"
                         className="flex-1 bg-transparent outline-none text-sm" />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded border"
               style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>ESC</kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto py-2">
          <Command.Empty className="px-4 py-6 text-sm text-center"
                         style={{ color: 'var(--text-tertiary)' }}>无匹配结果</Command.Empty>

          <Command.Group heading="任务"
                         className="text-xs uppercase tracking-wider"
                         style={{ color: 'var(--text-tertiary)' }}>
            {tasks.slice(0, 8).map((t) => (
              <Command.Item key={t.id} value={`${t.title} ${t.url}`}
                            onSelect={() => { navigate(`/tasks/${t.id}`); close(); }}
                            className="flex items-center gap-3 px-3 py-2 rounded mx-1 cursor-pointer">
                <div className="w-9 h-9 rounded flex items-center justify-center text-sm"
                     style={{ background: 'var(--accent-3)' }}>🎥</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.title || t.url}</div>
                  <div className="mono text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {t.mode} · {t.duration_seconds ? formatDuration(t.duration_seconds) : ''} · {formatRelativeTime(t.updated_at)}
                  </div>
                </div>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="命令">
            <Command.Item onSelect={() => { navigator.clipboard.writeText('vdl '); close(); }}
                          className="px-3 py-2 rounded mx-1 cursor-pointer text-sm">
              复制 <code className="mono" style={{ color: 'var(--accent-11)' }}>vdl &lt;URL&gt;</code> 命令模板
            </Command.Item>
            <Command.Item onSelect={() => { setTheme('light'); close(); }}
                          className="px-3 py-2 rounded mx-1 cursor-pointer text-sm">切换到浅色主题</Command.Item>
            <Command.Item onSelect={() => { setTheme('dark'); close(); }}
                          className="px-3 py-2 rounded mx-1 cursor-pointer text-sm">切换到深色主题</Command.Item>
            <Command.Item onSelect={() => { setTheme('system'); close(); }}
                          className="px-3 py-2 rounded mx-1 cursor-pointer text-sm">跟随系统主题</Command.Item>
          </Command.Group>
        </Command.List>

        <div className="border-t px-4 py-2.5 text-xs flex items-center justify-between"
             style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          <div className="flex items-center gap-3">
            <span>↑↓ 导航</span>
            <span>↵ 选择</span>
            <span>ESC 关闭</span>
          </div>
          <span>{tasks.length} 个任务</span>
        </div>
      </Command>
      <style>{`
        [cmdk-item][data-selected="true"] { background: var(--bg-elevated); }
        .mono { font-family: var(--font-mono); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 15.2: Mount in root layout**

Modify `web/src/routes/_layout.tsx`:
```typescript
import { Outlet } from 'react-router';
import { useTaskStream } from '@/hooks/use-task-stream';
import { useGlobalHotkeys } from '@/hooks/use-hotkeys';
import { CommandPalette } from '@/components/command-palette';

export default function RootLayout() {
  useTaskStream();
  useGlobalHotkeys();
  return (
    <>
      <Outlet />
      <CommandPalette />
    </>
  );
}
```

- [ ] **Step 15.3: Smoke test**

Press ⌘K (or Ctrl+K on Linux/Win). Expected: palette opens, type search → tasks filter, Enter → navigate; ESC closes.

- [ ] **Step 15.4: Commit**

```bash
git add web/src/components/command-palette.tsx web/src/routes/_layout.tsx
git commit -m "feat(web): ⌘K command palette (tasks + theme commands)"
```

---

## Task 16: Production build + Koa integration

**Files:**
- Modify: root `package.json`
- Verify: end-to-end

- [ ] **Step 16.1: Add build script in root package.json**

In root `package.json` scripts:
```json
"web:build": "cd web && npm run build",
"web:dev": "cd web && npm run dev",
"web:install": "cd web && npm install",
```

- [ ] **Step 16.2: Build Web app**

```bash
npm run web:install   # if not already installed
npm run web:build
```
Expected: `web/dist/index.html` and `web/dist/assets/*.js,*.css` exist.

- [ ] **Step 16.3: Serve via Koa and verify**

Stop any running dev servers. Start backend only:
```bash
npm run agent:serve
```

Open `http://127.0.0.1:3000/` in browser. Expected:
- HTML loads with `<meta name="vdl-token" content="...">` injected (View Source)
- App renders identical to Vite dev mode
- Task list populates
- Click into a task → detail page loads
- ⌘K palette works

- [ ] **Step 16.4: Add web/ ignore in production**

Append to root `.gitignore`:
```
web/node_modules
web/dist
```

- [ ] **Step 16.5: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: web build scripts + ignore generated artifacts"
```

---

## Task 17: Switch Electron to load Web

**Files:**
- Modify: `electron/src/main.js`

- [ ] **Step 17.1: Locate loadFile call**

```bash
grep -n "loadFile\|loadURL" electron/src/main.js
```

- [ ] **Step 17.2: Replace loadFile with loadURL**

Modify `electron/src/main.js`. Find the line calling `win.loadFile(...)` and replace with:
```javascript
  win.loadURL('http://127.0.0.1:3000/');
```

Keep the backend-start logic (Electron already spawns the backend before opening the window).

- [ ] **Step 17.3: Smoke test Electron**

```bash
bash start-electron.sh
```
Expected: Electron window opens, shows the new Web UI (identical to browser at :3000).

- [ ] **Step 17.4: Commit**

```bash
git add electron/src/main.js
git commit -m "feat(electron): loadURL → http://127.0.0.1:3000 (uses new Web)"
```

---

## Self-Review Notes (already applied)

- ✅ Spec §0 tech stack: covered by Tasks 3, 4, 5, 6, 7, 8
- ✅ §1 directory structure: matches Tasks 3, 5–15
- ✅ §2 design tokens: Task 4
- ✅ §3 detail page (player + reading): Tasks 10–14
- ✅ §4 home page (list + filter + SSE): Tasks 7, 9
- ✅ §5 backend contracts: Tasks 1, 2 (reveal); existing endpoints reused
- ✅ §6 state management split: Tasks 6, 7
- ✅ §7 auth: token meta tag (Task 1), Bearer (Task 5), SSE ?token (Task 5)
- ✅ §8 coexistence with Electron: Task 17 (`loadURL`)
- ⏸ §9 testing: Vitest unit coverage in Tasks 5/6/9; full Playwright E2E deferred
- ⏸ §10 risks: addressed inline (token meta + `Cache-Control: no-store` in Task 1; SSE visibility refetch in Task 7)
- ⏸ §11 out-of-scope: respected (no creation UI)
- ⏸ §12 sequence: tasks ordered per spec recommendation

### Deferred (future plans)

| Item | Reason | Future plan |
|---|---|---|
| ZIP export endpoint + button | Out of MVP parity | `2026-XX-XX-export-zip.md` |
| `wavesurfer.js` waveform | Decorative; audio works with `<audio>` controls | `2026-XX-XX-audio-waveform.md` |
| Immersive mode UI | Hotkey wired (Task 7); full chrome-hide deferred | `2026-XX-XX-immersive-mode.md` |
| Playwright E2E suite | Manual smoke first; add after stabilization | `2026-XX-XX-web-e2e.md` |
| `/legacy` route | Electron `loadURL` covers fallback; explicit route unneeded short-term | n/a |
| Delete `electron/` directory | Wait 2-4 weeks of new-Web stability | `2026-XX-XX-retire-electron.md` |

---

Plan complete and saved to `docs/superpowers/plans/2026-06-16-electron-to-web-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

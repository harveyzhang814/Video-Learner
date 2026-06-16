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
 * Serves the Web SPA from <rootDir>/web/dist.
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

    // assets — only paths under /assets/
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

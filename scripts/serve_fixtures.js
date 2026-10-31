/**
 * Rahi - Practice Errand & Showcase Server
 * Zero-dependency static server to serve test fixtures and showcase landing page
 * for interactive manual testing and evaluation demonstrations.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 3000;
const ROOT_DIR = process.cwd();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];

  // Route shortcuts
  if (reqPath === '/' || reqPath === '/landing') {
    reqPath = '/landing/index.html';
  } else if (reqPath === '/form' || reqPath === '/mock_internship_form.html') {
    reqPath = '/test/fixtures/mock_internship_form.html';
  } else if (reqPath === '/catalog' || reqPath === '/mock_product_catalog.html') {
    reqPath = '/test/fixtures/mock_product_catalog.html';
  } else if (reqPath === '/article' || reqPath === '/mock_article.html') {
    reqPath = '/test/fixtures/mock_article.html';
  }

  // Resolve file path safely
  const filePath = path.normalize(path.join(ROOT_DIR, reqPath));
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 Not Found: ${reqPath}`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`500 Server Error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log('🧭 Rahi Practice & Showcase Server is running!\n');
  console.log(`🌐 Landing Page:          http://localhost:${PORT}/landing`);
  console.log(`📝 Internship Mock Form:   http://localhost:${PORT}/form`);
  console.log(`🛍️ Product Mock Catalog:  http://localhost:${PORT}/catalog`);
  console.log(`📰 Article Mock Layout:    http://localhost:${PORT}/article`);
  console.log('\nPress Ctrl + C to stop server.');
});

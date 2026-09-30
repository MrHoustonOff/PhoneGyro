// Step 0 Mockup Capture Script for Task 6
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function startServer(port = 0) {
  const server = createServer((req, res) => {
    const rawPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath;
    if (rawPath === '/' || rawPath === '/stats-mockup.html') {
      filePath = path.join(HERE, 'stats-mockup.html');
    } else {
      filePath = path.join(FRONTEND, rawPath.replace(/^\/+/, ''));
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${rawPath}`);
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function main() {
  console.log('--- Step 0: Capturing Mockups for Task 6 ---');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.port}/stats-mockup.html`;
  console.log(`Server listening at: ${base}`);

  const b = await browser({ width: 1280, height: 720 });
  const p = await b.page();

  const scenarios = [
    { name: 'mockup_01_telemetry_3d.png', url: `${base}?tab=telemetry&theme=dark` },
    { name: 'mockup_02_minigame_aim.png', url: `${base}?tab=games&game=aim&theme=dark` },
    { name: 'mockup_03_minigame_platform.png', url: `${base}?tab=games&game=platform&theme=dark` },
    { name: 'mockup_04_response_bench.png', url: `${base}?tab=bench&theme=dark` },
    { name: 'mockup_05_telemetry_light.png', url: `${base}?tab=telemetry&theme=light` },
  ];

  for (const sc of scenarios) {
    console.log(`Rendering ${sc.name}...`);
    await p.goto(sc.url, 1200);
    const buf = await p.screenshot();
    const dest = path.join(OUT_DIR, sc.name);
    writeFileSync(dest, buf);
    console.log(`Saved: ${dest} (${buf.length} bytes)`);
  }

  await b.close();
  await server.close();
  console.log('--- Capture completed successfully! ---');
}

main().catch((err) => {
  console.error('Bench run failed:', err);
  process.exit(1);
});

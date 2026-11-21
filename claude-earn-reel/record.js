// Renders index.html frame-by-frame to a 1080x1920 MP4 (with reel-audio.wav if present).
// Usage: node record.js [out.mp4] [--page "পেজের নাম"] [--fps 30] [--stills --at 1,4,12]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] && !args[0].startsWith('--') ? args[0] : path.join(__dirname, 'smart-ay-reel-01.mp4');
const fps = +opt('fps', 30);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
const serve = () => new Promise(res => {
  const srv = http.createServer((req, rsp) => {
    const f = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(__dirname) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
    rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rsp);
  }).listen(0, '127.0.0.1', () => res(srv));
});

(async () => {
  const q = new URLSearchParams({ record: '1' });
  if (opt('page')) q.set('page', opt('page'));
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', e => console.error('[page]', e.message));
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html?${q}`);
  await page.evaluate(() => window.ready);
  const dur = await page.evaluate(() => window.DURATION);

  if (args.includes('--stills')) {
    for (const t of opt('at', '1,4,8,15,24,32,40,46,50,56').split(',').map(Number)) {
      await page.evaluate(t => render(t), t);
      await page.screenshot({ path: path.join(__dirname, `still-${t}.png`) });
    }
    await browser.close(); srv.close(); return;
  }

  const wav = path.join(__dirname, 'reel-audio.wav');
  const audio = fs.existsSync(wav) ? ['-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : [];
  const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', ...audio,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'ignore', 'inherit'] });
  const n = Math.round(dur * fps);
  for (let f = 0; f <= n; f++) {
    await page.evaluate(t => render(t), f / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) process.stderr.write(`frame ${f}/${n}\n`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close(); srv.close();
  console.log('wrote', out);
})();

// Local UI integration test. Speech-provider responses are synthetic; actual
// browser getUserMedia + AudioWorklet capture runs using Chromium's fake device.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { routeStaticRequest } from '../chat-cloudflare/src/static-router.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../chat-cloudflare/public/', import.meta.url));
let signedIn = true, available = true, refusal = false, audioBytes = 0, stream, seq = 0, saved = false, options;
const sessionId = '12345678-1234-1234-1234-123456789012';
const event = value => stream?.write(JSON.stringify({ ...value, seq: ++seq, at: Date.now() }) + '\n');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'); const p = url.pathname.replace(/^\/chat/, '');
    if (p.startsWith('/api/subtitles/')) {
      const route = p.slice('/api/subtitles/'.length);
      if (route.endsWith('/events')) { stream = res; res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); event({ type: 'ready' }); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
      let value = {}, status = 200;
      if (route === 'status') value = { signedIn, guestAccess: !signedIn, available, canRecord: true };
      else if (route === 'sessions') { options = JSON.parse(body); if (refusal) { value = { error: '实时翻译服务连接失败，请联系管理员核对模型权限。' }; status = 502; } else { seq = 0; value = { id: sessionId, sampleRate: 16000 }; } }
      else if (route.endsWith('/audio')) { assert.equal(req.headers['content-type'], 'application/octet-stream'); audioBytes += body.length; value = { accepted: Number(url.searchParams.get('seq')) };
        event({ type: 'caption', key: 'source:one', side: 'source', text: '本日はご参加いただき、ありがとうございます。', final: true });
        event({ type: 'caption', key: 'target:one', side: 'target', text: '感谢大家参加今天的报告。<img src=x onerror=alert(1)>', final: true }); }
      else if (route.endsWith('/finish')) { saved = true; event({ type: 'saved' }); event({ type: 'ended' }); stream?.end(); stream = null; }
      else if (route === 'recordings') value = { recordings: saved ? [{ id: sessionId, direction: 'ja-zh', createdAt: Date.now(), status: 'saved', duration: audioBytes / 32000, parts: [{ part: 0, bytes: audioBytes }] }] : [] };
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); return;
    }
    const response = await routeStaticRequest(new Request('http://localhost' + p), { ASSETS: { async fetch(request) {
      const name = new URL(request.url).pathname; const body = await readFile(path.join(root, name));
      const type = name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html'; return new Response(body, { headers: { 'Content-Type': type } });
    } } });
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const portable = process.env.CHROMIUM_MODULE ? (await import(pathToFileURL(process.env.CHROMIUM_MODULE).href)).default : null;
const browser = await chromium.launch({ headless: true,
  ...(portable ? { executablePath: process.env.CHROMIUM_EXECUTABLE || await portable.executablePath() } : {}),
  args: [...(portable?.args || []), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 1000 }, permissions: ['microphone'] });
const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  const url = `http://127.0.0.1:${server.address().port}/chat/subtitles`;
  await page.goto(url); await page.waitForFunction(() => !document.getElementById('start').disabled);
  assert.equal(await page.locator('#direction').inputValue(), 'ja-zh'); assert.equal(await page.locator('#save').isChecked(), true);
  await page.locator('#start').click(); await page.waitForFunction(() => document.getElementById('source').textContent.includes('本日'));
  assert.equal(options.direction, 'ja-zh'); assert.equal(options.saveRecording, true); assert.ok(audioBytes >= 16000);
  assert.equal(await page.locator('#target img').count(), 0); assert.equal(await page.locator('#direction').isDisabled(), true);
  if (process.env.SCREENSHOT_DIR) { await mkdir(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'subtitles-desktop.png'), fullPage: true }); }
  await page.locator('#stop').click(); await page.waitForFunction(() => !document.getElementById('start').disabled);
  await page.waitForSelector('.recording'); assert.equal(await page.locator('.recording audio').getAttribute('preload'), 'none');
  await page.locator('#direction').selectOption('zh-ja'); await page.locator('#save').uncheck(); await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('source-title').textContent === '中文原文'); assert.equal(options.direction, 'zh-ja'); assert.equal(options.saveRecording, false);
  await page.locator('#stop').click(); await page.waitForFunction(() => !document.getElementById('start').disabled);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'subtitles-mobile.png'), fullPage: true });
  refusal = true; await page.locator('#start').click(); await page.waitForFunction(() => document.getElementById('notice').textContent.includes('核对模型权限'));
  assert.equal(await page.locator('#start').isDisabled(), false);
  signedIn = false; refusal = false; await page.reload(); await page.waitForFunction(() => document.getElementById('status').textContent === '准备就绪'); assert.equal(await page.locator('#start').isDisabled(), false);
  assert.match(await page.locator('#recording-help').textContent(), /此浏览器/);
  await page.locator('#start').click(); await page.waitForFunction(() => document.getElementById('source').textContent.includes('本日'));
  await page.locator('#stop').click(); await page.waitForFunction(() => !document.getElementById('start').disabled);
  signedIn = true; available = false; await page.reload(); await page.waitForFunction(() => document.getElementById('status').textContent === '服务尚未启用');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, actualAudioWorkletBytes: audioBytes, widths: [1366, 390], cases: ['start/stop', 'two directions', 'recording links', 'safe captions', 'provider failure', 'guest', 'unconfigured'] }));
} finally { await browser.close(); stream?.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

// Local UI integration test. Speech-provider responses are synthetic; actual
// browser getUserMedia + AudioWorklet capture runs using Chromium's fake device.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { routeStaticRequest } from '../chat-cloudflare/src/static-router.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../chat-cloudflare/public/', import.meta.url));
let signedIn = true, available = true, refusal = false, audioBytes = 0, stream, seq = 0, saved = false, options;
let sessionId = randomUUID();
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
      else if (route === 'sessions') { options = JSON.parse(body); if (refusal) { value = { error: '实时翻译服务连接失败，请联系管理员核对模型权限。' }; status = 502; } else { seq = 0; sessionId = randomUUID(); value = { id: sessionId, sampleRate: 16000 }; } }
      else if (route.endsWith('/audio')) { assert.equal(req.headers['content-type'], 'application/octet-stream'); audioBytes += body.length; value = { accepted: Number(url.searchParams.get('seq')) };
        event({ type: 'caption', key: 'source:one', side: 'source', text: '本日はご参加いただき、ありがとうございます。', final: true });
        event({ type: 'caption', key: 'target:one', side: 'target', text: '感谢大家参加今天的报告。<img src=x onerror=alert(1)>', final: true }); }
      else if (route.endsWith('/finish')) { await new Promise(resolve => setTimeout(resolve, 150)); saved = true; event({ type: 'saved' }); event({ type: 'ended' }); stream?.end(); stream = null; }
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
  assert.equal(await page.locator('main > section').count(), 2);
  assert.equal(await page.locator('header,.intro').count(), 0);
  assert.equal(await page.locator('#stop').count(), 0);
  assert.equal(await page.locator('#direction').inputValue(), 'ja-zh'); assert.equal(await page.locator('#save').isChecked(), true);
  await page.locator('#start').click(); await page.waitForFunction(() => document.getElementById('source').textContent.includes('本日'));
  assert.equal(options.direction, 'ja-zh'); assert.equal(options.saveRecording, true); assert.ok(audioBytes >= 16000);
  assert.equal(await page.locator('#target img').count(), 0); assert.equal(await page.locator('#direction').isDisabled(), true);
  assert.equal(await page.locator('#start').textContent(), '暂停收音');
  assert.equal(await page.locator('#start').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#live-target img').count(), 0);
  assert.match(await page.locator('#live-source').textContent(), /本日/);
  event({ type: 'caption', key: 'target:two', side: 'target', text: '我们希望，', preview: '让机器人更贴近每个人的生活。', final: false });
  await page.waitForFunction(() => document.getElementById('live-target').textContent.includes('每个人'));
  event({ type: 'caption', key: 'source:three', side: 'source', text: '人とロボットが協力することで、新しい可能性が生まれます。', final: true });
  event({ type: 'caption', key: 'target:three', side: 'target', text: '人与机器人协作，将创造更多新的可能。', final: true });
  event({ type: 'caption', key: 'target:two', side: 'target', text: '我们希望，让机器人更贴近每个人的生活。', final: true });
  await page.waitForFunction(() => document.getElementById('live-target').textContent.includes('新的可能'));
  assert.match(await page.locator('#previous-target').textContent(), /更贴近每个人/);
  assert.equal(await page.locator('#caption-state').textContent(), '本句已完成');
  await page.locator('#text-size').click();
  assert.equal(await page.locator('#text-size').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#live-target').evaluate(node => getComputedStyle(node).fontSize), '40px');
  if (process.env.SCREENSHOT_DIR) { await mkdir(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'subtitles-desktop.png'), fullPage: true }); }
  await page.locator('#start').click(); assert.equal(await page.locator('#start').isDisabled(), true);
  await page.waitForFunction(() => document.getElementById('start').textContent === '继续收音');
  await page.locator('.recordings > summary').click();
  await page.waitForSelector('.recording'); assert.equal(await page.locator('.recording audio').getAttribute('preload'), 'none');
  const downloading = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloading;
  const downloadStream = await download.createReadStream(); const exported = []; for await (const part of downloadStream) exported.push(part);
  const exportedText = Buffer.concat(exported).toString('utf8');
  assert.match(exportedText, /本日はご参加/); assert.match(exportedText, /更贴近每个人/); assert.match(exportedText, /新的可能/);
  assert.match(await page.locator('#target').textContent(), /更贴近每个人/);
  await page.locator('#direction').selectOption('zh-ja'); await page.locator('#save').uncheck(); await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('start').textContent === '暂停收音');
  assert.equal(await page.locator('#source-title').textContent(), '中文原文'); assert.equal(options.direction, 'zh-ja'); assert.equal(options.saveRecording, false);
  await page.locator('#start').click(); await page.waitForFunction(() => document.getElementById('start').textContent === '继续收音');
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'subtitles-mobile.png'), fullPage: true });
  refusal = true; await page.locator('#start').click(); await page.waitForFunction(() => document.getElementById('notice').textContent.includes('核对模型权限'));
  assert.equal(await page.locator('#start').isDisabled(), false);
  signedIn = false; refusal = false; await page.reload(); await page.waitForFunction(() => document.getElementById('status').textContent === '准备就绪'); assert.equal(await page.locator('#start').isDisabled(), false);
  assert.equal(await page.locator('#text-size').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#recording-help').textContent(), /此浏览器/);
  await page.locator('#start').click(); await page.waitForFunction(() => document.getElementById('source').textContent.includes('本日'));
  await page.locator('#start').click(); await page.waitForFunction(() => document.getElementById('start').textContent === '继续收音');
  signedIn = true; available = false; await page.reload(); await page.waitForFunction(() => document.getElementById('status').textContent === '服务尚未启用');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, actualAudioWorkletBytes: audioBytes, widths: [320, 390, 768, 1366], cases: ['two panels', 'single start/pause button', 'stop drain lock', 'current and previous translation', 'late final revision', 'large text persistence', 'complete export', 'two directions', 'recording links', 'safe captions', 'provider failure', 'guest', 'unconfigured'] }));
} finally { await browser.close(); stream?.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

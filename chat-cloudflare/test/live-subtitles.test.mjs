import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSubtitleService, realtimeUrl, sessionConfig } from '../../aliyun/live-subtitles/service.mjs';
import { createRecordingStore, wav } from '../../aliyun/live-subtitles/recordings.mjs';
import { handleLiveSubtitles } from '../src/live-subtitles.mjs';
import { routeStaticRequest } from '../src/static-router.mjs';

class Socket extends EventEmitter {
  static sockets = [];
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.sent = []; Socket.sockets.push(this); queueMicrotask(() => this.emit('open')); }
  send(raw) { const e = JSON.parse(raw); this.sent.push(e); if (e.type === 'session.update') queueMicrotask(() => this.event({ type: 'session.updated' })); }
  event(e) { this.emit('message', JSON.stringify(e)); }
  close() { this.readyState = 3; this.emit('close'); }
}
const config = { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'test-only' };
const options = { direction: 'ja-zh', saveRecording: false };

test('provider endpoint is constrained and directions produce target-only subtitles', () => {
  assert.match(realtimeUrl(config.baseUrl), /^wss:\/\/dashscope.aliyuncs.com\/api-ws\/v1\/realtime\?model=/);
  for (const base of ['http://dashscope.aliyuncs.com', 'https://evil.example', 'https://u:p@dashscope.aliyuncs.com', 'https://dashscope.aliyuncs.com:8888']) assert.throws(() => realtimeUrl(base));
  assert.deepEqual(sessionConfig('zh-ja', 'qwen3.8-livetranslate-flash-realtime').session, { output_modalities: ['text'], translation: { language: 'ja' } });
  assert.throws(() => sessionConfig('en-zh', 'qwen3.8-livetranslate-flash-realtime'));
});

test('sessions isolate users, bound audio, retry safely and replay final captions', async t => {
  const svc = createSubtitleService({ WebSocket: Socket }); t.after(() => svc.close());
  const { id } = await svc.start('a', config, options), socket = Socket.sockets.at(-1);
  await assert.rejects(svc.start('a', config, options), { status: 409 });
  await assert.rejects(svc.audio('b', id, 1, Buffer.alloc(32000)), { status: 404 });
  await svc.audio('a', id, 1, Buffer.alloc(32000)); await svc.audio('a', id, 1, Buffer.alloc(32000));
  assert.equal(socket.sent.filter(e => e.type === 'input_audio_buffer.append').length, 1);
  await assert.rejects(svc.audio('a', id, 3, Buffer.alloc(32000)), { status: 409 });
  await assert.rejects(svc.audio('a', id, 2, Buffer.alloc(1)), { status: 413 });
  socket.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 's1', delta: 'こんにちは' });
  socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 's1', transcript: 'こんにちは。' });
  socket.event({ type: 'response.text.delta', item_id: 't1', delta: '你好' });
  socket.event({ type: 'response.text.done', item_id: 't1', text: '你好。' });
  svc.finish('a', id); socket.event({ type: 'session.finished' });
  const rows = (await svc.events('a', id, 0).text()).trim().split('\n').map(JSON.parse);
  assert.equal(rows.at(-1).type, 'ended'); assert.equal(rows.find(e => e.side === 'source' && e.final).text, 'こんにちは。');
  assert.equal(rows.find(e => e.side === 'target' && e.final).text, '你好。');
  assert.throws(() => svc.events('b', id, 0), { status: 404 });
  await assert.rejects(svc.audio('a', id, 2, Buffer.alloc(32000)), { status: 409 });
});

test('shutdown and reconnect wait for recording flush before final event', async () => {
  let resolveSave, didSave = false;
  const recordings = { start: async () => ({ caption() {}, append: async () => {}, finish: async () => { await new Promise(r => resolveSave = r); didSave = true; } }) };
  const svc = createSubtitleService({ WebSocket: Socket, recordings });
  const { id } = await svc.start('a', config, { ...options, saveRecording: true });
  Socket.sockets.at(-1).event({ type: 'session.finished' });
  const reading = svc.events('a', id, 0).text(); let closed = false;
  const closing = svc.close().then(() => closed = true); await Promise.resolve(); assert.equal(closed, false);
  resolveSave(); const rows = (await reading).trim().split('\n').map(JSON.parse); await closing;
  assert.equal(didSave, true); assert.deepEqual(rows.slice(-2).map(e => e.type), ['saved', 'ended']);
});

test('provider refusal is safe, bounded and allows a new attempt', async t => {
  class Refused extends Socket { send() { queueMicrotask(() => this.emit('error', new Error('secret diagnostic'))); } }
  const svc = createSubtitleService({ WebSocket: Refused }); t.after(() => svc.close());
  await assert.rejects(svc.start('a', config, options), e => e.status === 502 && !e.message.includes('secret'));
  await assert.rejects(svc.start('a', config, options), { status: 502 });
});

function memoryOSS() {
  const objects = new Map();
  return { objects,
    async put(k, body, opts) { objects.set(k, { body, opts }); return { res: { headers: { etag: 'test-etag', 'x-oss-version-id': 'v1' } } }; },
    async head(k) { const { body, opts } = objects.get(k); return { res: { headers: { 'content-length': String(body.length), 'x-oss-meta-sha256': opts.headers['x-oss-meta-sha256'] } } }; },
    async get(k) { return { content: objects.get(k).body }; },
  };
}
test('private WAV segments survive interruption; users cannot list/download others', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const oss = memoryOSS();
  const store = createRecordingStore({ db, oss, partBytes: 32000 });
  const recorder = await store.start({ id: 'one', owner: 'a', direction: 'ja-zh', createdAt: 1 });
  recorder.caption({ key: 'source:s1', side: 'source', text: '原文', final: true, at: 2 });
  await recorder.append(Buffer.alloc(32000)); await recorder.append(Buffer.alloc(16000)); await recorder.finish('server_shutdown');
  assert.equal(store.list('a')[0].duration, 1.5); assert.equal(store.list('a')[0].status, 'interrupted'); assert.equal(store.list('a')[0].parts.length, 2);
  assert.deepEqual(store.list('b'), []); await assert.rejects(store.download('b', 'one', '0'), { status: 404 });
  const response = await store.download('a', 'one', '0'); const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.length, 32044); assert.equal(body.toString('ascii', 0, 4), 'RIFF'); assert.equal(body.readUInt32LE(24), 16000);
  assert.equal([...oss.objects.values()][0].opts.headers['x-oss-object-acl'], 'private');
  assert.equal((await (await store.download('a', 'one', 'transcript')).json())[0].text, '原文');
  [...oss.objects.values()][0].body[44] = 1; await assert.rejects(store.download('a', 'one', '0'), { status: 502 });
});

test('OSS failure is visible without claiming a completed recording', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const oss = memoryOSS(); oss.put = async () => { throw new Error('offline'); };
  const store = createRecordingStore({ db, oss, partBytes: 32000 }); const recorder = await store.start({ id: 'one', owner: 'a', direction: 'ja-zh', createdAt: 1 });
  await assert.rejects(recorder.append(Buffer.alloc(32000))); await assert.rejects(recorder.finish('finished'));
  assert.equal(store.list('a')[0].status, 'save_failed'); assert.equal(store.list('a')[0].parts.length, 0);
  assert.equal(wav(Buffer.alloc(2)).readUInt32LE(40), 2);
});

test('routes require login and dedicated speech credentials, and enforce binary size/type', async () => {
  let owner = null, starts = 0; const env = { LIVE_SUBTITLES: { canRecord: true, start: async () => { starts++; return { id: 'test' }; } } };
  const deps = { currentVisitor: async () => owner && ({ email: owner }), json: (v, status = 200) => Response.json(v, { status }),
    limit: async () => {}, readJson: r => r.json(), readBytes: r => r.arrayBuffer() };
  const call = (path, init) => handleLiveSubtitles({ request: new Request('https://chat.omindos.cn/api/subtitles/' + path, init), env }, deps);
  assert.equal((await (await call('status')).json()).available, false);
  await assert.rejects(call('sessions', { method: 'POST', body: '{}' }), { status: 401 }); owner = 'a';
  await assert.rejects(call('sessions', { method: 'POST', body: '{}' }), { status: 503 });
  env.CHAT_SUBTITLES_API_KEY = 'fake'; env.CHAT_SUBTITLES_BASE_URL = config.baseUrl;
  assert.equal((await (await call('status')).json()).available, true);
  assert.equal((await call('sessions', { method: 'POST', body: JSON.stringify(options) })).status, 201); assert.equal(starts, 1);
  await assert.rejects(call('sessions/12345678-1234-1234-1234-123456789012/audio?seq=1', { method: 'POST', body: '{}' }), { status: 415 });
});

test('only subtitle HTML enables microphone; removed grading URLs return gone', async () => {
  const env = { ASSETS: { fetch: async () => new Response('ok') } };
  const get = p => routeStaticRequest(new Request('https://chat.omindos.cn' + p), env);
  for (const p of ['/subtitles', '/subtitles.html']) { const r = await get(p); assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/); assert.equal(r.headers.get('cache-control'), 'no-store'); }
  for (const p of ['/subtitles.js', '/?ta=1']) assert.match((await get(p)).headers.get('permissions-policy'), /microphone=\(\)/);
  for (const p of ['/grading', '/grading/', '/grading.html', '/grading.js', '/grading.css']) assert.equal((await get(p)).status, 410);
  assert.equal((await get('/subtitles/')).headers.get('location'), 'https://chat.omindos.cn/subtitles');
});

test('audio worklet resamples both common device rates to exact 16 kHz PCM', async () => {
  const code = await readFile(new URL('../public/subtitles-audio.js', import.meta.url), 'utf8');
  for (const rate of [44100, 48000]) {
    const messages = []; let Capture;
    vm.runInNewContext(code, { sampleRate: rate, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: e => messages.push(e) }; } }, registerProcessor: (_, c) => Capture = c });
    const capture = new Capture(); for (let i = 0; i < rate; i += 128) capture.process([[new Float32Array(Math.min(128, rate - i)).fill(0.5)]]);
    capture.port.onmessage({ data: 'flush' }); const pcm = Buffer.concat(messages.filter(e => e.pcm).map(e => Buffer.from(e.pcm)));
    assert.equal(pcm.length, 32000); assert.equal(pcm.readInt16LE(0), 16384); assert.equal(messages.at(-1).flushed, true);
  }
});

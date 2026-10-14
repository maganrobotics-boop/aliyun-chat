import { randomUUID } from 'node:crypto';
import { speechCredentialError, speechEndpointError, handshakeFailure } from './credentials.mjs';

export class SubtitleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (text, status) => { throw new SubtitleError(text, status); };
export function realtimeUrl(baseUrl, model = 'qwen3.8-livetranslate-flash-realtime') {
  const error = speechEndpointError(baseUrl, model);
  if (error) fail(error, 503);
  const url = new URL(baseUrl);
  url.protocol = 'wss:'; url.pathname = '/api-ws/v1/realtime'; url.search = ''; url.hash = '';
  url.searchParams.set('model', model); return url.href;
}
export function sessionConfig(direction, model) {
  if (!['ja-zh', 'zh-ja'].includes(direction)) fail('请选择日语→中文或中文→日语。');
  const [source, target] = direction.split('-');
  return { event_id: randomUUID(), type: 'session.update', session: model.startsWith('qwen3.8-')
    ? { output_modalities: ['text'], translation: { language: target } }
    : { modalities: ['text'], sample_rate: 16000, input_audio_format: 'pcm',
      input_audio_transcription: { model: 'qwen3-asr-flash-realtime', language: source },
      translation: { language: target } } };
}

// No audio or credentials enter logs. Audio is bounded in memory and optionally
// archived to private OSS in independently playable WAV parts by recordings.mjs.
export function createSubtitleService({ WebSocket, recordings = null, model = 'qwen3.8-livetranslate-flash-realtime',
  now = Date.now, maxSessions = 4, maxDurationMs = 60 * 60 * 1000, connectTimeoutMs = 15000 } = {}) {
  const sessions = new Map();
  const encoder = new TextEncoder();
  function configurationError(config) {
    const credentialError = speechCredentialError(config?.apiKey);
    if (credentialError) return credentialError;
    try { realtimeUrl(config?.baseUrl, config?.model || model); } catch (error) { return error.message; }
    return null;
  }
  function publish(s, event) {
    const item = { ...event, seq: ++s.eventSeq, at: now() };
    s.events.push(item); if (s.events.length > 500) s.events.shift();
    const bytes = encoder.encode(JSON.stringify(item) + '\n');
    for (const controller of s.listeners) {
      try { if ((controller.desiredSize ?? 0) < -100) { controller.error(new Error('SLOW_READER')); s.listeners.delete(controller); }
        else controller.enqueue(bytes); } catch { s.listeners.delete(controller); }
    }
    if (event.type === 'caption') s.recorder?.caption(item);
    return item;
  }
  function complete(s, reason = 'finished') {
    if (s.completing) return s.completing; s.ended = true; clearTimeout(s.connectTimer); clearTimeout(s.finishTimer);
    s.rejectReady?.(new SubtitleError('会话已结束。', 503)); s.rejectReady = null;
    s.socket?.close();
    s.completing = (async () => {
    try { if (s.recorder) { await s.recorder.finish(reason); publish(s, { type: 'saved', recordingId: s.id }); } }
    catch { publish(s, { type: 'warning', message: '录音保存未完成，请在“我的录音”查看已保存片段。' }); }
    publish(s, { type: 'ended', reason });
    s.completeDone = true;
    for (const c of s.listeners) { try { c.close(); } catch {} } s.listeners.clear();
    s.retainUntil = now() + 60000;
    })(); return s.completing;
  }
  function abort(s, message, status = 502) { if (s.ended) return; publish(s, { type: 'error', message }); s.rejectReady?.(new SubtitleError(message, status)); void complete(s, 'interrupted'); }
  function emitText(s, e) {
    const source = e.type.startsWith('conversation.item.input_audio_transcription.');
    const id = String(e.item_id || e.response_id || 'current').slice(0, 150);
    const key = `${source ? 'source' : 'target'}:${id}`;
    const previous = s.captions.get(key) || { text: '', final: false };
    let text;
    if (e.type.endsWith('.delta')) text = previous.text + String(e.delta || '');
    else text = String(e.transcript ?? e.text ?? '');
    const final = e.type.endsWith('.completed') || e.type.endsWith('.done');
    const value = { text: text.slice(0, 16000), final };
    s.captions.set(key, value);
    if (s.captions.size > 400) s.captions.delete(s.captions.keys().next().value);
    publish(s, { type: 'caption', key, side: source ? 'source' : 'target', ...value,
      preview: String(e.stash || '').slice(0, 4000), sourceId: source ? id : (s.links.get(id) || '') });
  }
  async function start(owner, config, options) {
    const configError = configurationError(config);
    if (configError) fail(configError, 503);
    const sessionModel = config.model || model;
    sessionConfig(options.direction, sessionModel);
    if (typeof options.saveRecording !== 'boolean') fail('请确认是否保存录音。');
    const live = [...sessions.values()].filter(s => !s.ended);
    if (live.some(s => s.owner === owner)) fail('你已有一场字幕会话，请先结束。', 409);
    if (live.length >= maxSessions) fail('实时字幕使用人数已满，请稍后重试。', 429);
    if (options.saveRecording && !recordings) fail('录音存储尚未连接，暂不能开始保存录音。', 503);
    const url = realtimeUrl(config.baseUrl, sessionModel);
    const s = { id: randomUUID(), owner, direction: options.direction, createdAt: now(), touchedAt: now(), bytes: 0,
      audioSeq: 0, eventSeq: 0, events: [], captions: new Map(), links: new Map(), listeners: new Set(), ended: false, finishing: false };
    sessions.set(s.id, s);
    try {
      if (options.saveRecording) s.recorder = await recordings.start({ id: s.id, owner, direction: s.direction, createdAt: s.createdAt });
      await new Promise((resolve, reject) => {
        s.rejectReady = reject;
        s.connectTimer = setTimeout(() => abort(s, '实时翻译连接超时，请稍后重试。'), connectTimeoutMs);
        const socket = s.socket = new WebSocket(url, { headers: { Authorization: `Bearer ${config.apiKey}` }, maxPayload: 256 * 1024, followRedirects: false, handshakeTimeout: connectTimeoutMs });
        socket.on('open', () => socket.send(JSON.stringify(sessionConfig(s.direction, sessionModel))));
        socket.on('unexpected-response', (request, response) => {
          const error = handshakeFailure(response.statusCode);
          // No response body, headers or provider error text enters logs/UI.
          abort(s, error.message, error.status);
          response.destroy(); request.destroy();
        });
        socket.on('error', () => abort(s, '实时翻译服务连接失败，请联系管理员核对模型权限。'));
        socket.on('close', () => { if (!s.ended) abort(s, '翻译连接已中断，已显示的字幕保留，请重新开始。'); });
        socket.on('message', raw => {
          if (s.ended) return;
          let e; try { e = JSON.parse(String(raw)); } catch { return abort(s, '实时翻译返回格式异常。'); }
          if (e.type === 'session.updated') { clearTimeout(s.connectTimer); s.ready = true; s.rejectReady = null; publish(s, { type: 'ready' }); resolve(); }
          else if (e.type === 'error') abort(s, '实时翻译服务拒绝请求，请核对模型开通状态或额度。');
          else if (e.type === 'conversation.item.created' && e.item?.role === 'assistant') {
            s.links.set(e.item.id, e.previous_item_id || ''); if (s.links.size > 400) s.links.delete(s.links.keys().next().value);
          }
          else if (/^(conversation\.item\.input_audio_transcription\.(delta|text|completed)|response\.text\.(delta|text|done))$/.test(e.type)) emitText(s, e);
          else if (e.type === 'conversation.item.input_audio_transcription.failed' || (e.type === 'response.done' && ['failed', 'incomplete'].includes(e.response?.status))) publish(s, { type: 'warning', message: '有一段语音未能完整翻译，请核对原文。' });
          else if (e.type === 'session.finished') void complete(s);
        });
      });
      return { id: s.id, sampleRate: 16000, maxDurationSeconds: maxDurationMs / 1000, saving: Boolean(s.recorder) };
    } catch (error) { await complete(s, 'failed'); throw error; }
  }
  function owned(owner, id) { const s = sessions.get(id); if (!s || s.owner !== owner) fail('会话不存在或已过期。', 404); return s; }
  async function audio(owner, id, sequence, bytes) {
    const s = owned(owner, id);
    if (!s.ready || s.ended || s.finishing) fail('会话已结束，请重新开始。', 409);
    if (!Number.isSafeInteger(sequence) || sequence < 1) fail('音频序号不正确。');
    if (sequence <= s.audioSeq) return { accepted: s.audioSeq }; // safe retry after lost HTTP acknowledgement
    if (sequence !== s.audioSeq + 1) fail('音频顺序中断，请重新开始。', 409);
    if (!bytes.length || bytes.length > 64000 || bytes.length % 2) fail('音频分片格式不正确。', 413);
    if (now() - s.createdAt >= maxDurationMs || s.bytes + bytes.length > 32000 * maxDurationMs / 1000) fail('本次字幕已达一小时，请结束后重新开始。', 429);
    if (s.bytes + bytes.length > 32000 * ((now() - s.createdAt) / 1000 + 6)) fail('音频发送过快。', 429);
    if (s.busy || s.socket.bufferedAmount > 256000) fail('音频正在处理，请重试。', 429);
    s.busy = true;
    try {
      s.socket.send(JSON.stringify({ event_id: randomUUID(), type: 'input_audio_buffer.append', audio: Buffer.from(bytes).toString('base64') }));
      s.audioSeq = sequence; s.bytes += bytes.length; s.touchedAt = now();
      if (s.recorder) { try { await s.recorder.append(bytes); } catch { abort(s, '录音保存失败，已停止收音，避免继续丢失录音。'); fail('录音保存失败，已停止收音。', 502); } }
      return { accepted: sequence };
    } finally { s.busy = false; }
  }
  function events(owner, id, after, signal) {
    const s = owned(owner, id);
    if (!Number.isSafeInteger(after) || after < 0 || after > s.eventSeq) fail('字幕续传序号不正确。');
    if (s.events[0]?.seq > after + 1) fail('断线时间过长，请重新开始。', 409);
    if (s.listeners.size >= 2) fail('字幕连接过多。', 429);
    let controller, heartbeat;
    const detach = () => { clearInterval(heartbeat); if (controller) s.listeners.delete(controller); signal?.removeEventListener('abort', cancel); };
    const cancel = () => { detach(); try { controller?.close(); } catch {} };
    const stream = new ReadableStream({
      start(c) { controller = c; for (const e of s.events) if (e.seq > after) c.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
        if (s.completeDone) { c.close(); return; } s.listeners.add(c); signal?.addEventListener('abort', cancel, { once: true });
        heartbeat = setInterval(() => { try { c.enqueue(encoder.encode('{"type":"heartbeat"}\n')); } catch { detach(); } }, 5000); heartbeat.unref?.();
        if (signal?.aborted) cancel(); }, cancel: detach,
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  }
  function finish(owner, id) {
    const s = owned(owner, id); if (s.ended || s.finishing) return { finishing: true };
    s.finishing = true;
    if (s.socket?.readyState === 1) s.socket.send(JSON.stringify({ event_id: randomUUID(), type: 'session.finish' }));
    s.finishTimer = setTimeout(() => { publish(s, { type: 'warning', message: '最后一段翻译等待超时，请核对字幕末尾。' }); void complete(s, 'timeout'); }, 20000); s.finishTimer.unref?.();
    return { finishing: true };
  }
  const sweep = setInterval(() => {
    for (const s of sessions.values()) {
      if (s.ended && s.retainUntil < now()) sessions.delete(s.id);
      else if (!s.ended && s.ready && !s.finishing && (now() - s.touchedAt > 20000 || now() - s.createdAt > maxDurationMs)) finish(s.owner, s.id);
    }
  }, 5000); sweep.unref?.();
  return { start, audio, events, finish, configurationError, canRecord: Boolean(recordings),
    list: owner => recordings?.list(owner) || [],
    download: (owner, id, part) => recordings ? recordings.download(owner, id, part) : fail('录音存储尚未连接。', 503),
    async close() { clearInterval(sweep); await Promise.all([...sessions.values()].map(s => complete(s, 'server_shutdown'))); sessions.clear(); } };
}

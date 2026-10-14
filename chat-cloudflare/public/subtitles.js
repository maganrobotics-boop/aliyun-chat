const $ = id => document.getElementById(id);
// Relative URL construction keeps /chat on the public gateway and / on origin.
const base = new URL('.', location.href);
const api = path => new URL('api/subtitles/' + path, base).href;
const ui = Object.fromEntries(['start','stop','direction','save','export','status','notice','level','duration','source','target','recordings'].map(k => [k, $(k)]));
let available = false, canRecord = false, active = null, starting = false, transcript = new Map(), lines = new Map(), wakeLock;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function note(message, error = false) { ui.notice.textContent = message; ui.notice.classList.toggle('error', error); }
function controls() { ui.start.disabled = starting || Boolean(active) || !available; ui.stop.disabled = !active || active.stopping;
  ui.direction.disabled = starting || Boolean(active); ui.save.disabled = starting || Boolean(active) || !canRecord; ui.export.disabled = !transcript.size; }
async function request(path, options = {}) {
  const response = await fetch(api(path), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000), ...options });
  if (!response.ok) { const value = await response.json().catch(() => ({})); const e = new Error(value.error || '网络请求失败，请重试。'); e.status = response.status; throw e; }
  return response;
}
async function json(path, body) { return (await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); }
function caption(s, e) {
  const key = s.id + ':' + e.key;
  const container = ui[e.side];
  if (!container || !['source', 'target'].includes(e.side)) return;
  const follow = container.scrollHeight - container.clientHeight - container.scrollTop < 80;
  transcript.set(key, { ...e, direction: s.direction });
  let element = lines.get(key);
  if (!element) { container.querySelector('.empty')?.remove(); element = document.createElement('p'); container.append(element); lines.set(key, element); }
  element.textContent = e.text + (e.preview || ''); element.className = e.final ? 'final' : 'partial';
  // Keep the live DOM bounded while retaining the full export for this page.
  if (lines.size > 300) { const first = lines.keys().next().value; lines.get(first).remove(); lines.delete(first); }
  if (follow) container.scrollTop = container.scrollHeight;
  controls();
}
function addDivider(direction) {
  const ja = direction === 'ja-zh'; $('source-title').textContent = ja ? '日语原文' : '中文原文'; $('target-title').textContent = ja ? '中文字幕' : '日语字幕';
  for (const side of ['source','target']) { const e = document.createElement('p'); e.className = 'direction-break'; e.textContent = `${new Date().toLocaleTimeString('zh-CN')} · ${ja ? '日语 → 中文' : '中文 → 日语'}`; ui[side].append(e); }
}
async function releaseCapture(s, flush = true) {
  if (s.worklet && flush) await new Promise(resolve => { s.flushed = resolve; s.worklet.port.postMessage('flush'); setTimeout(resolve, 600); });
  s.stream?.getTracks().forEach(t => t.stop()); s.worklet?.disconnect(); s.source?.disconnect();
  if (s.audioContext?.state !== 'closed') await s.audioContext?.close().catch(() => {});
  await wakeLock?.release().catch(() => {}); wakeLock = null; ui.level.value = 0;
}
function reset(s, message) { if (active !== s) return; clearInterval(s.clock); active = null; controls(); ui.status.textContent = message; void refreshRecordings(); }
async function pump(s) {
  if (s.pumping) return s.pumping;
  s.pumping = (async () => {
    while (s.queue.length && !s.failed) {
      const bytes = s.queue[0], seq = s.sequence + 1;
      for (let attempt = 0; ; attempt++) {
        try { await request(`sessions/${s.id}/audio?seq=${seq}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }); break; }
        catch (e) { if (attempt >= 2 || (e.status && e.status !== 429 && e.status < 500)) throw e; ui.status.textContent = '网络波动，正在重试…'; await sleep(400 * (attempt + 1)); }
      }
      s.sequence = seq; s.queue.shift(); if (!s.stopping) ui.status.textContent = '正在收音 · 字幕实时更新';
    }
  })().catch(e => { s.failed = true; note(e.message + ' 已停止收音。', true); void stop(s, true); }).finally(() => { s.pumping = null; });
  return s.pumping;
}
async function streamEvents(s) {
  for (let attempt = 0; attempt < 4 && active === s; attempt++) {
    let reader;
    try {
      const response = await request(`sessions/${s.id}/events?after=${s.after}`, { signal: s.eventsAbort.signal });
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (active === s) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 256000) throw new Error('字幕返回过长。');
        let split;
        while ((split = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, split); buffer = buffer.slice(split + 1); if (!raw) continue;
          const e = JSON.parse(raw); if (e.seq && e.seq <= s.after) continue; if (e.seq) s.after = e.seq;
          if (e.type === 'caption') caption(s, e);
          else if (e.type === 'warning') note(e.message, true);
          else if (e.type === 'saved') { s.saved = true; note('录音已保存到阿里云，可在下方回听和下载。'); }
          else if (e.type === 'error') { s.failed = true; note(e.message, true); void releaseCapture(s, false); }
          else if (e.type === 'ended') { await releaseCapture(s, false); reset(s, s.failed ? '连接中断，可重新开始' : '已暂停，可重新开始'); return; }
        }
      }
      if (active !== s) return;
      throw new Error('字幕连接中断。');
    } catch (e) {
      if (active !== s || s.eventsAbort.signal.aborted) return;
      if (e.status === 401 || e.status === 404 || e.status === 409 || attempt === 3) { note(e.message, true); await stop(s, true); return; }
      ui.status.textContent = '字幕连接恢复中…'; await sleep(500 * (attempt + 1));
    } finally { await reader?.cancel().catch(() => {}); }
  }
}
async function stop(s = active, forced = false) {
  if (!s || s.stopping) return; s.stopping = true; controls(); ui.status.textContent = '正在结束并保存…';
  await releaseCapture(s, !forced);
  if (!forced) await pump(s); else { s.failed = true; s.queue = []; }
  try { await json(`sessions/${s.id}/finish`, {}); } catch (e) { note(e.message, true); }
  // Server drains final translation/recording before emitting ended.
  setTimeout(() => { if (active === s) { s.eventsAbort.abort(); reset(s, '已停止'); if (s.saving && !s.saved) note('保存状态尚未确认，请刷新“我的录音”核对。', true); } }, 25000);
}
async function start() {
  if (starting || active || !available) return; starting = true; controls(); ui.status.textContent = '正在连接麦克风…';
  const s = { id: null, queue: [], sequence: 0, after: 0, direction: ui.direction.value, saving: ui.save.checked, eventsAbort: new AbortController() };
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('此浏览器不支持实时收音，请使用新版 Chrome、Edge 或 Safari。');
    s.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    s.audioContext = new AudioContext(); await s.audioContext.resume();
    await s.audioContext.audioWorklet.addModule(new URL('subtitles-audio.js', base));
    const created = await json('sessions', { direction: s.direction, saveRecording: s.saving }); s.id = created.id;
    active = s; s.startedAt = Date.now(); addDivider(s.direction);
    s.worklet = new AudioWorkletNode(s.audioContext, 'subtitle-capture'); s.source = s.audioContext.createMediaStreamSource(s.stream);
    s.worklet.port.onmessage = e => {
      if (e.data.flushed) { s.flushed?.(); return; }
      if (s.failed || active !== s) return;
      ui.level.value = Math.min(1, e.data.peak * 3); s.queue.push(e.data.pcm);
      if (s.queue.length > 16) { note('网络发送过慢，已停止收音。已保存的录音片段保留。', true); void stop(s, true); return; }
      void pump(s);
    };
    s.worklet.connect(s.audioContext.destination); s.source.connect(s.worklet);
    s.stream.getAudioTracks()[0].addEventListener('ended', () => { if (active === s && !s.stopping) { note('麦克风已断开。', true); void stop(s); } });
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen').catch(() => null);
    s.clock = setInterval(() => { const seconds = Math.floor((Date.now() - s.startedAt) / 1000); ui.duration.textContent = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`; }, 1000);
    ui.status.textContent = '正在收音 · 字幕实时更新'; note(s.saving ? '录音正在分段保存到阿里云。请保持页面在前台，结束后确认保存状态。' : '本次不保存录音，字幕可在结束后导出。');
    void streamEvents(s);
  } catch (e) {
    await releaseCapture(s, false); if (s.id) await json(`sessions/${s.id}/finish`, {}).catch(() => {});
    active = null; ui.status.textContent = '未开始收音'; note(e.name === 'NotAllowedError' ? '麦克风权限未允许，请在浏览器设置中允许后重试。' : e.message, true);
  } finally { starting = false; controls(); }
}
async function refreshRecordings() {
  try {
    const { recordings } = await (await request('recordings')).json(); ui.recordings.replaceChildren();
    if (!recordings.length) { ui.recordings.textContent = '暂无保存的录音。'; return; }
    const statuses = { recording: '录音中', saved: '已保存', interrupted: '中断，已保存片段保留', save_failed: '保存未完成' };
    for (const r of recordings) {
      const detail = document.createElement('details'); detail.className = 'recording'; const summary = document.createElement('summary');
      summary.textContent = `${new Date(r.createdAt).toLocaleString('zh-CN')} · ${r.direction === 'ja-zh' ? '日→中' : '中→日'} · ${Math.round(r.duration)} 秒 · ${statuses[r.status] || r.status}`;
      detail.append(summary); const parts = document.createElement('div'); parts.className = 'parts';
      const subtitleLink = document.createElement('a'); subtitleLink.href = api(`recordings/${r.id}/transcript`); subtitleLink.textContent = '下载这场字幕'; subtitleLink.download = ''; parts.append(subtitleLink);
      for (const part of r.parts) { const line = document.createElement('div'); line.className = 'part'; const label = document.createElement('span'); label.textContent = `第 ${part.part + 1} 段`; label.className = 'segment-label';
        const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = api(`recordings/${r.id}/${part.part}`);
        const link = document.createElement('a'); link.href = audio.src; link.download = `recording-${r.id}-${part.part}.wav`; link.textContent = '下载录音'; line.append(label, audio, link); parts.append(line); }
      detail.append(parts); ui.recordings.append(detail);
    }
  } catch (e) { ui.recordings.textContent = e.message; }
}
ui.start.addEventListener('click', start); ui.stop.addEventListener('click', () => void stop()); $('refresh').addEventListener('click', refreshRecordings);
ui.export.addEventListener('click', () => {
  const content = [...transcript.values()].map(e => `${new Date(e.at).toLocaleTimeString('zh-CN')} ${e.side === 'source' ? '原文' : '译文'}${e.final ? '' : '（未定稿）'}\n${e.text}`).join('\n\n');
  const url = URL.createObjectURL(new Blob(['中日实时字幕\n\n' + content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `字幕-${new Date().toISOString().slice(0,10)}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && active) { note('页面进入后台，已暂停收音。返回后可重新开始。'); void stop(); } });
window.addEventListener('pagehide', () => { if (active) { const s = active; s.stream?.getTracks().forEach(t => t.stop()); void fetch(api(`sessions/${s.id}/finish`), { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } });
try {
  const status = await (await request('status')).json(); available = status.available; canRecord = status.canRecord;
  if (!status.signedIn) { ui.status.textContent = '请先登录'; note('请返回 AI 助教登录，然后打开“我的 → 实时字幕”。'); }
  else if (!available) { ui.status.textContent = '服务尚未启用'; note('实时翻译接口正在准备，请稍后再试。'); }
  else { ui.status.textContent = '准备就绪'; if (!status.canRecord) { ui.save.checked = false; note('录音存储尚未连接，本次可仅使用字幕。'); } }
  if (status.signedIn) void refreshRecordings();
} catch (e) { ui.status.textContent = '连接失败'; note(e.message, true); }
controls();

import { createHash } from 'node:crypto';
import { SubtitleError } from './service.mjs';

export function wav(pcm) {
  const head = Buffer.alloc(44); head.write('RIFF'); head.writeUInt32LE(pcm.length + 36, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(16000, 24);
  head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

export function createRecordingStore({ db, oss, prefix = 'chat-recordings/v1', partBytes = 960000 }) {
  if (!/^chat-recordings\/[a-z0-9/-]+$/.test(prefix)) throw new Error('INVALID_RECORDING_PREFIX');
  db.exec(`CREATE TABLE IF NOT EXISTS subtitle_recordings(id TEXT PRIMARY KEY,owner TEXT NOT NULL,direction TEXT NOT NULL,
    created_at INTEGER NOT NULL,status TEXT NOT NULL,duration REAL NOT NULL DEFAULT 0,captions TEXT NOT NULL DEFAULT '[]');
    CREATE INDEX IF NOT EXISTS subtitle_recording_owner ON subtitle_recordings(owner,created_at);
    CREATE TABLE IF NOT EXISTS subtitle_recording_parts(recording_id TEXT NOT NULL,part INTEGER NOT NULL,object_key TEXT NOT NULL,
    bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,etag TEXT NOT NULL,version TEXT NOT NULL DEFAULT '',PRIMARY KEY(recording_id,part));`);
  db.prepare("UPDATE subtitle_recordings SET status='interrupted' WHERE status='recording'").run();
  async function start({ id, owner, direction, createdAt }) {
    db.prepare('INSERT INTO subtitle_recordings(id,owner,direction,created_at,status) VALUES(?,?,?,?,?)').run(id, owner, direction, createdAt, 'recording');
    let buffers = [], size = 0, part = 0, total = 0, ended = false, pending = Promise.resolve();
    const captions = new Map();
    function checkpoint(status = 'recording') { db.prepare('UPDATE subtitle_recordings SET status=?,duration=?,captions=? WHERE id=?').run(status, total / 32000, JSON.stringify([...captions.values()]), id); }
    async function flush() {
      if (!size) return;
      const pcm = Buffer.concat(buffers, size), body = wav(pcm);
      const key = `${prefix}/${id}/${String(part).padStart(4, '0')}.wav`;
      const sha = createHash('sha256').update(body).digest('hex');
      const result = await oss.put(key, body, { headers: { 'Content-Type': 'audio/wav', 'x-oss-object-acl': 'private',
        'Content-MD5': createHash('md5').update(body).digest('base64'), 'x-oss-meta-sha256': sha } });
      const check = await oss.head(key);
      if (Number(check.res?.headers?.['content-length']) !== body.length || check.res?.headers?.['x-oss-meta-sha256'] !== sha) throw new Error('RECORDING_INTEGRITY_FAILED');
      db.prepare('INSERT INTO subtitle_recording_parts(recording_id,part,object_key,bytes,sha256,etag,version) VALUES(?,?,?,?,?,?,?)')
        .run(id, part++, key, body.length, sha, String(result.res?.headers?.etag || ''), String(result.res?.headers?.['x-oss-version-id'] || ''));
      buffers = []; size = 0; total += pcm.length; checkpoint();
    }
    return {
      caption(e) { captions.set(e.key, { side: e.side, key: e.key, text: e.text, final: e.final, at: e.at }); },
      append(bytes) { if (ended) throw new Error('RECORDING_ENDED');
        pending = pending.then(async () => { buffers.push(Buffer.from(bytes)); size += bytes.length; if (size >= partBytes) await flush(); }); return pending; },
      async finish(reason) {
        if (ended) return; ended = true;
        try { await pending; await flush(); checkpoint(reason === 'finished' ? 'saved' : 'interrupted'); }
        catch { checkpoint('save_failed'); throw new Error('RECORDING_SAVE_FAILED'); }
      },
    };
  }
  function list(owner) {
    return db.prepare('SELECT id,direction,created_at AS createdAt,status,duration FROM subtitle_recordings WHERE owner=? ORDER BY created_at DESC LIMIT 50').all(owner)
      .map(row => ({ ...row, parts: db.prepare('SELECT part,bytes FROM subtitle_recording_parts WHERE recording_id=? ORDER BY part').all(row.id) }));
  }
  async function download(owner, id, part) {
    const row = db.prepare('SELECT id,captions FROM subtitle_recordings WHERE owner=? AND id=?').get(owner, id);
    if (!row) throw new SubtitleError('录音不存在。', 404);
    if (part === 'transcript') return new Response(row.captions, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="subtitles-${id}.json"`, 'Cache-Control': 'no-store' } });
    if (!/^\d{1,4}$/.test(part)) throw new SubtitleError('录音片段不正确。', 400);
    const entry = db.prepare('SELECT object_key,sha256 FROM subtitle_recording_parts WHERE recording_id=? AND part=?').get(id, Number(part));
    if (!entry) throw new SubtitleError('录音片段不存在或尚未保存。', 404);
    const result = await oss.get(entry.object_key), bytes = Buffer.from(result.content);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new SubtitleError('录音完整性校验失败。', 502);
    return new Response(bytes, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(bytes.length), 'Content-Disposition': `inline; filename="recording-${id}-${part}.wav"`, 'Cache-Control': 'no-store' } });
  }
  return { start, list, download };
}

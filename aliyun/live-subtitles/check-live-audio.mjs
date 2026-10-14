// Explicit real-provider acceptance. Uses public speech fixtures, never microphone audio.
// Required: --run-real /absolute/fixture-directory (ja.pcm and zh.pcm, mono s16le 16 kHz).
// CHAT_SOURCE_ROOT points to the deployed Chat source; credentials stay in memory.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import OSS from 'ali-oss';
import { createSubtitleService, SubtitleError } from './service.mjs';
import { createRecordingStore } from './recordings.mjs';

assert.equal(process.argv[2], '--run-real', 'Real-provider check requires --run-real');
assert.ok(process.argv[3]?.startsWith('/'), 'Use an absolute fixture directory');
assert.ok(process.env.CHAT_SOURCE_ROOT?.startsWith('/'), 'CHAT_SOURCE_ROOT is required');
const fixtures = resolve(process.argv[3]);
const source = resolve(process.env.CHAT_SOURCE_ROOT);
const report = { checkedAt: new Date().toISOString(), fixtureKind: 'public-provider-voice-samples', results: [], passed: false };
const db = new DatabaseSync(':memory:');
const keys = new Set();
let service, oss;
try {
  const chatEnv = parseEnv(await readFile('/etc/originmind-chat/env', 'utf8'));
  const { decryptSecret } = await import(pathToFileURL(resolve(source, 'chat-cloudflare/src/crypto.mjs')).href);
  const chatDb = new DatabaseSync(chatEnv.CHAT_SQLITE_PATH || '/var/lib/originmind-chat/chat.sqlite', { readOnly: true });
  let saved;
  try { saved = JSON.parse(chatDb.prepare('SELECT value FROM settings WHERE id=?').get('subtitles-provider').value); }
  finally { chatDb.close(); }
  const config = { baseUrl: saved.baseUrl, model: saved.model, apiKey: await decryptSecret(saved.encryptedKey, chatEnv.APP_ENCRYPTION_KEY) };
  const storage = parseEnv(await readFile('/etc/originmind-oa/env', 'utf8'));
  oss = new OSS({ bucket: storage.OA_OSS_BUCKET, region: storage.OA_OSS_REGION, endpoint: storage.OA_OSS_ENDPOINT,
    accessKeyId: storage.OSS_ACCESS_KEY_ID, accessKeySecret: storage.OSS_ACCESS_KEY_SECRET,
    stsToken: storage.OSS_STS_TOKEN || undefined, authorizationV4: true, secure: true, timeout: 15000 });
  const originalPut = oss.put.bind(oss);
  oss.put = (key, ...args) => { keys.add(key); return originalPut(key, ...args); };
  const prefix = 'chat-recordings/verification-' + randomUUID();
  const recordings = createRecordingStore({ db, oss, prefix, partBytes: 160000 });
  service = createSubtitleService({ WebSocket, recordings, model: config.model });
  for (const direction of ['ja-zh', 'zh-ja']) {
    const pcm = await readFile(resolve(fixtures, direction.slice(0, 2) + '.pcm'));
    assert.ok(pcm.length > 160000 && pcm.length <= 960000 && pcm.length % 2 === 0, 'Use 5–30 second PCM fixtures');
    const owner = 'synthetic-audio-acceptance';
    const startedAt = Date.now();
    const session = await service.start(owner, config, { direction, saveRecording: true });
    const stream = service.events(owner, session.id, 0).text();
    let sequence = 0;
    for (let offset = 0; offset < pcm.length; offset += 3200) {
      await service.audio(owner, session.id, ++sequence, pcm.subarray(offset, offset + 3200));
      await new Promise(done => setTimeout(done, 100));
    }
    const stoppedAt = Date.now();
    service.finish(owner, session.id);
    const events = (await stream).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(events.at(-1)?.reason, 'finished', 'Session did not finish normally');
    assert.equal(events.filter(e => ['error', 'warning'].includes(e.type)).length, 0, 'Provider or recording warning');
    const final = new Map();
    for (const event of events) if (event.type === 'caption') final.set(event.key, event);
    const sourceText = [...final.values()].filter(e => e.side === 'source').map(e => e.text).join('');
    const targetText = [...final.values()].filter(e => e.side === 'target').map(e => e.text).join('');
    assert.ok(sourceText.length > 4 && targetText.length > 4, 'Missing source or translated captions');
    assert.ok(/[\u3040-\u30ff]/u.test(direction === 'ja-zh' ? sourceText : targetText), 'Missing Japanese text');
    const savedRecording = recordings.list(owner).find(row => row.id === session.id);
    assert.equal(savedRecording.status, 'saved');
    assert.ok(savedRecording.parts.length >= 2, 'Expected a full part and a stop-time tail');
    const buffers = [];
    for (const part of savedRecording.parts) {
      const bytes = Buffer.from(await (await recordings.download(owner, session.id, String(part.part))).arrayBuffer());
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.readUInt32LE(24), 16000);
      assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
      buffers.push(bytes.subarray(44));
    }
    assert.ok(Buffer.concat(buffers).equals(pcm), 'Saved PCM differs from sent audio');
    let crossAccountDenied = false;
    try { await recordings.download('different-account', session.id, '0'); }
    catch (error) { crossAccountDenied = error.status === 404; }
    assert.ok(crossAccountDenied);
    const rows = db.prepare('SELECT object_key FROM subtitle_recording_parts WHERE recording_id=? ORDER BY part').all(session.id);
    for (const row of rows) assert.equal((await oss.getACL(row.object_key)).acl, 'private');
    const transcript = await (await recordings.download(owner, session.id, 'transcript')).json();
    assert.equal(transcript.length, final.size);
    const result = { direction, sourceText, targetText, seconds: pcm.length / 32000,
      pcmSha256: createHash('sha256').update(pcm).digest('hex'),
      firstCaptionMs: events.find(e => e.type === 'caption' && e.side === 'target')?.at - startedAt,
      finishAndSaveMs: Date.now() - stoppedAt, partCount: savedRecording.parts.length,
      allCaptionsFinal: [...final.values()].every(e => e.final),
      completeAudioIncludingTail: true, crossAccountDenied, acl: 'private' };
    report.results.push(result);
    console.log(JSON.stringify({ direction, passed: true, seconds: result.seconds, partCount: result.partCount }));
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof SubtitleError ? error.message : 'Audio acceptance failed; inspect isolated fixture and result checks.';
  process.exitCode = 1;
} finally {
  await service?.close();
  let removed = 0;
  for (const key of keys) { try { await oss.delete(key); removed++; } catch { process.exitCode = 1; } }
  report.testObjectsRemoved = removed === keys.size;
  report.passed &&= report.testObjectsRemoved;
  db.close();
  await writeFile(resolve(fixtures, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
}

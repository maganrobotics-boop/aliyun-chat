import WebSocket from 'ws';
import OSS from 'ali-oss';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createSubtitleService } from './service.mjs';
import { createRecordingStore } from './recordings.mjs';

export async function liveSubtitleRuntime(env) {
  let recordings = null, db;
  if (env.CHAT_SUBTITLES_STORAGE_ENV) {
    // This dedicated 0600 file contains only the approved OSS credential subset.
    const cfg = parseEnv(await readFile(env.CHAT_SUBTITLES_STORAGE_ENV, 'utf8'));
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(cfg.OA_OSS_BUCKET || '') ||
      !/^oss-[a-z0-9-]+$/.test(cfg.OA_OSS_REGION || '') ||
      !/^oss-[a-z0-9-]+(?:-internal)?\.aliyuncs\.com$/.test(cfg.OA_OSS_ENDPOINT || '')) throw new Error('SUBTITLE_STORAGE_CONFIG_INVALID');
    const filename = env.CHAT_SUBTITLES_DB || '/var/lib/originmind-chat/subtitles.sqlite';
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 }); db = new DatabaseSync(filename); await chmod(filename, 0o600);
    recordings = createRecordingStore({ db, oss: new OSS({ region: cfg.OA_OSS_REGION, bucket: cfg.OA_OSS_BUCKET, endpoint: cfg.OA_OSS_ENDPOINT,
      accessKeyId: cfg.OSS_ACCESS_KEY_ID, accessKeySecret: cfg.OSS_ACCESS_KEY_SECRET, stsToken: cfg.OSS_STS_TOKEN || undefined,
      authorizationV4: true, secure: true, timeout: 15000 }) });
  }
  const service = createSubtitleService({ WebSocket, recordings, model: env.CHAT_SUBTITLES_MODEL || 'qwen3.8-livetranslate-flash-realtime' });
  const close = service.close; service.close = async () => { await close(); db?.close(); }; return service;
}

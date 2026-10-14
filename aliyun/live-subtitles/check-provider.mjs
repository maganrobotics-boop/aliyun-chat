// Authentication/session check only: sends no microphone data and creates no recording.
import { open, constants } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import WebSocket from 'ws';
import { createSubtitleService, SubtitleError } from './service.mjs';

let service;
try {
  if (process.argv.length > 3) throw new SubtitleError('用法：node check-provider.mjs /绝对路径/provider.env');
  const filename = process.argv[2] || '/etc/originmind-chat/subtitles-provider.env';
  if (!filename.startsWith('/')) throw new SubtitleError('配置文件必须使用绝对路径。');
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  let env;
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077) || info.size > 16384 || info.uid !== process.getuid()) {
      throw new SubtitleError('配置文件必须属于当前用户、权限为 0600 且不超过 16 KiB。');
    }
    env = parseEnv(await file.readFile('utf8'));
  } finally { await file.close(); }
  service = createSubtitleService({ WebSocket, model: env.CHAT_SUBTITLES_MODEL || undefined });
  const config = { apiKey: env.CHAT_SUBTITLES_API_KEY, baseUrl: env.CHAT_SUBTITLES_BASE_URL };
  for (const direction of ['ja-zh', 'zh-ja']) {
    const session = await service.start('provider-preflight', config, { direction, saveRecording: false });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      service.finish('provider-preflight', session.id);
      const events = (await service.events('provider-preflight', session.id, 0, controller.signal).text())
        .trim().split('\n').filter(Boolean).map(JSON.parse);
      if (events.at(-1)?.type !== 'ended' || events.at(-1)?.reason !== 'finished') {
        throw new SubtitleError('会话结束确认未通过，不能宣称认证预检完成。');
      }
      console.log(JSON.stringify({ direction, authentication: 'passed', sessionConfiguration: 'passed', sessionFinish: 'passed', audioTranslationTested: false }));
    } finally { clearTimeout(timer); }
  }
} catch (error) {
  console.log(JSON.stringify({ passed: false, message: error instanceof SubtitleError ? error.message : '预检未完成，请检查受保护配置文件和网络。' }));
  process.exitCode = 1;
} finally { await service?.close(); }

import WebSocket from 'ws';
import { createSubtitleService, SubtitleError } from './service.mjs';

// Uses no microphone audio or recordings. Only handshake, session and finish.
export async function verifySubtitleConnection(config, WebSocketImpl = WebSocket) {
  const service = createSubtitleService({ WebSocket: WebSocketImpl, model: config.model, connectTimeoutMs: 10000 });
  try {
    for (const direction of ['ja-zh', 'zh-ja']) {
      const session = await service.start('provider-preflight', config, { direction, saveRecording: false });
      service.finish('provider-preflight', session.id);
      const events = (await service.events('provider-preflight', session.id, 0).text())
        .trim().split('\n').filter(Boolean).map(JSON.parse);
      if (events.at(-1)?.reason !== 'finished') throw new SubtitleError('语音会话结束确认未通过，请稍后重试。');
    }
    return { connected: true, audioTranslationTested: false };
  } catch (error) {
    return { connected: false, message: error instanceof SubtitleError ? error.message : '语音连接验证未完成，请检查网络后重试。' };
  } finally { await service.close(); }
}

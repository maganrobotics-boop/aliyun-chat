import { decryptSecret, encryptSecret } from './crypto.mjs';
import { PublicError } from './errors.mjs';
import { speechCredentialError, speechEndpointError, DEFAULT_SPEECH_BASE_URL, DEFAULT_SPEECH_MODEL } from '../../aliyun/live-subtitles/credentials.mjs';

const settingId = 'subtitles-provider';
async function storedConfig(env) {
  const row = await env.DB?.prepare('SELECT value FROM settings WHERE id=?').bind(settingId).first();
  if (!row) return null;
  try { return JSON.parse(row.value); }
  catch { throw new PublicError('语音配置无法读取，请重新保存语音连接。', 503); }
}

export async function subtitleProviderView(env) {
  const saved = await storedConfig(env);
  return {
    baseUrl: saved?.baseUrl || env.CHAT_SUBTITLES_BASE_URL || DEFAULT_SPEECH_BASE_URL,
    model: saved?.model || env.CHAT_SUBTITLES_MODEL || DEFAULT_SPEECH_MODEL,
    keyConfigured: Boolean(saved?.encryptedKey || (!saved && env.CHAT_SUBTITLES_API_KEY)),
    verifiedAt: saved?.verifiedAt || null,
    testAvailable: typeof env.SUBTITLE_PROVIDER_TEST === 'function',
  };
}

export async function resolveSubtitleProvider(env) {
  const saved = await storedConfig(env);
  if (!saved) return { baseUrl: env.CHAT_SUBTITLES_BASE_URL, apiKey: env.CHAT_SUBTITLES_API_KEY, model: env.CHAT_SUBTITLES_MODEL || DEFAULT_SPEECH_MODEL };
  try { return { baseUrl: saved.baseUrl, model: saved.model, apiKey: await decryptSecret(saved.encryptedKey, env.APP_ENCRYPTION_KEY) }; }
  catch { throw new PublicError('语音密钥无法读取，请重新填写并验证。', 503); }
}

async function verify(env, config) {
  const error = speechCredentialError(config.apiKey) || speechEndpointError(config.baseUrl, config.model);
  if (error) throw new PublicError(error, 400);
  if (typeof env.SUBTITLE_PROVIDER_TEST !== 'function') throw new PublicError('语音连接验证尚未启用，请联系管理员。', 503);
  let result;
  try { result = await env.SUBTITLE_PROVIDER_TEST(config); }
  catch { throw new PublicError('语音连接验证未完成，原配置已保留。', 503); }
  if (result?.connected !== true) throw new PublicError(result?.message || '语音连接验证未通过，原配置已保留。', 503);
}

export async function saveSubtitleProvider(env, payload) {
  const previous = payload.apiKey?.trim() ? null : await resolveSubtitleProvider(env);
  const config = { baseUrl: payload.baseUrl.trim(), model: payload.model, apiKey: payload.apiKey?.trim() || previous?.apiKey };
  await verify(env, config);
  const saved = { baseUrl: config.baseUrl, model: config.model,
    encryptedKey: await encryptSecret(config.apiKey, env.APP_ENCRYPTION_KEY), verifiedAt: new Date().toISOString() };
  await env.DB.prepare('INSERT INTO settings (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
    .bind(settingId, JSON.stringify(saved)).run();
  return { saved: true, subtitleProvider: await subtitleProviderView(env) };
}

export async function testSubtitleProvider(env) {
  await verify(env, await resolveSubtitleProvider(env));
  return { connected: true, subtitleProvider: await subtitleProviderView(env) };
}

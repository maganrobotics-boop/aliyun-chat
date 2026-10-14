// Return only fixed, safe messages: never include the supplied credential.
export const DEFAULT_SPEECH_BASE_URL = 'https://maas.qianwenaiapi.com/compatible-mode/v1';
export const DEFAULT_SPEECH_MODEL = 'qwen3.8-livetranslate-flash-realtime';

export function speechEndpointError(baseUrl, model = DEFAULT_SPEECH_MODEL) {
  let url;
  try { url = new URL(baseUrl); } catch { return '实时翻译服务地址尚未配置。'; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(url.hostname === 'maas.qianwenaiapi.com' ||
      /^(?:ws-[a-z0-9]+\.(?:cn-beijing|ap-southeast-1)\.maas|dashscope(?:-intl)?)\.aliyuncs\.com$/.test(url.hostname))) return '请填写千问或百炼普通语音服务地址，不能使用套餐地址。';
  if (!/^qwen3\.(?:5|8)-livetranslate-flash-realtime$/.test(model)) return '实时翻译模型配置不正确。';
  return null;
}

export function speechCredentialError(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey) return '实时语音密钥尚未配置，请联系管理员。';
  if (apiKey.trim().startsWith('sk-sp-')) return '实时字幕需要千问或百炼普通 API Key，不能使用 Token Plan 或 Coding Plan 套餐密钥。';
  if (!/^sk-[A-Za-z0-9_.-]{8,256}$/.test(apiKey)) return '实时语音密钥格式不正确，请检查是否完整、是否含空格。';
  return null;
}

export function handshakeFailure(status) {
  if (status === 401) return { status: 503, message: '实时语音认证失败（401），请管理员核对普通 API Key 与地域、业务空间是否匹配。' };
  if (status === 403) return { status: 503, message: '实时语音访问被拒绝（403），请管理员核对模型权限和开通状态。' };
  if (status === 429) return { status: 503, message: '实时语音服务额度或并发受限（429），请稍后重试或联系管理员。' };
  return { status: 502, message: '实时语音服务握手失败，请稍后重试或联系管理员。' };
}

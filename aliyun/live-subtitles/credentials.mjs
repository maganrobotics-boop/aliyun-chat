// Return only fixed, safe messages: never include the supplied credential.
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

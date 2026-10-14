import { PublicError } from './errors.mjs';
import { resolveSubtitleProvider } from './subtitle-provider-config.mjs';

export async function handleLiveSubtitles(context, deps) {
  const { request, env } = context, url = new URL(request.url);
  const visitor = await deps.currentVisitor(context);
  const owner = visitor?.email;
  const service = env.LIVE_SUBTITLES;
  if (url.pathname === '/api/subtitles/status' && request.method === 'GET') {
    let configured = false;
    if (owner && service) {
      try { const config = await resolveSubtitleProvider(env); configured = Boolean(config.apiKey && config.baseUrl && !service.configurationError?.(config)); }
      catch { /* Saved recordings must remain readable if speech credentials fail. */ }
    }
    return deps.json({ signedIn: Boolean(owner), available: Boolean(owner && service && configured), canRecord: Boolean(owner && service?.canRecord) });
  }
  if (!owner) throw new PublicError('请先在 AI 助教登录，再使用实时字幕。', 401);
  if (!service) throw new PublicError('实时字幕尚未启用。', 503);
  try {
    const path = url.pathname.slice('/api/subtitles/'.length);
    if (path === 'sessions' && request.method === 'POST') {
      await deps.limit(context, 'subtitle-start', 12, 3600);
      const input = await deps.readJson(request, 1024);
      const providerConfig = await resolveSubtitleProvider(env);
      const configError = service.configurationError?.(providerConfig);
      const configured = Boolean(providerConfig.apiKey && providerConfig.baseUrl && !configError);
      if (!configured) throw new PublicError(configError || '实时语音服务尚未配置，请联系管理员。', 503);
      return deps.json(await service.start(owner, providerConfig, input), 201);
    }
    if (path === 'recordings' && request.method === 'GET') return deps.json({ recordings: await service.list(owner) });
    const recording = path.match(/^recordings\/([a-f0-9-]{36})\/(\d{1,4}|transcript)$/);
    if (recording && request.method === 'GET') { await deps.limit(context, 'subtitle-download', 180, 3600); return await service.download(owner, recording[1], recording[2]); }
    const match = path.match(/^sessions\/([a-f0-9-]{36})\/(audio|events|finish)$/);
    if (match) {
      const [, id, action] = match;
      if (action === 'events' && request.method === 'GET') return service.events(owner, id, Number(url.searchParams.get('after') || 0), request.signal);
      if (action === 'finish' && request.method === 'POST') return deps.json(service.finish(owner, id));
      if (action === 'audio' && request.method === 'POST') {
        if (request.headers.get('content-type') !== 'application/octet-stream') throw new PublicError('音频格式不正确。', 415);
        return deps.json(await service.audio(owner, id, Number(url.searchParams.get('seq')), await deps.readBytes(request, 64000)));
      }
    }
    throw new PublicError('接口不存在。', 404);
  } catch (error) {
    if (error?.name === 'Error' && error?.status) throw new PublicError(error.message, error.status);
    throw error;
  }
}

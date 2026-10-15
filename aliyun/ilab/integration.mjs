import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createIlabClient, validateResult } from './protocol.mjs';
import { createIlabStore } from './store.mjs';

const PREFIX = '/learning/ilab';
const EVENT_PATH = '/api/internal/ilab/events';
const COOKIE = 'omind_ilab';
const MAX_BODY = 768 * 1024;
const MAX_REPORT = 5_000_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));

class IntegrationError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function fail(message, status = 400) { throw new IntegrationError(message, status); }
function safeEqual(a, b) {
  const first = Buffer.from(String(a)), second = Buffer.from(String(b));
  return first.length === second.length && timingSafeEqual(first, second);
}
function string(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) fail(`${label}格式不正确。`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}格式不正确。`);
  return value;
}
function recordMeta(data) {
  string(data.eventId, 128, '事件编号');
  string(data.source, 100, '证据来源');
  string(data.evidenceId, 200, '证据编号');
}
function json(value, status = 200, extra = {}) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', ...extra,
  } });
}
async function bodyBytes(request, maximum) {
  if (Number(request.headers.get('content-length')) > maximum) fail('请求内容过大。', 413);
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(), pieces = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); fail('请求内容过大。', 413); }
      pieces.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(pieces, length);
}
function publicAttempt(attempt) {
  return {
    attemptId: attempt.id, displayName: attempt.displayName, state: attempt.state,
    startedAt: attempt.createdAt, expiresAt: attempt.expiresAt,
    recordedSteps: attempt.steps.length, aiCallCount: attempt.aiCalls.length,
    reportState: attempt.reportState,
    ...(attempt.receipt ? { receipt: attempt.receipt } : {}),
    ...(attempt.errorCode ? { platformCode: attempt.errorCode } : {}),
  };
}

/** Sign only on an authorised experiment backend; never deliver the key to a browser. */
export function signIlabEvent(body, secret, { timestamp = Date.now(), nonce = randomBytes(24).toString('hex') } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const stamp = String(timestamp);
  const signature = createHmac('sha256', secret).update(`${stamp}\n${nonce}\n${text}`).digest('hex');
  return { 'content-type': 'application/json', 'x-ilab-timestamp': stamp, 'x-ilab-nonce': nonce, 'x-ilab-signature': signature };
}

/**
 * An isolated backend connector. Only signed backend evidence can assign marks or
 * count AI calls. Browser requests can inspect their own record and request sync.
 * Enabling this connector does not create a grading rubric or certify compliance.
 */
export function createIlabIntegration({ env = {}, databasePath, fetcher, now = Date.now } = {}) {
  const enabled = env.ILAB_ENABLED === 'true';
  const relevant = pathname => pathname === PREFIX || pathname.startsWith(`${PREFIX}/`) || pathname === EVENT_PATH;
  if (!enabled) return {
    async handle(request) {
      return relevant(new URL(request.url).pathname) ? json({ error: '国家实验空间接入尚未启用。' }, 503) : null;
    }, close() {},
  };
  const mode = env.ILAB_MODE || 'test';
  const publicUrl = new URL(env.ILAB_PUBLIC_ORIGIN || 'https://omindos.cn');
  const appUrl = new URL(env.APP_ORIGIN || publicUrl.origin);
  if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) throw new Error('ILAB_PUBLIC_ORIGIN must be an exact HTTPS origin');
  if (!['https:', 'http:'].includes(appUrl.protocol) || (appUrl.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(appUrl.hostname))) throw new Error('APP_ORIGIN must be HTTPS or loopback');
  const destination = new URL(env.ILAB_EXPERIMENT_PATH || '/learning', publicUrl);
  if (destination.origin !== publicUrl.origin || !/^\/learning(?:\/|$)/u.test(destination.pathname) || destination.pathname.startsWith(PREFIX) || destination.hash) throw new Error('ILAB_EXPERIMENT_PATH must be a fixed local learning path');
  const keyText = env.ILAB_STORAGE_KEY || '';
  const storageKey = Buffer.from(keyText, 'base64');
  if (storageKey.length !== 32 || storageKey.toString('base64') !== keyText) throw new Error('ILAB_STORAGE_KEY must encode 32 random bytes');
  const eventSecret = env.ILAB_EVENT_SECRET || '';
  if (eventSecret && Buffer.byteLength(eventSecret) < 32) throw new Error('ILAB_EVENT_SECRET must have at least 32 bytes');
  const title = string(env.ILAB_EXPERIMENT_TITLE || '面向矿井巡检的具身智能机器人感知与自主决策虚拟仿真实验', 100, '实验名称');
  const requiredSteps = integer(Number(env.ILAB_REQUIRED_STEPS || 24), 20, 200, '实验步骤数');
  const appid = string(env.ILAB_APPID, 100, '项目编号');
  const client = createIlabClient({
    origin: env.ILAB_API_ORIGIN || (mode === 'mock' ? 'https://www.ilab-x.com' : mode === 'test' ? 'http://39.105.173.29' : 'https://www.ilab-x.com'),
    appid, secret: env.ILAB_SECRET, mode,
    allowProduction: env.ILAB_ALLOW_PRODUCTION === 'true', fetcher, now,
  });
  const store = createIlabStore({ databasePath: databasePath || env.ILAB_SQLITE_PATH, storageKey, now });
  const launchLocks = new Set(), rates = new Map();
  function rate(key, maximum) {
    const minute = Math.floor(now() / 60_000), existing = rates.get(key);
    const entry = existing?.minute === minute ? existing : { minute, count: 0 };
    entry.count++;
    rates.set(key, entry);
    if (rates.size > 4000) for (const [id, item] of rates) if (item.minute !== minute) rates.delete(id);
    if (entry.count > maximum) fail('请求过于频繁，请稍后重试。', 429);
  }
  const csrf = cookie => createHmac('sha256', storageKey).update(`ilab-csrf\n${cookie}`).digest('hex');
  function session(request) {
    const matches = String(request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
    if (matches.length !== 1) fail('请从国家实验空间重新进入本实验。', 401);
    const value = matches[0].slice(COOKIE.length + 1);
    if (!/^[a-f0-9]{64}$/u.test(value)) fail('实验会话无效。', 401);
    const attempt = store.bySessionHash(hash(value));
    if (!attempt || attempt.expiresAt <= now()) fail('实验会话已过期，请从国家实验空间重新进入。', 401);
    return { attempt, csrf: csrf(value) };
  }
  function browserWrite(request, csrfValue) {
    const origin = request.headers.get('origin');
    if (![publicUrl.origin, appUrl.origin].includes(origin) || request.headers.get('sec-fetch-site') === 'cross-site' || !safeEqual(request.headers.get('x-ilab-csrf') || '', csrfValue)) fail('请从当前实验页面提交。', 403);
  }
  function current(id) {
    const attempt = store.get(id);
    if (!attempt) fail('实验记录不存在。', 404);
    if (attempt.expiresAt <= now()) fail('实验会话已过期。', 401);
    return attempt;
  }
  function aggregateAi(calls) {
    const models = new Map(), scenarios = new Set();
    for (const call of calls) {
      const model = { model: call.model, version: call.version, deployment: call.deployment, ...(call.provider ? { provider: call.provider } : {}) };
      models.set(JSON.stringify(model), model);
      scenarios.add(call.scenario);
    }
    const allHave = key => calls.every(call => own(call, key));
    return {
      ai_call_count: calls.length, ai_models_used: [...models.values()], ai_usage_scenarios: [...scenarios],
      ...(allHave('inputTokens') ? { ai_input_token_count: calls.reduce((sum, call) => sum + call.inputTokens, 0) } : {}),
      ...(allHave('outputTokens') ? { ai_output_token_count: calls.reduce((sum, call) => sum + call.outputTokens, 0) } : {}),
    };
  }
  function resultFor(attempt, { score = 0, completedAt = now(), status = 2 } = {}) {
    return {
      username: attempt.username, title, appid, originId: attempt.id,
      status, score, startTime: attempt.createdAt, endTime: completedAt,
      timeUsed: Math.max(1, Math.round((completedAt - attempt.createdAt) / 1000)),
      steps: [...attempt.steps].sort((a, b) => a.seq - b.seq), ai_data: aggregateAi(attempt.aiCalls),
    };
  }
  function apply(id, data, mutate) {
    current(id); recordMeta(data);
    return store.applyEvent(id, data.eventId, hash(JSON.stringify(data)), mutate);
  }
  function recordStep(id, data) {
    if (!exact(data, ['eventId', 'source', 'evidenceId', 'step']) || !object(data.step)) fail('实验步骤证据格式不正确。');
    return apply(id, data, attempt => {
      const seq = integer(data.step.seq, 1, requiredSteps, '实验步骤序号');
      if (attempt.steps.some(step => step.seq === seq)) fail('该步骤已有已评分证据，不能覆盖。', 409);
      if (own(data.step, 'ext_data') && !object(data.step.ext_data)) fail('实验步骤过程数据需要JSON对象。');
      const step = { ...data.step, remarks: data.step.remarks || '', ext_data: {
        ...(object(data.step.ext_data) ? data.step.ext_data : {}),
        evidence_source: data.source, evidence_id: data.evidenceId,
      } };
      const end = step.endTime;
      const candidate = { ...attempt, steps: [...attempt.steps, step] };
      validateResult(resultFor(candidate, { completedAt: Math.max(now(), end) }), { appid, username: attempt.username, minimumSteps: requiredSteps, now: now() });
      return { steps: candidate.steps };
    });
  }
  function recordAiCall(id, data) {
    if (!exact(data, ['eventId', 'source', 'evidenceId', 'model', 'version', 'deployment', 'provider', 'scenario', 'inputTokens', 'outputTokens'])) fail('AI调用证据格式不正确。');
    recordMeta(data);
    string(data.model, 200, '模型名称'); string(data.version, 100, '模型版本');
    string(data.scenario, 200, 'AI应用场景');
    if (!['公有云服务', '私有化部署', '混合服务', '本地运行'].includes(data.deployment)) fail('模型部署方式不正确。');
    if (own(data, 'provider')) string(data.provider, 200, '模型提供方');
    for (const key of ['inputTokens', 'outputTokens']) if (own(data, key)) integer(data[key], 0, Number.MAX_SAFE_INTEGER, 'AI词元数量');
    return apply(id, data, attempt => {
      if (attempt.aiCalls.length >= 1000) fail('本次实验的AI证据数量超过接入上限。', 409);
      return { aiCalls: [...attempt.aiCalls, { ...data }] };
    });
  }
  function complete(id, data) {
    if (!exact(data, ['eventId', 'source', 'evidenceId', 'score', 'completedAt'])) fail('实验完成证据格式不正确。');
    const score = integer(data.score, 0, 100, '实验总分');
    const end = integer(data.completedAt, 1_000_000_000_000, now(), '实验完成时间');
    return apply(id, data, attempt => {
      if (attempt.steps.length !== requiredSteps || attempt.steps.some((step, index, rows) => !rows.some(item => item.seq === index + 1))) fail(`需要${requiredSteps}个真实操作步骤的完整评分证据。`, 409);
      const result = validateResult(resultFor(attempt, { score, completedAt: end, status: 1 }), { appid, username: attempt.username, minimumSteps: requiredSteps, now: now() });
      result.ext_data = { completion_source: data.source, completion_evidence_id: data.evidenceId };
      return { result, resultHash: hash(JSON.stringify(result)), state: 'ready', errorCode: null };
    });
  }
  async function activeToken(attempt) {
    const tokens = attempt.tokens;
    if (tokens.expiresTime > now() + 30_000) return tokens.activeAccessToken;
    if (tokens.refreshCount >= 2) fail('平台登录凭证已到期，请重新从国家实验空间进入。', 401);
    // Reserve a refresh before the request. A lost reply must not create an
    // unbounded refresh loop against a two-refresh upstream allowance.
    store.patch(attempt.id, { tokens: { ...tokens, refreshCount: tokens.refreshCount + 1 } });
    const result = await client.refreshToken(tokens.originalAccessToken);
    const updated = { ...tokens, activeAccessToken: result.access_token, expiresTime: result.expires_time, refreshCount: tokens.refreshCount + 1 };
    store.patch(attempt.id, { tokens: updated });
    return updated.activeAccessToken;
  }
  function failureState(error, duplicateCode) {
    const code = error?.upstreamCode;
    const definiteRejections = duplicateCode === 15
      ? new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19])
      : new Set([1, 2, 3, 4, 5, 7, 8, 10]);
    return definiteRejections.has(code) ? { state: 'rejected', code } : { state: 'uncertain', code: Number.isInteger(code) ? code : null };
  }
  async function sendReport(attempt) {
    if (attempt.state !== 'sent' || !attempt.reportBytes || !store.compareAndSetReportState(attempt.id, ['pending', 'rejected'], 'submitting')) return;
    const claimed = store.get(attempt.id);
    let token;
    try { token = await activeToken(store.get(attempt.id)); }
    catch (error) { store.patch(attempt.id, { reportState: 'rejected' }); throw error; }
    try {
      const receipt = await client.uploadReport(token, { ...claimed.reportMeta, originId: attempt.id, bytes: claimed.reportBytes });
      store.patch(attempt.id, { reportState: 'sent', reportReceipt: { id: String(receipt.id), receivedAt: now() } });
    } catch (error) {
      const failed = failureState(error, 6);
      store.patch(attempt.id, { reportState: failed.state });
      throw error;
    }
  }
  async function submit(id) {
    let attempt = current(id);
    if (attempt.state === 'sent') { await sendReport(attempt); return publicAttempt(store.get(id)); }
    if (attempt.state === 'uncertain' || attempt.state === 'submitting') fail('平台回执尚未确认，请由负责人核对后处理，系统不会重复提交。', 409);
    if (!attempt.result || !['ready', 'rejected'].includes(attempt.state)) fail('实验评分证据尚未齐全。', 409);
    if (hash(JSON.stringify(attempt.result)) !== attempt.resultHash) fail('实验记录校验失败。', 409);
    if (!store.compareAndSetState(id, ['ready', 'rejected'], 'submitting')) fail('本次实验正在同步。', 409);
    let token;
    try { token = await activeToken(store.get(id)); }
    catch (error) { store.patch(id, { state: attempt.state }); throw error; }
    try {
      const receipt = await client.uploadResult(token, attempt.result);
      store.patch(id, { state: 'sent', errorCode: null, receipt: { id: String(receipt.id), receivedAt: now() } });
    } catch (error) {
      const failed = failureState(error, 15);
      store.patch(id, { state: failed.state, errorCode: failed.code === null ? null : String(failed.code) });
      throw error;
    }
    await sendReport(store.get(id));
    return publicAttempt(store.get(id));
  }
  async function launch(request, url) {
    if (request.method !== 'GET') fail('不支持的请求方法。', 405);
    const tickets = url.searchParams.getAll('ticket');
    if (tickets.length !== 1 || tickets[0].length < 1 || tickets[0].length > 8192 || /[\u0000-\u0020]/u.test(tickets[0])) fail('请从国家实验空间的“我要做实验”进入。');
    const ticket = tickets[0], ticketHash = hash(ticket);
    const rateKey = request.headers.get('cf-connecting-ip') || 'launch';
    rate(`launch:${rateKey}`, 20);
    if (store.ticketUsed(ticketHash) || launchLocks.has(ticketHash)) fail('该实验入口已使用，请从国家平台重新进入。', 409);
    launchLocks.add(ticketHash);
    try {
      const identity = await client.exchangeTicket(ticket);
      const cookie = randomBytes(32).toString('hex'), id = `ilab_${randomBytes(24).toString('hex')}`;
      const createdAt = now(), expiresAt = createdAt + 24 * 60 * 60 * 1000;
      store.createAttempt({
        id, sessionHash: hash(cookie), ticketHash, username: identity.un, displayName: identity.dis,
        tokens: { originalAccessToken: identity.access_token, activeAccessToken: identity.access_token, expiresTime: identity.expires_time, refreshCount: 0 }, createdAt, expiresAt,
      });
      const target = new URL(destination);
      target.searchParams.set('ilab', '1');
      return new Response(null, { status: 303, headers: {
        Location: target.href, 'Set-Cookie': `${COOKIE}=${cookie}; Path=/learning; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      } });
    } finally { launchLocks.delete(ticketHash); }
  }
  async function ingest(request) {
    if (request.method !== 'POST') fail('不支持的请求方法。', 405);
    if (!eventSecret) fail('实验记录接入尚未配置。', 503);
    if (request.headers.has('origin') || request.headers.get('sec-fetch-site') === 'cross-site') fail('仅接受实验后端签名记录。', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail('需要JSON格式。', 415);
    const stamp = request.headers.get('x-ilab-timestamp') || '', nonce = request.headers.get('x-ilab-nonce') || '', signature = request.headers.get('x-ilab-signature') || '';
    if (!/^\d{13}$/u.test(stamp) || Math.abs(now() - Number(stamp)) > 300_000 || !/^[A-Za-z0-9_]{16,128}$/u.test(nonce) || !/^[a-f0-9]{64}$/u.test(signature)) fail('实验记录签名无效。', 401);
    const bytes = await bodyBytes(request, MAX_BODY);
    const expected = createHmac('sha256', eventSecret).update(`${stamp}\n${nonce}\n`).update(bytes).digest('hex');
    if (!safeEqual(expected, signature)) fail('实验记录签名无效。', 401);
    if (!store.useNonce(nonce, Number(stamp))) fail('实验记录请求已使用。', 409);
    let payload;
    try { payload = JSON.parse(bytes.toString('utf8')); } catch { fail('实验记录格式不正确。'); }
    if (!exact(payload, ['attemptId', 'type', 'data']) || typeof payload.attemptId !== 'string') fail('实验记录格式不正确。');
    const handlers = { step: recordStep, ai: recordAiCall, complete };
    if (!own(handlers, payload.type)) fail('实验记录类型不正确。');
    const result = handlers[payload.type](payload.attemptId, payload.data);
    return json({ ...publicAttempt(result.attempt), idempotent: result.idempotent });
  }
  async function handle(request) {
    const url = new URL(request.url);
    if (!relevant(url.pathname)) return null;
    try {
      if (![appUrl.origin, publicUrl.origin].includes(url.origin)) fail('请求域名不正确。', 421);
      if (url.pathname === EVENT_PATH) return await ingest(request);
      if (url.pathname === `${PREFIX}/launch`) return await launch(request, url);
      const owner = session(request), attempt = owner.attempt;
      rate(attempt.id, 240);
      if ((url.pathname === PREFIX || url.pathname === `${PREFIX}/session`) && request.method === 'GET') return json({ ...publicAttempt(attempt), csrfToken: owner.csrf, requiredSteps, environment: mode });
      if (url.pathname === `${PREFIX}/preview` && request.method === 'GET') {
        if (!attempt.result) fail('实验评分证据尚未齐全。', 409);
        return json({ payload: attempt.result, state: attempt.state });
      }
      if (url.pathname === `${PREFIX}/submit` && request.method === 'POST') {
        browserWrite(request, owner.csrf);
        const bytes = await bodyBytes(request, 128);
        if (bytes.length && bytes.toString('utf8').trim() !== '{}') fail('成绩只能来自实验后端，不能由浏览器指定。');
        return json(await submit(attempt.id));
      }
      if (url.pathname === `${PREFIX}/report` && request.method === 'POST') {
        browserWrite(request, owner.csrf);
        if (!request.headers.get('content-type')?.startsWith('application/pdf')) fail('请上传PDF实验报告。', 415);
        const filename = string(url.searchParams.get('filename'), 120, '报告文件名');
        if (!/^[^/\\]+\.pdf$/iu.test(filename)) fail('报告文件名不正确。');
        const bytes = await bodyBytes(request, MAX_REPORT);
        if (bytes.length < 5 || bytes.subarray(0, 5).toString() !== '%PDF-') fail('实验报告不是有效的PDF文件。');
        // The body may be slow. Re-read after the await so a concurrent send
        // cannot be reset from sent/submitting/uncertain back to pending.
        const latest = current(attempt.id);
        if (['sent', 'submitting', 'uncertain'].includes(latest.reportState)) fail('报告已提交或回执待确认，不能重复上传。', 409);
        if (latest.reportBytes && hash(latest.reportBytes) !== hash(bytes)) fail('本实验已保存另一份报告，请核对后处理。', 409);
        store.patch(attempt.id, { reportBytes: bytes, reportMeta: { filename, title: '实验报告', remarks: '' }, reportState: 'pending' });
        return json({ saved: true, reportState: 'pending' });
      }
      if (url.pathname === `${PREFIX}/report/submit` && request.method === 'POST') {
        browserWrite(request, owner.csrf);
        if ((await bodyBytes(request, 128)).length) fail('报告同步不接受额外参数。');
        const latest = current(attempt.id);
        if (latest.state !== 'sent' || !latest.reportBytes) fail('需要先确认实验成绩已同步并保存实验报告。', 409);
        await sendReport(latest);
        return json(publicAttempt(store.get(attempt.id)));
      }
      return json({ error: '接入接口不存在或请求方法不正确。' }, 404);
    } catch (error) {
      if (error instanceof IntegrationError) return json({ error: error.message }, error.statusCode);
      if (Number.isInteger(error?.statusCode) && [400, 401, 403, 404, 409, 413, 429].includes(error.statusCode)) return json({ error: '实验记录未被接受，请核对会话和证据。' }, error.statusCode);
      return json({ error: '平台同步未确认，请查看实验状态后处理。', ...(Number.isInteger(error?.upstreamCode) ? { platformCode: error.upstreamCode } : {}) }, 502);
    }
  }
  return { handle, recordStep, recordAiCall, complete, submit, close() { store.close(); } };
}

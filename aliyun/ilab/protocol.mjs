import { createHash } from 'node:crypto';

export const ILAB_PRODUCTION_ORIGIN = 'https://www.ilab-x.com';
export const ILAB_TEST_ORIGIN = 'http://39.105.173.29';
export const ILAB_MAX_REPORT_BYTES = 5_000_000;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_REQUEST_BYTES = 1_048_576;
const DEPLOYMENTS = new Set(['公有云服务', '私有化部署', '混合服务', '本地运行']);
const RESULT_FIELDS = new Set(['username', 'title', 'childProjectTitle', 'status', 'score', 'startTime', 'endTime', 'timeUsed', 'appid', 'originId', 'steps', 'group_id', 'group_name', 'role_in_group', 'group_members', 'ext_data', 'ai_data']);
const STEP_FIELDS = new Set(['seq', 'title', 'startTime', 'endTime', 'timeUsed', 'expectTime', 'maxScore', 'score', 'repeatCount', 'evaluation', 'scoringModel', 'remarks', 'ext_data']);
const AI_FIELDS = new Set(['ai_call_count', 'ai_models_used', 'ai_usage_scenarios', 'ai_input_token_count', 'ai_output_token_count', 'ai_remark']);
const MODEL_FIELDS = new Set(['model', 'version', 'deployment', 'provider']);

/** Safe errors deliberately exclude URLs, credentials, upstream messages and causes. */
export class IlabProtocolError extends Error {
  constructor(code, message, { upstreamCode, retryable = false } = {}) {
    super(message);
    this.name = 'IlabProtocolError';
    this.code = code;
    this.retryable = retryable;
    if (Number.isSafeInteger(upstreamCode)) this.upstreamCode = upstreamCode;
  }
}

const fail = (field) => { throw new IlabProtocolError('ILAB_INVALID_DATA', `实验数据字段不符合规范：${field}`); };
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const textLength = (value) => [...value].length;
const denseArray = (value) => {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
};
function object(value, allowed, field) {
  if (!plain(value) || Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.has(key))) fail(field);
}
function string(value, max, field, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || textLength(value) > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(field);
  return value;
}
function integer(value, min, max, field) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(field);
  return value;
}
function timestamp(value, field) { return integer(value, 1_000_000_000_000, 9_999_999_999_999, field); }
function opaque(value, field) {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\s\u0000-\u001f\u007f]/u.test(value)) fail(field);
  return value;
}
function jsonCopy(value, field, depth = 0, seen = new Set()) {
  if (depth > 20) fail(field);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if ((!plain(value) && !Array.isArray(value)) || seen.has(value)) fail(field);
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (!denseArray(value)) fail(field);
    if (value.length > 10_000) fail(field);
    result = value.map((entry) => jsonCopy(entry, field, depth + 1, seen));
  } else {
    result = {};
    if (Reflect.ownKeys(value).length > 1000) fail(field);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) fail(field);
      Object.defineProperty(result, key, { value: jsonCopy(value[key], field, depth + 1, seen), enumerable: true, writable: true, configurable: true });
    }
  }
  seen.delete(value);
  return result;
}
function aiData(value) {
  object(value, AI_FIELDS, 'ai_data');
  const calls = integer(value.ai_call_count, 0, Number.MAX_SAFE_INTEGER, 'ai_data.ai_call_count');
  if (!denseArray(value.ai_models_used) || !denseArray(value.ai_usage_scenarios) || value.ai_models_used.length > 200 || value.ai_usage_scenarios.length > 200) fail('ai_data');
  if (calls > 0 && (!value.ai_models_used.length || !value.ai_usage_scenarios.length)) fail('ai_data');
  const result = {
    ai_call_count: calls,
    ai_models_used: value.ai_models_used.map((model) => {
      object(model, MODEL_FIELDS, 'ai_data.ai_models_used');
      const result = {
        model: string(model.model, 500, 'ai_data.ai_models_used.model'),
        version: string(model.version, 200, 'ai_data.ai_models_used.version'),
        deployment: string(model.deployment, 20, 'ai_data.ai_models_used.deployment'),
      };
      if (!DEPLOYMENTS.has(result.deployment)) fail('ai_data.ai_models_used.deployment');
      if (model.provider !== undefined) result.provider = string(model.provider, 500, 'ai_data.ai_models_used.provider', { empty: true });
      return result;
    }),
    ai_usage_scenarios: value.ai_usage_scenarios.map((scenario) => string(scenario, 500, 'ai_data.ai_usage_scenarios')),
  };
  for (const key of ['ai_input_token_count', 'ai_output_token_count']) if (value[key] !== undefined) result[key] = integer(value[key], 0, Number.MAX_SAFE_INTEGER, `ai_data.${key}`);
  if (value.ai_remark !== undefined) result.ai_remark = string(value.ai_remark, 2000, 'ai_data.ai_remark', { empty: true });
  return result;
}
function interval(value, field, currentTime) {
  timestamp(value.startTime, `${field}.startTime`);
  timestamp(value.endTime, `${field}.endTime`);
  integer(value.timeUsed, 1, Number.MAX_SAFE_INTEGER, `${field}.timeUsed`);
  if (value.startTime >= value.endTime || value.endTime > currentTime + 600_000 || Math.abs(value.endTime - value.startTime - value.timeUsed * 1000) > 1000) fail(field);
}

/** Validate real observations and return an independent, allowlisted JSON copy. */
export function validateResult(payload, { appid, username, minimumSteps = 20, now = Date.now() } = {}) {
  object(payload, RESULT_FIELDS, 'result');
  integer(minimumSteps, 10, 200, 'minimumSteps');
  integer(now, 1_000_000_000_000, Number.MAX_SAFE_INTEGER, 'now');
  string(payload.appid, 64, 'appid');
  if (!/^\d+$/u.test(payload.appid) || (appid !== undefined && payload.appid !== appid)) fail('appid');
  string(payload.username, 200, 'username');
  if (username !== undefined && payload.username !== username) fail('username');
  string(payload.originId, 200, 'originId');
  if (!/^[A-Za-z0-9_]+$/u.test(payload.originId)) fail('originId');
  string(payload.title, 100, 'title');
  integer(payload.status, 1, 2, 'status');
  integer(payload.score, 0, 100, 'score');
  interval(payload, 'result', now);
  if (!denseArray(payload.steps) || payload.steps.length > 200 || (payload.status === 1 && payload.steps.length < minimumSteps)) fail('steps');
  const result = {};
  for (const key of ['username', 'title', 'status', 'score', 'startTime', 'endTime', 'timeUsed', 'appid', 'originId']) result[key] = payload[key];
  if (payload.childProjectTitle !== undefined) result.childProjectTitle = string(payload.childProjectTitle, 100, 'childProjectTitle');
  for (const key of ['group_id', 'group_name', 'role_in_group', 'group_members']) if (payload[key] !== undefined) result[key] = string(payload[key], 20, key, { empty: true });
  let previousStart = payload.startTime;
  const pairs = new Set();
  result.steps = payload.steps.map((step, index) => {
    object(step, STEP_FIELDS, 'steps');
    if (step.seq !== index + 1) fail('steps.seq');
    string(step.title, 100, 'steps.title');
    interval(step, 'steps', now);
    if (step.startTime < payload.startTime || step.endTime > payload.endTime || step.startTime < previousStart) fail('steps.time');
    const pair = `${step.startTime}:${step.endTime}`;
    if (pairs.has(pair)) fail('steps.time');
    pairs.add(pair);
    previousStart = step.startTime;
    integer(step.expectTime, 1, Number.MAX_SAFE_INTEGER, 'steps.expectTime');
    integer(step.maxScore, 0, 100, 'steps.maxScore');
    integer(step.score, 0, step.maxScore, 'steps.score');
    integer(step.repeatCount, 1, Number.MAX_SAFE_INTEGER, 'steps.repeatCount');
    string(step.evaluation, 200, 'steps.evaluation');
    string(step.scoringModel, 200, 'steps.scoringModel');
    const out = {};
    for (const key of ['seq', 'title', 'startTime', 'endTime', 'timeUsed', 'expectTime', 'maxScore', 'score', 'repeatCount', 'evaluation', 'scoringModel']) out[key] = step[key];
    out.remarks = step.remarks === undefined ? '' : string(step.remarks, 200, 'steps.remarks', { empty: true });
    if (step.ext_data !== undefined) out.ext_data = jsonCopy(step.ext_data, 'steps.ext_data');
    return out;
  });
  if (payload.ext_data !== undefined) result.ext_data = jsonCopy(payload.ext_data, 'ext_data');
  if (payload.status === 1 || payload.ai_data !== undefined) result.ai_data = aiData(payload.ai_data);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_REQUEST_BYTES) fail('result.size');
  return result;
}

function configuration({ origin, appid, secret, mode, allowProduction, fetcher, timeoutMs }) {
  if (!['mock', 'test', 'production'].includes(mode)) throw new IlabProtocolError('ILAB_CONFIG', '实验空间运行模式未正确配置');
  let parsed;
  try { parsed = new URL(origin); } catch { throw new IlabProtocolError('ILAB_CONFIG', '实验空间接口地址未正确配置'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || ![ILAB_PRODUCTION_ORIGIN, ILAB_TEST_ORIGIN].includes(parsed.origin)) throw new IlabProtocolError('ILAB_CONFIG', '实验空间接口地址不在允许范围');
  if (mode === 'test' && parsed.origin !== ILAB_TEST_ORIGIN) throw new IlabProtocolError('ILAB_CONFIG', '测试模式必须连接官方测试地址');
  if (mode === 'production' && (parsed.origin !== ILAB_PRODUCTION_ORIGIN || allowProduction !== true || appid === '10000')) throw new IlabProtocolError('ILAB_CONFIG', '正式接入尚未明确启用');
  if (mode === 'mock' && typeof fetcher !== 'function') throw new IlabProtocolError('ILAB_CONFIG', '模拟模式必须使用本地模拟请求');
  if (typeof appid !== 'string' || !/^\d{1,64}$/u.test(appid) || typeof secret !== 'string' || !secret || secret.length > 8192 || /[\r\n\u0000]/u.test(secret)) throw new IlabProtocolError('ILAB_CONFIG', '实验空间密钥未正确配置');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || (fetcher !== undefined && typeof fetcher !== 'function')) throw new IlabProtocolError('ILAB_CONFIG', '实验空间请求配置不正确');
  return parsed.origin;
}

async function readJson(response) {
  const advertised = response.headers?.get?.('content-length');
  if (advertised && Number(advertised) > MAX_RESPONSE_BYTES) throw new IlabProtocolError('ILAB_RESPONSE_TOO_LARGE', '实验空间返回数据过大');
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let count = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        count += value.byteLength;
        if (count > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new IlabProtocolError('ILAB_RESPONSE_TOO_LARGE', '实验空间返回数据过大');
        }
        chunks.push(value);
      }
      bytes = Buffer.concat(chunks, count);
    } finally { reader.releaseLock(); }
  } else {
    bytes = Buffer.from(await response.text(), 'utf8');
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new IlabProtocolError('ILAB_RESPONSE_TOO_LARGE', '实验空间返回数据过大');
  }
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new IlabProtocolError('ILAB_BAD_RESPONSE', '实验空间返回格式不正确'); }
  if (!plain(data) || !Number.isSafeInteger(data.code)) throw new IlabProtocolError('ILAB_BAD_RESPONSE', '实验空间返回格式不正确');
  if (data.code !== 0) throw new IlabProtocolError('ILAB_REMOTE_REJECTED', '实验空间未接受本次请求', { upstreamCode: data.code });
  return data;
}

/** Backend-only API transport. Inject fetcher for mocks; never log request URLs. */
export function createIlabClient({ origin, appid, secret, mode, allowProduction = false, fetcher, now = Date.now, timeoutMs = 10_000 }) {
  const base = configuration({ origin, appid, secret, mode, allowProduction, fetcher, timeoutMs });
  if (typeof now !== 'function') throw new IlabProtocolError('ILAB_CONFIG', '实验空间时钟配置不正确');
  const requestFetch = fetcher || globalThis.fetch;
  const sign = (value) => createHash('md5').update(value + appid + secret, 'utf8').digest('hex').toUpperCase();
  async function request(path, params, { method = 'POST', body, contentType } = {}) {
    const target = new URL(path, base);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await requestFetch(target.toString(), { method, headers: { accept: 'application/json', ...(contentType ? { 'content-type': contentType } : {}) }, body, redirect: 'error', signal: controller.signal });
      if (response.redirected || (response.url && new URL(response.url).origin !== base) || response.status < 200 || response.status >= 300) throw new IlabProtocolError('ILAB_HTTP_ERROR', '实验空间请求未成功', { retryable: response.status >= 500 });
      return await readJson(response);
    } catch (error) {
      if (error instanceof IlabProtocolError) throw error;
      if (controller.signal.aborted) throw new IlabProtocolError('ILAB_TIMEOUT', '实验空间请求超时，请先确认提交状态', { retryable: false });
      throw new IlabProtocolError('ILAB_NETWORK_ERROR', '实验空间连接失败，请先确认提交状态', { retryable: false });
    } finally { clearTimeout(timer); }
  }
  function tokenResponse(data, withIdentity) {
    opaque(data.access_token, 'access_token');
    timestamp(data.create_time, 'create_time');
    timestamp(data.expires_time, 'expires_time');
    if (data.expires_time <= data.create_time) throw new IlabProtocolError('ILAB_BAD_RESPONSE', '实验空间返回有效期不正确');
    const out = { code: 0, access_token: data.access_token, create_time: data.create_time, expires_time: data.expires_time };
    if (withIdentity) {
      out.un = string(data.un, 200, 'un');
      out.dis = string(data.dis ?? '', 200, 'dis', { empty: true });
    }
    return out;
  }
  return Object.freeze({
    // The HTTP entry point must decode its query once (e.g. URLSearchParams).
    // This method receives that original value; literal '%' and '%2F' are data.
    async exchangeTicket(decodedTicket) {
      opaque(decodedTicket, 'ticket');
      return tokenResponse(await request('/open/api/v2/token', { ticket: decodedTicket, appid, signature: sign(decodedTicket) }), true);
    },
    async refreshToken(originalAccessToken) {
      opaque(originalAccessToken, 'access_token');
      return tokenResponse(await request('/open/api/v2/token/refresh', { access_token: originalAccessToken, appid, signature: sign(originalAccessToken) }), false);
    },
    async uploadResult(accessToken, payload) {
      opaque(accessToken, 'access_token');
      const valid = validateResult(payload, { appid, minimumSteps: 20, now: now() });
      const data = await request('/open/api/v2/data_upload', { access_token: accessToken }, { body: JSON.stringify(valid), contentType: 'application/json' });
      return { code: 0, id: string(String(data.id ?? ''), 200, 'id') };
    },
    async uploadReport(accessToken, { originId, filename, title, remarks = '', bytes } = {}) {
      opaque(accessToken, 'access_token');
      string(originId, 200, 'originId');
      if (!/^[A-Za-z0-9_]+$/u.test(originId)) fail('originId');
      string(filename, 255, 'filename');
      if (/[\\/\r\n]/u.test(filename) || !/^.+\.[A-Za-z0-9]{1,16}$/u.test(filename)) fail('filename');
      string(title, 200, 'title');
      string(remarks, 200, 'remarks', { empty: true });
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > ILAB_MAX_REPORT_BYTES) fail('report.bytes');
      const data = await request('/open/api/v2/attachment_upload', { access_token: accessToken, appid, originId, filename, title, remarks }, { body: Buffer.from(bytes), contentType: 'application/octet-stream' });
      return { code: 0, id: string(String(data.id ?? ''), 200, 'id') };
    },
  });
}

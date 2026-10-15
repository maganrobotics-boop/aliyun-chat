import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createIlabClient, validateResult, IlabProtocolError, ILAB_TEST_ORIGIN, ILAB_PRODUCTION_ORIGIN, ILAB_MAX_REPORT_BYTES } from './protocol.mjs';

const NOW = 1_792_030_000_000;
const APPID = '10000';
const SECRET = 'unit_test_secret';
const ACCESS_TOKEN = 'private+token/value=';
const config = (fetcher, extra = {}) => ({ mode: 'mock', origin: ILAB_TEST_ORIGIN, appid: APPID, secret: SECRET, now: () => NOW, fetcher, ...extra });
const jsonResponse = (value, extra = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...extra });
const tokenData = () => ({ code: 0, access_token: ACCESS_TOKEN, create_time: NOW - 1000, expires_time: NOW + 100_000, un: 'student1', dis: '学生' });
const fixture = () => ({
  username: 'student1', title: '真实巡检实验', status: 1, score: 85,
  startTime: NOW - 60_000, endTime: NOW, timeUsed: 60, appid: APPID, originId: 'Exp_01',
  steps: Array.from({ length: 20 }, (_, index) => ({
    seq: index + 1, title: `步骤${index + 1}`, startTime: NOW - 60_000 + index * 2000,
    endTime: NOW - 59_000 + index * 2000, timeUsed: 1, expectTime: 2,
    maxScore: 5, score: 4, repeatCount: 1, evaluation: '已完成', scoringModel: '按任务指标评分', ext_data: { observed: true },
  })),
  ai_data: { ai_call_count: 1, ai_models_used: [{ model: 'local_model', version: '1', deployment: '本地运行' }], ai_usage_scenarios: ['智能导学'], ai_input_token_count: 10, ai_output_token_count: 3 },
});
const rejectsData = (change) => {
  const data = fixture();
  change(data);
  assert.throws(() => validateResult(data, { appid: APPID, username: 'student1', now: NOW }), (error) => error instanceof IlabProtocolError && error.code === 'ILAB_INVALID_DATA');
};

test('valid observations return an independent allowlisted copy and safe empty remarks', () => {
  const input = fixture();
  const result = validateResult(input, { appid: APPID, username: 'student1', now: NOW });
  assert.equal(result.steps[0].remarks, '');
  assert.equal(input.steps[0].remarks, undefined);
  result.steps[0].ext_data.observed = false;
  assert.equal(input.steps[0].ext_data.observed, true);
});

test('completed records require twenty observed steps by default; explicit official minimum is supported', () => {
  const record = fixture();
  record.steps = record.steps.slice(0, 10);
  assert.throws(() => validateResult(record, { now: NOW }));
  assert.equal(validateResult(record, { minimumSteps: 10, now: NOW }).steps.length, 10);
  record.steps = record.steps.slice(0, 9);
  assert.throws(() => validateResult(record, { minimumSteps: 10, now: NOW }));
});

test('incomplete checkpoints need no AI data and may have no steps', () => {
  const record = fixture();
  record.status = 2;
  record.steps = [];
  delete record.ai_data;
  assert.equal(validateResult(record, { now: NOW }).steps.length, 0);
});

test('origin, identity and app binding cannot be changed in payload', () => {
  rejectsData((value) => { value.originId = 'uuid-with-dashes'; });
  rejectsData((value) => { value.appid = '12345'; });
  rejectsData((value) => { value.username = 'other_student'; });
  rejectsData((value) => { value.appid = 10000; });
});

test('unknown top-level, step, AI and model fields are rejected', () => {
  rejectsData((value) => { value.secret = SECRET; });
  rejectsData((value) => { value.steps[0].unknown = true; });
  rejectsData((value) => { value.ai_data.prompt = 'private'; });
  rejectsData((value) => { value.ai_data.ai_models_used[0].key = SECRET; });
});

test('AI counters, model deployment and scenario strings are strict', () => {
  rejectsData((value) => { value.ai_data.ai_call_count = 1.5; });
  rejectsData((value) => { value.ai_data.ai_output_token_count = -1; });
  rejectsData((value) => { value.ai_data.ai_input_token_count = true; });
  rejectsData((value) => { value.ai_data.ai_models_used = []; });
  rejectsData((value) => { value.ai_data.ai_usage_scenarios = ['']; });
  rejectsData((value) => { value.ai_data.ai_usage_scenarios = [{}]; });
  rejectsData((value) => { value.ai_data.ai_models_used[0].deployment = 'cloud'; });
  rejectsData((value) => { delete value.ai_data.ai_models_used[0].version; });
  rejectsData((value) => { delete value.ai_data; });
});

test('zero actual AI calls allow empty arrays without inventing usage', () => {
  const record = fixture();
  record.ai_data = { ai_call_count: 0, ai_models_used: [], ai_usage_scenarios: [] };
  assert.deepEqual(validateResult(record, { now: NOW }).ai_data, record.ai_data);
});

test('timestamps, seconds, scores, repeats and sparse arrays must be valid observations', () => {
  rejectsData((value) => { value.score = 85.5; });
  rejectsData((value) => { value.timeUsed = 0; });
  rejectsData((value) => { value.steps[0].startTime = value.startTime - 1000; });
  rejectsData((value) => { value.steps[1].startTime = value.steps[0].startTime; value.steps[1].endTime = value.steps[0].endTime; });
  rejectsData((value) => { value.steps[0].timeUsed = 50; });
  rejectsData((value) => { value.steps[0].repeatCount = 0; });
  rejectsData((value) => { value.steps[0].score = 6; });
  rejectsData((value) => { value.steps[0].seq = 20; });
  rejectsData((value) => { value.steps[0].startTime = 1_700_000_000; });
  rejectsData((value) => { delete value.steps[2]; });
  rejectsData((value) => { value.ai_data.ai_models_used = new Array(1); });
});

test('extensions reject cycles, prototype keys and non-JSON values', () => {
  rejectsData((value) => { value.ext_data = { invalid: undefined }; });
  rejectsData((value) => { value.ext_data = new Date(); });
  rejectsData((value) => { value.ext_data = {}; value.ext_data.loop = value.ext_data; });
  rejectsData((value) => { value.ext_data = JSON.parse('{"__proto__":{"polluted":true}}'); });
  assert.equal({}.polluted, undefined);
});

test('production requires exact HTTPS origin, explicit boolean enable and a real course appid', () => {
  const fetcher = async () => jsonResponse({ code: 0 });
  for (const origin of ['https://evil.example', 'http://www.ilab-x.com', 'https://www.ilab-x.com.evil.example', 'https://www.ilab-x.com/path', 'https://user:pass@www.ilab-x.com', 'https://www.ilab-x.com/?token=private']) {
    assert.throws(() => createIlabClient(config(fetcher, { origin })), { code: 'ILAB_CONFIG' });
  }
  assert.throws(() => createIlabClient(config(fetcher, { mode: 'production', origin: ILAB_PRODUCTION_ORIGIN })), { code: 'ILAB_CONFIG' });
  assert.throws(() => createIlabClient(config(fetcher, { mode: 'production', origin: ILAB_PRODUCTION_ORIGIN, appid: '12345', allowProduction: 'true' })), { code: 'ILAB_CONFIG' });
  assert.throws(() => createIlabClient(config(fetcher, { mode: 'production', origin: ILAB_PRODUCTION_ORIGIN, allowProduction: true })), { code: 'ILAB_CONFIG' });
  assert.doesNotThrow(() => createIlabClient(config(fetcher, { mode: 'production', origin: ILAB_PRODUCTION_ORIGIN, appid: '12345', allowProduction: true })));
});

test('test mode stays on fixed HTTP sandbox; mock mode has no real-network fallback', () => {
  assert.throws(() => createIlabClient(config(undefined)), { code: 'ILAB_CONFIG' });
  assert.throws(() => createIlabClient(config(async () => {}, { mode: 'test', origin: ILAB_PRODUCTION_ORIGIN })), { code: 'ILAB_CONFIG' });
  assert.doesNotThrow(() => createIlabClient(config(async () => {}, { mode: 'test' })));
});

test('already decoded ticket is signed in uppercase and URL-encoded exactly once', async () => {
  let seen;
  const client = createIlabClient(config(async (url, options) => { seen = { url: new URL(url), options }; return jsonResponse(tokenData()); }));
  const ticket = 'ticket+value/end=';
  const result = await client.exchangeTicket(ticket);
  assert.equal(seen.url.pathname, '/open/api/v2/token');
  assert.equal(seen.url.searchParams.get('ticket'), ticket);
  assert.equal(seen.url.searchParams.get('signature'), createHash('md5').update(ticket + APPID + SECRET).digest('hex').toUpperCase());
  assert.equal(seen.options.redirect, 'error');
  assert.equal(result.un, 'student1');
  assert.equal(result.expires_time, tokenData().expires_time);
});

test('ticket containing literal percent or encoded-looking text is never decoded again', async () => {
  const observed = [];
  const client = createIlabClient(config(async (url) => { observed.push(new URL(url)); return jsonResponse(tokenData()); }));
  for (const original of ['ticket%value', 'ticket%2Fvalue', 'ticket%252Fvalue', 'ticket+%value=']) {
    const incoming = new URL('https://local.example/launch');
    incoming.searchParams.set('ticket', original);
    const decodedByHttpLayer = incoming.searchParams.get('ticket');
    await client.exchangeTicket(decodedByHttpLayer);
    const outgoing = observed.at(-1);
    assert.equal(outgoing.searchParams.get('ticket'), original);
    assert.equal(outgoing.searchParams.get('signature'), createHash('md5').update(original + APPID + SECRET).digest('hex').toUpperCase());
  }
});

test('refresh signs original token and does not expect identity fields', async () => {
  let seen;
  const client = createIlabClient(config(async (url) => { seen = new URL(url); const response = tokenData(); delete response.un; delete response.dis; return jsonResponse(response); }));
  const result = await client.refreshToken(ACCESS_TOKEN);
  assert.equal(seen.pathname, '/open/api/v2/token/refresh');
  assert.equal(seen.searchParams.get('access_token'), ACCESS_TOKEN);
  assert.equal(seen.searchParams.get('signature'), createHash('md5').update(ACCESS_TOKEN + APPID + SECRET).digest('hex').toUpperCase());
  assert.equal(result.access_token, ACCESS_TOKEN);
  assert.equal(result.un, undefined);
});

test('result upload sends JSON and validates before any network operation', async () => {
  let seen;
  let calls = 0;
  const client = createIlabClient(config(async (url, options) => { calls++; seen = { url: new URL(url), options }; return jsonResponse({ code: 0, id: '123' }); }));
  assert.deepEqual(await client.uploadResult(ACCESS_TOKEN, fixture()), { code: 0, id: '123' });
  assert.equal(seen.url.searchParams.get('access_token'), ACCESS_TOKEN);
  assert.equal(seen.options.headers['content-type'], 'application/json');
  assert.equal(JSON.parse(seen.options.body).steps.length, 20);
  const invalid = fixture(); invalid.originId = '../path';
  await assert.rejects(client.uploadResult(ACCESS_TOKEN, invalid), { code: 'ILAB_INVALID_DATA' });
  assert.equal(calls, 1);
});

test('report sends raw bytes with encoded filename and validates file bounds and paths', async () => {
  let seen;
  const client = createIlabClient(config(async (url, options) => { seen = { url: new URL(url), options }; return jsonResponse({ code: 0, id: 'report1' }); }));
  const report = { originId: 'Exp_01', filename: '实验报告.pdf', title: '真实实验报告', bytes: Buffer.from('%PDF-test') };
  assert.deepEqual(await client.uploadReport(ACCESS_TOKEN, report), { code: 0, id: 'report1' });
  assert.equal(seen.url.pathname, '/open/api/v2/attachment_upload');
  assert.equal(seen.url.searchParams.get('filename'), report.filename);
  assert.equal(seen.options.headers['content-type'], 'application/octet-stream');
  assert.deepEqual(seen.options.body, report.bytes);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(ILAB_MAX_REPORT_BYTES + 1), 'not bytes']) await assert.rejects(client.uploadReport(ACCESS_TOKEN, { ...report, bytes }), { code: 'ILAB_INVALID_DATA' });
  for (const filename of ['../report.pdf', 'C:\\report.pdf', 'report', 'report.pdf\r\nx']) await assert.rejects(client.uploadReport(ACCESS_TOKEN, { ...report, filename }), { code: 'ILAB_INVALID_DATA' });
});

test('upstream errors keep numeric codes but discard sensitive upstream messages', async () => {
  const client = createIlabClient(config(async () => jsonResponse({ code: 19, msg: `${ACCESS_TOKEN} ${SECRET}` })));
  await assert.rejects(client.uploadResult(ACCESS_TOKEN, fixture()), (error) => {
    assert.equal(error.upstreamCode, 19);
    assert.equal(error.code, 'ILAB_REMOTE_REJECTED');
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(JSON.stringify(error).includes(SECRET), false);
    return true;
  });
});

test('network exceptions and redirects cannot leak token-bearing URLs', async () => {
  const client = createIlabClient(config(async (url) => { throw new Error(url + SECRET); }));
  await assert.rejects(client.uploadResult(ACCESS_TOKEN, fixture()), (error) => error.code === 'ILAB_NETWORK_ERROR' && !error.stack.includes(SECRET) && !error.stack.includes(ACCESS_TOKEN));
  const redirectClient = createIlabClient(config(async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } })));
  await assert.rejects(redirectClient.exchangeTicket('ticket'), { code: 'ILAB_HTTP_ERROR' });
});

test('timeout aborts the request and is marked uncertain rather than safe to replay', async () => {
  const client = createIlabClient(config((_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error(ACCESS_TOKEN)), { once: true }); }), { timeoutMs: 5 }));
  await assert.rejects(client.uploadResult(ACCESS_TOKEN, fixture()), (error) => error.code === 'ILAB_TIMEOUT' && error.retryable === false && !error.message.includes(ACCESS_TOKEN));
});

test('response limits cover advertised and streamed bodies, and invalid JSON is safe', async () => {
  for (const response of [
    new Response('{}', { headers: { 'content-length': '999999' } }),
    new Response('x'.repeat(65_537)),
  ]) {
    const client = createIlabClient(config(async () => response));
    await assert.rejects(client.exchangeTicket('ticket'), { code: 'ILAB_RESPONSE_TOO_LARGE' });
  }
  const client = createIlabClient(config(async () => new Response(ACCESS_TOKEN)));
  await assert.rejects(client.exchangeTicket('ticket'), (error) => error.code === 'ILAB_BAD_RESPONSE' && !error.message.includes(ACCESS_TOKEN));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createIlabIntegration, signIlabEvent } from './integration.mjs';
import { validateResult } from './protocol.mjs';

// Every identity, timestamp, action, grade and AI call below is a synthetic
// fixture. These tests never access the real national platform or student data.
const START = 1_792_030_000_000;
const APPID = '999888';
const SECRET = 'synthetic_platform_secret';
const EVENT_SECRET = 'synthetic_backend_event_secret_at_least_32_bytes';
const PUBLIC = 'https://omindos.cn';
const APP = 'https://chat.omindos.cn';
const PREFIX = '/learning/ilab';
const EVENT_PATH = '/api/internal/ilab/events';
const jsonResponse = value => Response.json(value);
const md5 = value => createHash('md5').update(value).digest('hex').toUpperCase();

function harness(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ilab-runtime-fixture-'));
  const databasePath = join(directory, 'private', 'ilab.sqlite');
  let clock = START, runtime, sequence = 0, refreshes = 0;
  const calls = [];
  const env = {
    ILAB_ENABLED: 'true', ILAB_MODE: 'mock', ILAB_APPID: APPID,
    ILAB_SECRET: SECRET, ILAB_EVENT_SECRET: EVENT_SECRET,
    ILAB_STORAGE_KEY: randomBytes(32).toString('base64'),
    APP_ORIGIN: APP, ILAB_PUBLIC_ORIGIN: PUBLIC,
    ILAB_EXPERIMENT_PATH: '/learning/mine-inspection',
    ILAB_REQUIRED_STEPS: String(overrides.requiredSteps || 24),
    ...overrides.env,
  };
  async function fetcher(rawUrl, options) {
    const url = new URL(rawUrl);
    const call = { url, ...options };
    calls.push(call);
    assert.equal(url.origin, 'https://www.ilab-x.com');
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/open/api/v2/token') {
      const ticket = url.searchParams.get('ticket');
      assert.equal(url.searchParams.get('appid'), APPID);
      assert.equal(url.searchParams.get('signature'), md5(ticket + APPID + SECRET));
      return jsonResponse({ code: 0, un: `fixture_student_${ticket}`, dis: '模拟学生',
        access_token: `original_fixture_token_${ticket}`, create_time: clock,
        expires_time: clock + (overrides.tokenTtl || 3_600_000) });
    }
    if (url.pathname === '/open/api/v2/token/refresh') {
      refreshes++;
      if (overrides.refresh) return overrides.refresh(call, refreshes, clock);
      return jsonResponse({ code: 0, access_token: `refreshed_fixture_token_${refreshes}`,
        create_time: clock, expires_time: clock + (overrides.refreshTtl || 3_600_000) });
    }
    if (url.pathname === '/open/api/v2/data_upload') {
      if (overrides.result) return overrides.result(call);
      return jsonResponse({ code: 0, id: 'fixture_result_receipt' });
    }
    if (url.pathname === '/open/api/v2/attachment_upload') {
      if (overrides.report) return overrides.report(call);
      return jsonResponse({ code: 0, id: 'fixture_report_receipt' });
    }
    assert.fail(`Unexpected mock endpoint: ${url.pathname}`);
  }
  function open() { runtime = createIlabIntegration({ env, databasePath, fetcher, now: () => clock }); }
  open();
  t.after(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  const h = {
    env, calls, databasePath,
    get now() { return clock; },
    get runtime() { return runtime; },
    advance(ms) { clock += ms; },
    restart() { runtime.close(); open(); },
    pause() { runtime.close(); },
    resume() { open(); },
    request(path, { method = 'GET', cookie, headers = {}, body, origin = PUBLIC } = {}) {
      return runtime.handle(new Request(new URL(path, origin), {
        method, headers: { ...(cookie ? { cookie } : {}), ...headers },
        ...(body !== undefined ? { body } : {}),
      }));
    },
    async launch(ticket = `fixture_ticket_${++sequence}`) {
      const response = await h.request(`${PREFIX}/launch?ticket=${encodeURIComponent(ticket)}`);
      assert.equal(response.status, 303);
      const cookie = response.headers.get('set-cookie').split(';')[0];
      const sessionResponse = await h.request(`${PREFIX}/session`, { cookie });
      assert.equal(sessionResponse.status, 200);
      const session = await sessionResponse.json();
      return { cookie, ...session, response, ticket };
    },
    event(attemptId, type, data, options = {}) {
      const body = JSON.stringify({ attemptId, type, data });
      const headers = signIlabEvent(body, EVENT_SECRET, { timestamp: clock, ...options });
      return h.request(EVENT_PATH, { method: 'POST', body, headers });
    },
    write(owner, path, body = '{}', headers = {}) {
      return h.request(`${PREFIX}${path}`, { method: 'POST', cookie: owner.cookie, body,
        headers: { origin: PUBLIC, 'x-ilab-csrf': owner.csrfToken, ...headers } });
    },
    async steps(owner, count = Number(env.ILAB_REQUIRED_STEPS)) {
      for (let seq = 1; seq <= count; seq++) {
        const startTime = clock;
        h.advance(2000);
        const response = await h.event(owner.attemptId, 'step', {
          eventId: `fixture_step_${seq}`, source: 'synthetic_runtime_test', evidenceId: `fixture_observation_${seq}`,
          step: { seq, title: `模拟实验步骤${seq}`, startTime, endTime: clock, timeUsed: 2,
            expectTime: 3, maxScore: 5, score: 4, repeatCount: 1,
            evaluation: '模拟观测满足测试判据', scoringModel: 'synthetic_fixture_rubric_v1',
            ext_data: { fixture: true, observedMetric: seq / 10 } },
        });
        assert.equal(response.status, 200, await response.text());
      }
    },
    async complete(owner) {
      const response = await h.event(owner.attemptId, 'complete', {
        eventId: 'fixture_completion', source: 'synthetic_runtime_test', evidenceId: 'fixture_final_assessment',
        score: 85, completedAt: clock,
      });
      assert.equal(response.status, 200, await response.text());
    },
    async state(owner) {
      const response = await h.request(`${PREFIX}/session`, { cookie: owner.cookie });
      assert.equal(response.status, 200);
      return response.json();
    },
  };
  return h;
}

test('disabled runtime does not require credentials, fetch, or initialize a database', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ilab-disabled-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'must-not-be-created', 'ilab.sqlite');
  const runtime = createIlabIntegration({ databasePath: path, fetcher() { assert.fail('disabled network'); } });
  assert.equal(await runtime.handle(new Request(`${PUBLIC}/learning`)), null);
  assert.equal((await runtime.handle(new Request(`${PUBLIC}${PREFIX}/session`))).status, 503);
  assert.equal((await runtime.handle(new Request(`${APP}${EVENT_PATH}`, { method: 'POST' }))).status, 503);
  assert.equal(existsSync(path), false);
  runtime.close();
});

test('ticket exchange signs once and redirects with a scoped Secure HttpOnly cookie, without tokens', async t => {
  const h = harness(t);
  const ticket = 'fixture+ticket/value=';
  const owner = await h.launch(ticket);
  const cookie = owner.response.headers.get('set-cookie');
  assert.match(cookie, /^omind_ilab=[a-f0-9]{64}; Path=\/learning; HttpOnly; Secure; SameSite=Lax; Max-Age=86400$/u);
  assert.equal(owner.response.headers.get('location'), `${PUBLIC}/learning/mine-inspection?ilab=1`);
  assert.equal(owner.response.headers.get('cache-control'), 'no-store');
  assert.equal(owner.response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(h.calls[0].url.searchParams.get('ticket'), ticket);
  const exposed = JSON.stringify({ headers: [...owner.response.headers], ...await h.state(owner) });
  for (const privateValue of [SECRET, EVENT_SECRET, 'original_fixture_token_', 'access_token', 'fixture+ticket/value=']) {
    assert.equal(exposed.includes(privateValue), false);
  }
  const repeated = await h.request(`${PREFIX}/launch?ticket=${encodeURIComponent(ticket)}`);
  assert.equal(repeated.status, 409);
  assert.equal(h.calls.length, 1);
  assert.equal(readFileSync(h.databasePath).includes(Buffer.from(`original_fixture_token_${ticket}`)), false);
});

test('sessions isolate attempts and reject missing, duplicate, malformed or foreign-host cookies', async t => {
  const h = harness(t);
  const first = await h.launch(), second = await h.launch();
  assert.notEqual(first.attemptId, second.attemptId);
  const response = await h.request(`${PREFIX}/session?attemptId=${first.attemptId}`, { cookie: second.cookie });
  assert.equal((await response.json()).attemptId, second.attemptId);
  for (const cookie of [undefined, `${first.cookie}; ${second.cookie}`, 'omind_ilab=invalid', `omind_ilab=${'0'.repeat(64)}`]) {
    assert.equal((await h.request(`${PREFIX}/session`, { cookie })).status, 401);
  }
  assert.equal((await h.request(`${PREFIX}/session`, { cookie: first.cookie, origin: 'https://evil.example' })).status, 421);
  assert.equal((await h.request(`${PREFIX}/launch?ticket=a&ticket=b`)).status, 400);
});

test('browser writes require own CSRF and origin; browser cannot assign or complete grades', async t => {
  const h = harness(t), first = await h.launch(), second = await h.launch();
  assert.equal((await h.request(`${PREFIX}/submit`, { method: 'POST', cookie: first.cookie, body: '{}' })).status, 403);
  assert.equal((await h.write(first, '/submit', '{}', { 'x-ilab-csrf': second.csrfToken })).status, 403);
  assert.equal((await h.write(first, '/submit', '{}', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await h.write(first, '/submit', '{}', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await h.write(first, '/submit', '{"score":100}')).status, 400);
  assert.equal((await h.write(first, '/submit')).status, 409);
  assert.equal((await h.write(first, '/complete')).status, 404);
  const premature = await h.event(first.attemptId, 'complete', { eventId: 'early', source: 'synthetic_runtime_test', evidenceId: 'fixture', score: 100, completedAt: h.now });
  assert.equal(premature.status, 409);
  assert.equal((await h.state(first)).state, 'collecting');
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('data_upload')).length, 0);
});

test('trusted ingress verifies bytes, time and nonces; event idempotence never overwrites evidence', async t => {
  const h = harness(t), owner = await h.launch();
  h.advance(2000);
  const data = { eventId: 'fixture_ai_1', source: 'synthetic_runtime_test', evidenceId: 'fixture_call_1',
    model: 'fixture_model', version: 'v1', deployment: '本地运行', scenario: '模拟导学', inputTokens: 3, outputTokens: 4 };
  const body = JSON.stringify({ attemptId: owner.attemptId, type: 'ai', data });
  const headers = signIlabEvent(body, EVENT_SECRET, { timestamp: h.now, nonce: 'fixture_nonce_00000000001' });
  assert.equal((await h.request(EVENT_PATH, { method: 'POST', body, headers: { 'content-type': 'application/json' } })).status, 401);
  assert.equal((await h.request(EVENT_PATH, { method: 'POST', body: body.replace('模拟导学', '篡改导学'), headers })).status, 401);
  assert.equal((await h.request(EVENT_PATH, { method: 'POST', body, headers: { ...headers, origin: PUBLIC } })).status, 403);
  assert.equal((await h.event(owner.attemptId, 'ai', data, { timestamp: h.now - 300_001 })).status, 401);
  const accepted = await h.request(EVENT_PATH, { method: 'POST', body, headers });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).idempotent, false);
  assert.equal((await h.request(EVENT_PATH, { method: 'POST', body, headers })).status, 409);
  const duplicate = await h.event(owner.attemptId, 'ai', data);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).idempotent, true);
  assert.equal((await h.event(owner.attemptId, 'ai', { ...data, outputTokens: 100 })).status, 409);
  assert.equal((await h.state(owner)).aiCallCount, 1);
});

for (const count of [20, 24]) {
  test(`${count} timestamped synthetic steps and trusted completion produce a validated final payload`, async t => {
    const h = harness(t, { requiredSteps: count }), owner = await h.launch();
    await h.steps(owner);
    assert.equal((await h.write(owner, '/submit')).status, 409);
    await h.complete(owner);
    const preview = await h.request(`${PREFIX}/preview`, { cookie: owner.cookie });
    assert.equal(preview.status, 200);
    const { payload } = await preview.json();
    assert.equal(payload.steps.length, count);
    assert.equal(payload.score, 85);
    assert.equal(payload.startTime, START);
    assert.equal(payload.endTime, START + count * 2000);
    assert.equal(payload.timeUsed, count * 2);
    assert.equal(payload.status, 1);
    assert.equal(payload.steps[0].ext_data.evidence_source, 'synthetic_runtime_test');
    assert.deepEqual(validateResult(payload, { appid: APPID, minimumSteps: count, now: h.now }), payload);
    const response = await h.write(owner, '/submit');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'sent');
    const calls = h.calls.filter(call => call.url.pathname.endsWith('data_upload'));
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].body), payload);
    assert.equal((await h.write(owner, '/submit')).status, 200);
    assert.equal(h.calls.filter(call => call.url.pathname.endsWith('data_upload')).length, 1);
  });
}

test('AI metadata aggregates actual signed fixture calls and omits unknowable token totals', async t => {
  const h = harness(t), owner = await h.launch();
  for (const [index, scenario] of ['模拟导学', '模拟评估'].entries()) {
    const response = await h.event(owner.attemptId, 'ai', {
      eventId: `fixture_ai_${index}`, source: 'synthetic_runtime_test', evidenceId: `fixture_llm_receipt_${index}`,
      model: 'fixture_model', version: 'v1', deployment: '本地运行', provider: 'synthetic provider',
      scenario, inputTokens: 10 + index, ...(index === 0 ? { outputTokens: 5 } : {}),
    });
    assert.equal(response.status, 200);
  }
  const invalid = await h.event(owner.attemptId, 'ai', { eventId: 'bad_ai', source: 'synthetic_runtime_test', evidenceId: 'fixture', model: 'fixture_model', version: 'v1', deployment: '本地运行', scenario: '模拟导学', prompt: 'must not persist prompts' });
  assert.equal(invalid.status, 400);
  await h.steps(owner);
  await h.complete(owner);
  const { payload } = await (await h.request(`${PREFIX}/preview`, { cookie: owner.cookie })).json();
  assert.deepEqual(payload.ai_data, { ai_call_count: 2,
    ai_models_used: [{ model: 'fixture_model', version: 'v1', deployment: '本地运行', provider: 'synthetic provider' }],
    ai_usage_scenarios: ['模拟导学', '模拟评估'], ai_input_token_count: 21 });
  assert.equal(Object.hasOwn(payload.ai_data, 'ai_output_token_count'), false);
  assert.deepEqual(validateResult(payload, { appid: APPID, now: h.now }), payload);
});

test('concurrent final submissions reserve state before sending, so only one payload leaves the runtime', async t => {
  let release, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const h = harness(t, { result: () => { entered(); return new Promise(resolve => { release = () => resolve(jsonResponse({ code: 0, id: 'fixture_one_delivery' })); }); } });
  const owner = await h.launch();
  await h.steps(owner); await h.complete(owner);
  const first = h.write(owner, '/submit');
  await reached;
  assert.equal((await h.write(owner, '/submit')).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('data_upload')).length, 1);
});

test('report bytes are private until result receipt; report uploads raw bytes once and after results', async t => {
  const h = harness(t), owner = await h.launch();
  const pdf = Buffer.from('%PDF-1.7\nsynthetic test fixture only\n%%EOF');
  const saved = await h.write(owner, '/report?filename=fixture-report.pdf', pdf, { 'content-type': 'application/pdf' });
  assert.equal(saved.status, 200);
  assert.equal((await h.write(owner, '/report/submit', '')).status, 409);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('attachment_upload')).length, 0);
  assert.equal((await h.write(owner, '/report?filename=fixture-report.pdf', Buffer.from('not a PDF'), { 'content-type': 'application/pdf' })).status, 400);
  await h.steps(owner); await h.complete(owner);
  assert.equal((await h.write(owner, '/submit')).status, 200);
  const uploads = h.calls.filter(call => call.url.pathname.endsWith('_upload'));
  assert.deepEqual(uploads.map(call => call.url.pathname), ['/open/api/v2/data_upload', '/open/api/v2/attachment_upload']);
  assert.equal(uploads[1].headers['content-type'], 'application/octet-stream');
  assert.equal(uploads[1].url.searchParams.get('originId'), owner.attemptId);
  assert.deepEqual(Buffer.from(uploads[1].body), pdf);
  assert.equal((await h.state(owner)).reportState, 'sent');
  assert.equal((await h.write(owner, '/report/submit', '')).status, 200);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('attachment_upload')).length, 1);
  assert.equal((await h.write(owner, '/report?filename=fixture-report.pdf', pdf, { 'content-type': 'application/pdf' })).status, 409);
});

test('lost network reply is uncertain across restarts and never blindly retried', async t => {
  const h = harness(t, { result: () => { throw new Error('synthetic lost reply with private upstream URL'); } }), owner = await h.launch();
  await h.steps(owner); await h.complete(owner);
  assert.equal((await h.write(owner, '/submit')).status, 502);
  assert.equal((await h.state(owner)).state, 'uncertain');
  assert.equal((await h.write(owner, '/submit')).status, 409);
  h.restart();
  assert.equal((await h.state(owner)).state, 'uncertain');
  assert.equal((await h.write(owner, '/submit')).status, 409);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('data_upload')).length, 1);
});

test('actual request timeout aborts the mock transport and leaves delivery uncertain', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const h = harness(t, { result: ({ signal }) => {
    entered();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('synthetic transport aborted')), { once: true }));
  } });
  const owner = await h.launch();
  await h.steps(owner); await h.complete(owner);
  const pending = h.write(owner, '/submit');
  await reached;
  t.mock.timers.tick(10_001);
  assert.equal((await pending).status, 502);
  assert.equal((await h.state(owner)).state, 'uncertain');
  assert.equal((await h.write(owner, '/submit')).status, 409);
});

test('persisted interrupted result and report deliveries recover to uncertain', async t => {
  const h = harness(t), owner = await h.launch();
  await h.steps(owner); await h.complete(owner);
  h.pause();
  // Deliberately persist a crash fixture, rather than leaving a live network task.
  const db = new DatabaseSync(h.databasePath);
  db.prepare("UPDATE ilab_attempts SET state = 'submitting', report_state = 'submitting' WHERE id = ?").run(owner.attemptId);
  db.close();
  h.resume();
  const state = await h.state(owner);
  assert.equal(state.state, 'uncertain');
  assert.equal(state.reportState, 'uncertain');
  assert.equal((await h.write(owner, '/submit')).status, 409);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('_upload')).length, 0);
});

test('explicit result rejections allow controlled retries but token refresh is capped and always signs original token', async t => {
  const h = harness(t, { tokenTtl: 1000, refreshTtl: 1000, result: () => jsonResponse({ code: 19, msg: 'synthetic rejection' }) });
  const owner = await h.launch();
  await h.steps(owner); await h.complete(owner);
  for (let index = 0; index < 2; index++) {
    assert.equal((await h.write(owner, '/submit')).status, 502);
    const state = await h.state(owner);
    assert.equal(state.state, 'rejected');
    assert.equal(String(state.platformCode), '19');
  }
  assert.equal((await h.write(owner, '/submit')).status, 401);
  const refreshes = h.calls.filter(call => call.url.pathname.endsWith('/refresh'));
  assert.equal(refreshes.length, 2);
  const originalToken = `original_fixture_token_${owner.ticket}`;
  for (const call of refreshes) {
    assert.equal(call.url.searchParams.get('access_token'), originalToken);
    assert.equal(call.url.searchParams.get('signature'), md5(originalToken + APPID + SECRET));
  }
  const resultCalls = h.calls.filter(call => call.url.pathname.endsWith('data_upload'));
  assert.deepEqual(resultCalls.map(call => call.url.searchParams.get('access_token')), ['refreshed_fixture_token_1', 'refreshed_fixture_token_2']);
  assert.equal((await h.state(owner)).state, 'rejected');
});

test('duplicate-platform rejection requires reconciliation instead of automatic replay', async t => {
  const h = harness(t, { result: () => jsonResponse({ code: 15, msg: 'synthetic duplicate' }) }), owner = await h.launch();
  await h.steps(owner); await h.complete(owner);
  assert.equal((await h.write(owner, '/submit')).status, 502);
  assert.equal((await h.state(owner)).state, 'uncertain');
  assert.equal((await h.write(owner, '/submit')).status, 409);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('data_upload')).length, 1);
});

test('slow report upload rechecks current state after reading and cannot overwrite a sent report', async t => {
  const h = harness(t), owner = await h.launch();
  await h.steps(owner); await h.complete(owner);
  assert.equal((await h.write(owner, '/submit')).status, 200);
  const original = Buffer.from('%PDF-1.7\noriginal synthetic report fixture\n%%EOF');
  const replacement = Buffer.from('%PDF-1.7\nlate synthetic replacement fixture\n%%EOF');
  assert.equal((await h.write(owner, '/report?filename=original-fixture.pdf', original, { 'content-type': 'application/pdf' })).status, 200);
  let controller;
  const slowBody = new ReadableStream({ start(value) { controller = value; } });
  const slowRequest = h.runtime.handle(new Request(`${PUBLIC}${PREFIX}/report?filename=late-fixture.pdf`, {
    method: 'POST', headers: { cookie: owner.cookie, origin: PUBLIC,
      'x-ilab-csrf': owner.csrfToken, 'content-type': 'application/pdf' },
    body: slowBody, duplex: 'half',
  }));
  controller.enqueue(replacement.subarray(0, 5));
  // Allow the handler to capture its initial session and block on the PDF body.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.write(owner, '/report/submit', '')).status, 200);
  assert.equal((await h.state(owner)).reportState, 'sent');
  controller.enqueue(replacement.subarray(5));
  controller.close();
  assert.equal((await slowRequest).status, 409);
  assert.equal((await h.state(owner)).reportState, 'sent');
  const db = new DatabaseSync(h.databasePath);
  try {
    const row = db.prepare('SELECT report_bytes, report_meta_json, report_state FROM ilab_attempts WHERE id = ?').get(owner.attemptId);
    assert.deepEqual(Buffer.from(row.report_bytes), original);
    assert.equal(JSON.parse(row.report_meta_json).filename, 'original-fixture.pdf');
    assert.equal(row.report_state, 'sent');
  } finally { db.close(); }
  assert.equal((await h.write(owner, '/report/submit', '')).status, 200);
  const reports = h.calls.filter(call => call.url.pathname.endsWith('attachment_upload'));
  assert.equal(reports.length, 1);
  assert.deepEqual(Buffer.from(reports[0].body), original);
});

test('unknown platform code stays uncertain across restart and cannot trigger a blind retry', async t => {
  const h = harness(t, { result: () => jsonResponse({ code: 99, msg: 'synthetic undocumented platform status' }) });
  const owner = await h.launch();
  await h.steps(owner); await h.complete(owner);
  assert.equal((await h.write(owner, '/submit')).status, 502);
  assert.equal((await h.state(owner)).state, 'uncertain');
  assert.equal(String((await h.state(owner)).platformCode), '99');
  assert.equal((await h.write(owner, '/submit')).status, 409);
  h.restart();
  assert.equal((await h.state(owner)).state, 'uncertain');
  assert.equal((await h.write(owner, '/submit')).status, 409);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('data_upload')).length, 1);
});

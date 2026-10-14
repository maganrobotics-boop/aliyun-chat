import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/app.mjs';
import { D1DatabaseAdapter } from './d1-adapter.mjs';
import { OA_ADMIN_ORIGIN, OA_ADMIN_PATH, signOaAdminRequest } from '../src/oa-admin-bridge.mjs';
import { resolveSubtitleProvider } from '../src/subtitle-provider-config.mjs';

const secret = 'test-admin-service-secret-that-is-long-enough';
const candidate = { baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1', model: 'qwen3.8-livetranslate-flash-realtime', apiKey: 'sk-ws-H.synthetic-admin' };

async function setup(t) {
  const db = new D1DatabaseAdapter(); t.after(() => db.close());
  const calls = [];
  const env = { DB: db, APP_ORIGIN: OA_ADMIN_ORIGIN, ADMIN_EMAIL: 'owner@example.test',
    APP_ENCRYPTION_KEY: 'e'.repeat(48), RATE_LIMIT_HMAC_KEY: 'r'.repeat(48), PUBLIC_LAB_AI_SERVICE_TOKEN: secret,
    SUBTITLE_PROVIDER_TEST: async config => { calls.push(config); return { connected: true }; } };
  const request = async payload => {
    const body = JSON.stringify(payload);
    return handleRequest(new Request(OA_ADMIN_ORIGIN + OA_ADMIN_PATH, {
      method: 'POST', body, headers: await signOaAdminRequest(body, secret),
    }), env, {});
  };
  const login = await (await request({ operation: 'set_password', password: 'synthetic admin password', actor: 'test-admin' })).json();
  return { db, env, calls, request, token: login.sessionToken };
}

test('OA speech setup requires an admin session and never exposes its secret', async t => {
  const { db, env, calls, request, token } = await setup(t);
  const textConfig = JSON.stringify({ baseUrl: 'https://token-plan.example', encryptedKey: 'existing-chat-config' });
  db.sqlite.prepare('INSERT INTO settings(id,value) VALUES (?,?)').run('model', textConfig);
  const unauthorized = await request({ operation: 'subtitle_config_save', sessionToken: 'a'.repeat(64), ...candidate });
  assert.equal(unauthorized.status, 401); assert.equal(calls.length, 0);
  const response = await request({ operation: 'subtitle_config_save', sessionToken: token, ...candidate });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.subtitleProvider.keyConfigured, true);
  assert.ok(result.subtitleProvider.verifiedAt);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-admin|encryptedKey/);
  const stored = db.sqlite.prepare("SELECT value FROM settings WHERE id='subtitles-provider'").get().value;
  assert.doesNotMatch(stored, /synthetic-admin/);
  assert.deepEqual(await resolveSubtitleProvider(env), candidate);
  assert.equal(db.sqlite.prepare("SELECT value FROM settings WHERE id='model'").get().value, textConfig);
  const status = await (await request({ operation: 'status', sessionToken: token })).json();
  assert.equal(status.subtitleProvider.keyConfigured, true);
  assert.doesNotMatch(JSON.stringify(status), /synthetic-admin|encryptedKey/);
  assert.equal((await (await request({ operation: 'status' })).json()).subtitleProvider, undefined);
  const { apiKey, ...withoutKey } = candidate;
  assert.equal((await request({ operation: 'subtitle_config_save', sessionToken: token, ...withoutKey })).status, 200);
  assert.equal(calls.at(-1).apiKey, apiKey);
  assert.equal((await request({ operation: 'subtitle_config_test', sessionToken: token })).status, 200);
});

test('invalid speech inputs and a failed verification preserve the last saved config', async t => {
  const { db, env, calls, request, token } = await setup(t);
  assert.equal((await request({ operation: 'subtitle_config_save', sessionToken: token, ...candidate })).status, 200);
  const before = db.sqlite.prepare("SELECT value FROM settings WHERE id='subtitles-provider'").get().value;
  for (const changes of [{ apiKey: 'sk-sp-synthetic' }, { baseUrl: 'https://token-plan.maas.qianwenaiapi.com' },
    { baseUrl: 'https://maas.qianwenaiapi.com.evil.example' }, { apiKey: 'sk-ws-H.bad\r\nheader' }]) {
    const response = await request({ operation: 'subtitle_config_save', sessionToken: token, ...candidate, ...changes });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 1);
  env.SUBTITLE_PROVIDER_TEST = async () => { throw new Error('provider echoed private secret'); };
  const failed = await request({ operation: 'subtitle_config_save', sessionToken: token, ...candidate, apiKey: 'sk-ws-H.replacement' });
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private secret|replacement/);
  assert.equal(db.sqlite.prepare("SELECT value FROM settings WHERE id='subtitles-provider'").get().value, before);
});

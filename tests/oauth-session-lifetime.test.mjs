import assert from 'node:assert/strict';
import test from 'node:test';
import { OAUTH_SESSION_IDLE_MAX_AGE_MS, OAUTH_SESSION_MAX_AGE_SECONDS } from '../lib/oauth-session.ts';

test('OA OAuth login remains valid for the requested seven-day window', () => {
  assert.equal(OAUTH_SESSION_MAX_AGE_SECONDS, 7 * 24 * 60 * 60);
  assert.equal(OAUTH_SESSION_IDLE_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000);
});

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createIlabStore } from './store.mjs';

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'omindos-ilab-store-'));
  const databasePath = join(directory, 'private', 'ilab.sqlite');
  const storageKey = randomBytes(32);
  const store = createIlabStore({ databasePath, storageKey, ...options });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, databasePath, storageKey, store };
}

function attempt(overrides = {}) {
  return {
    id: 'attempt-1', sessionHash: 'session-hash-1', ticketHash: 'ticket-hash-1',
    username: 'learner-1', displayName: '学生一',
    tokens: { accessToken: 'secret-access-token-that-must-stay-encrypted', refreshToken: 'secret-refresh-token' },
    createdAt: 1000, expiresAt: 3_601_000, ...overrides,
  };
}

test('credentials round trip encrypted, files remain private, and caller key is not cleared', (t) => {
  const { directory, databasePath, storageKey, store } = fixture(t);
  const originalKey = Buffer.from(storageKey);
  const input = attempt();
  const stored = store.createAttempt(input);
  assert.deepEqual(stored.tokens, input.tokens);
  assert.equal(stored.state, 'collecting');
  assert.equal(stored.reportState, 'none');
  assert.deepEqual(stored.steps, []);
  assert.deepEqual(stored.aiCalls, []);
  assert.equal(statSync(join(directory, 'private')).mode & 0o777, 0o700);
  assert.equal(statSync(databasePath).mode & 0o777, 0o600);
  for (const filename of readdirSync(join(directory, 'private'))) {
    const bytes = readFileSync(join(directory, 'private', filename));
    assert.equal(bytes.includes(input.tokens.accessToken), false, `${filename} contains a plaintext access token`);
    assert.equal(bytes.includes(input.tokens.refreshToken), false, `${filename} contains a plaintext refresh token`);
  }
  store.close();
  assert.deepEqual(storageKey, originalKey);
  store.close();
});

test('session and ticket uniqueness isolate users and attempts', (t) => {
  const { store } = fixture(t);
  store.createAttempt(attempt());
  const second = attempt({ id: 'attempt-2', sessionHash: 'session-hash-2', ticketHash: 'ticket-hash-2', username: 'learner-2', tokens: { accessToken: 'second-user-token' } });
  store.createAttempt(second);
  assert.equal(store.bySessionHash('session-hash-1').username, 'learner-1');
  assert.deepEqual(store.bySessionHash('session-hash-2').tokens, second.tokens);
  assert.equal(store.bySessionHash('unknown'), null);
  assert.equal(store.get('unknown'), null);
  assert.equal(store.ticketUsed('ticket-hash-1'), true);
  assert.equal(store.ticketUsed('unused-ticket'), false);
  for (const values of [
    { id: 'new', sessionHash: 'session-hash-1', ticketHash: 'new-ticket' },
    { id: 'new', sessionHash: 'new-session', ticketHash: 'ticket-hash-1' },
    { id: 'attempt-1', sessionHash: 'new-session', ticketHash: 'new-ticket' },
  ]) {
    assert.throws(() => store.createAttempt(attempt(values)), { statusCode: 409 });
  }
});

test('event application is atomic and duplicate IDs are bound to their original body', (t) => {
  const { store } = fixture(t);
  store.createAttempt(attempt());
  let mutations = 0;
  const mutate = (current) => {
    mutations += 1;
    return { steps: [...current.steps, { step: 1, score: 10 }] };
  };
  const first = store.applyEvent('attempt-1', 'event-1', 'body-1', mutate);
  assert.equal(first.idempotent, false);
  assert.deepEqual(first.attempt.steps, [{ step: 1, score: 10 }]);
  const repeated = store.applyEvent('attempt-1', 'event-1', 'body-1', mutate);
  assert.equal(repeated.idempotent, true);
  assert.equal(mutations, 1);
  assert.throws(() => store.applyEvent('attempt-1', 'event-1', 'changed-body', mutate), { statusCode: 409 });
  assert.equal(mutations, 1);
  store.patch('attempt-1', { state: 'ready' });
  assert.equal(store.applyEvent('attempt-1', 'event-1', 'body-1', mutate).idempotent, true);
  assert.throws(() => store.applyEvent('attempt-1', 'event-2', 'body-2', mutate), { statusCode: 409 });
  assert.throws(() => store.applyEvent('unknown', 'event-2', 'body-2', mutate), { statusCode: 404 });
});

test('failed mutation or invalid patch rolls back both the event and attempt changes', (t) => {
  const { store } = fixture(t);
  store.createAttempt(attempt());
  assert.throws(() => store.applyEvent('attempt-1', 'event-1', 'body-1', (current) => {
    current.steps.push({ step: 99 });
    throw new Error('validation failed');
  }), /validation failed/);
  assert.deepEqual(store.get('attempt-1').steps, []);
  assert.throws(() => store.applyEvent('attempt-1', 'event-1', 'body-1', () => ({ steps: [{ step: 1 }], username: 'hijack' })), { statusCode: 400 });
  assert.deepEqual(store.get('attempt-1').steps, []);
  assert.throws(() => store.applyEvent('attempt-1', 'event-1', 'body-1', async () => ({ steps: [] })), { statusCode: 400 });
  const recovered = store.applyEvent('attempt-1', 'event-1', 'body-1', () => ({ steps: [{ step: 1 }] }));
  assert.equal(recovered.idempotent, false);
  assert.deepEqual(recovered.attempt.steps, [{ step: 1 }]);
});

test('the same event ID can be used by separate attempts', (t) => {
  const { store } = fixture(t);
  store.createAttempt(attempt());
  store.createAttempt(attempt({ id: 'attempt-2', sessionHash: 'session-2', ticketHash: 'ticket-2' }));
  assert.equal(store.applyEvent('attempt-1', 'event-1', 'body-1', () => ({ steps: [{ step: 1 }] })).idempotent, false);
  assert.equal(store.applyEvent('attempt-2', 'event-1', 'body-2', () => ({ steps: [{ step: 2 }] })).idempotent, false);
  assert.deepEqual(store.get('attempt-1').steps, [{ step: 1 }]);
  assert.deepEqual(store.get('attempt-2').steps, [{ step: 2 }]);
});

test('compare and set prevents two delivery claims and keeps report state independent', (t) => {
  const { store } = fixture(t);
  store.createAttempt(attempt());
  assert.equal(store.compareAndSetState('attempt-1', ['ready'], 'submitting'), false);
  assert.equal(store.compareAndSetState('attempt-1', ['collecting', 'ready'], 'submitting'), true);
  assert.equal(store.compareAndSetState('attempt-1', ['collecting', 'ready'], 'submitting'), false);
  assert.equal(store.compareAndSetReportState('attempt-1', ['none'], 'pending'), true);
  assert.equal(store.compareAndSetReportState('attempt-1', ['pending'], 'submitting'), true);
  assert.equal(store.compareAndSetReportState('attempt-1', ['pending'], 'submitting'), false);
  assert.equal(store.compareAndSetState('missing', ['collecting'], 'ready'), false);
  assert.throws(() => store.compareAndSetState('attempt-1', [], 'sent'), { statusCode: 400 });
  assert.throws(() => store.compareAndSetReportState('attempt-1', ['pending'], 'invalid'), { statusCode: 400 });
});

test('restart marks in-flight sends uncertain and preserves their result and report evidence', (t) => {
  const { databasePath, storageKey, store } = fixture(t);
  store.createAttempt(attempt());
  store.patch('attempt-1', {
    state: 'submitting', result: { score: 82 }, resultHash: 'result-hash', receipt: { code: 0 },
    aiCalls: [{ model: 'model-a', count: 1 }], errorCode: 'timeout',
    reportBytes: Buffer.from('%PDF-test'), reportMeta: { filename: 'report.pdf' },
    reportState: 'submitting', reportReceipt: { code: 0 },
  });
  store.close();
  const reopened = createIlabStore({ databasePath, storageKey });
  t.after(() => reopened.close());
  const recovered = reopened.get('attempt-1');
  assert.equal(recovered.state, 'uncertain');
  assert.equal(recovered.reportState, 'uncertain');
  assert.deepEqual(recovered.result, { score: 82 });
  assert.equal(recovered.resultHash, 'result-hash');
  assert.deepEqual(recovered.receipt, { code: 0 });
  assert.deepEqual(recovered.reportBytes, Buffer.from('%PDF-test'));
  assert.deepEqual(recovered.reportMeta, { filename: 'report.pdf' });
  assert.deepEqual(recovered.aiCalls, [{ model: 'model-a', count: 1 }]);
  assert.deepEqual(recovered.reportReceipt, { code: 0 });
  assert.equal(recovered.errorCode, 'timeout');
});

test('nonce replay is rejected during its window and old entries are pruned', (t) => {
  let clock = 1_000_000;
  const { store } = fixture(t, { now: () => clock });
  assert.equal(store.useNonce('nonce-a', clock), true);
  assert.equal(store.useNonce('nonce-a', clock), false);
  assert.equal(store.useNonce('nonce-b'), true);
  clock += 10 * 60 * 1000;
  assert.equal(store.useNonce('nonce-a'), false);
  clock += 1;
  assert.equal(store.useNonce('nonce-a'), true);
  assert.equal(store.useNonce('nonce-a'), false);
});

test('credential authentication rejects wrong keys and copied credential envelopes', (t) => {
  const { databasePath, storageKey, store } = fixture(t);
  store.createAttempt(attempt());
  store.createAttempt(attempt({ id: 'attempt-2', sessionHash: 'session-2', ticketHash: 'ticket-2' }));
  store.close();
  const wrongKeyStore = createIlabStore({ databasePath, storageKey: randomBytes(32) });
  assert.throws(() => wrongKeyStore.get('attempt-1'), { message: 'Stored iLAB credentials could not be decrypted', statusCode: 500 });
  wrongKeyStore.close();
  const raw = new DatabaseSync(databasePath);
  raw.exec("UPDATE ilab_attempts SET token_box = (SELECT token_box FROM ilab_attempts WHERE id = 'attempt-1') WHERE id = 'attempt-2'");
  raw.close();
  const reopened = createIlabStore({ databasePath, storageKey });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.get('attempt-1').tokens, attempt().tokens);
  assert.throws(() => reopened.get('attempt-2'), { statusCode: 500 });
});

test('database symlinks are rejected and existing database permissions are tightened', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'omindos-ilab-path-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = join(directory, 'target.sqlite');
  const link = join(directory, 'link.sqlite');
  writeFileSync(target, '');
  symlinkSync(target, link);
  assert.throws(() => createIlabStore({ databasePath: link, storageKey: randomBytes(32) }), /symbolic links/);
  const directoryLink = join(directory, 'linked-directory');
  symlinkSync(directory, directoryLink);
  assert.throws(() => createIlabStore({ databasePath: join(directoryLink, 'nested.sqlite'), storageKey: randomBytes(32) }), /symbolic links/);
  chmodSync(target, 0o666);
  const store = createIlabStore({ databasePath: target, storageKey: randomBytes(32) });
  store.close();
  assert.equal(statSync(target).mode & 0o777, 0o600);
});

test('invalid keys, timestamps, array fields and unknown patch fields fail closed', (t) => {
  assert.throws(() => createIlabStore({ databasePath: ':memory:', storageKey: Buffer.alloc(31) }), { statusCode: 400 });
  assert.throws(() => createIlabStore({ storageKey: randomBytes(32) }), { statusCode: 400 });
  const store = createIlabStore({ databasePath: ':memory:', storageKey: randomBytes(32) });
  t.after(() => store.close());
  assert.throws(() => store.createAttempt(attempt({ expiresAt: 1000 })), { statusCode: 400 });
  store.createAttempt(attempt());
  assert.throws(() => store.patch('attempt-1', { steps: {} }), { statusCode: 400 });
  assert.throws(() => store.patch('attempt-1', { aiCalls: {} }), { statusCode: 400 });
  assert.throws(() => store.patch('attempt-1', { reportBytes: 'not-bytes' }), { statusCode: 400 });
  assert.throws(() => store.patch('attempt-1', { state: 'invalid' }), { statusCode: 400 });
  assert.throws(() => store.patch('attempt-1', { sessionHash: 'other-session' }), { statusCode: 400 });
  assert.throws(() => store.patch('missing', { state: 'ready' }), { statusCode: 404 });
  assert.throws(() => store.useNonce(''), { statusCode: 400 });
});

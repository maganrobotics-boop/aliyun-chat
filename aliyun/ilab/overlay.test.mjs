import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { installOverlay, renderOverlay } from '../../scripts/install-ilab-overlay.mjs';

const server = `import http from 'node:http';
const env = process.env;
const database = {close(){}};
// Separate AI store and sessions; no changes to currentVisitor or the human DB.
const sendResponse = async (outgoing, response) => {outgoing.response = response;};
const webRequest = async incoming => new Request(new URL(incoming.url || '/', 'https://omindos.cn'));
const server = http.createServer(async (incoming, outgoing) => {
  const lifecycle = {signal:undefined};
    const request = await webRequest(incoming, lifecycle.signal);
  await sendResponse(outgoing, new Response(request.url));
});
function shutdown() {
    database.close();
}
`;

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ilab-overlay-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'stage');
  const runtimeRoot = path.join(directory, 'source');
  await fs.mkdir(path.join(target, 'aliyun', 'learning'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'aliyun', 'ilab'), { recursive: true });
  await fs.writeFile(path.join(target, 'aliyun', 'chat-server.mjs'), server);
  await fs.writeFile(path.join(target, 'aliyun', 'learning', 'service.mjs'), 'production learning code kept exactly\n');
  await fs.writeFile(path.join(runtimeRoot, 'aliyun', 'ilab', 'integration.mjs'), 'export const createIlabIntegration = () => ({handle:async()=>null,close(){}});\n');
  await fs.writeFile(path.join(runtimeRoot, 'aliyun', 'ilab', 'ignored.test.mjs'), 'throw new Error("must not copy tests");\n');
  return { directory, target, runtimeRoot, backupDir: path.join(directory, 'backup') };
}

test('overlay inserts a single import, initialization, early request dispatch, and shutdown close', () => {
  const output = renderOverlay(server);
  assert.match(output, /databasePath: process\.env\.ILAB_SQLITE_PATH/);
  assert.match(output, /const request = await webRequest[^\n]+;\n    \/\/ BEGIN ORIGINMIND_ILAB_OVERLAY REQUEST/);
  assert.match(output, /ilabIntegration\?\.close\(\);[\s\S]+database\.close\(\);/);
  assert.equal(renderOverlay(output), output);
});

test('generated overlay preserves existing routes when initialization fails and hides the cause', async t => {
  const data = await fixture(t);
  const filename = path.join(data.target, 'aliyun', 'chat-server.mjs');
  await fs.mkdir(path.join(data.target, 'aliyun', 'ilab'));
  await fs.writeFile(path.join(data.target, 'aliyun', 'ilab', 'integration.mjs'), 'export function createIlabIntegration(){throw new Error("SECRET_CREDENTIAL_DETAIL");}\n');
  const generated = renderOverlay(server) + `\nexport const dispatch = server.listeners('request')[0];\nexport {shutdown};\n`;
  // Capture only this module's startup diagnostics; no global console patching.
  await fs.writeFile(filename, `const diagnostics=[]; const console={error:message=>diagnostics.push(message)};\n${generated}\nexport {diagnostics};\n`);
  const module = await import(pathToFileURL(filename));
  assert.equal(module.diagnostics.length, 1);
  assert.doesNotMatch(module.diagnostics.join(''), /SECRET_CREDENTIAL_DETAIL/);
  for (const url of ['/', '/learning', '/api/learning/state', '/learning/ilab-other']) {
    const outgoing = {};
    await module.dispatch({ url }, outgoing);
    assert.equal(outgoing.response.status, 200);
    assert.equal(await outgoing.response.text(), `https://omindos.cn${url}`);
  }
  for (const url of ['/learning/ilab', '/learning/ilab/session', '/api/internal/ilab/events']) {
    const outgoing = {};
    await module.dispatch({ url }, outgoing);
    assert.equal(outgoing.response.status, 503);
    assert.equal(outgoing.response.headers.get('cache-control'), 'no-store');
  }
  assert.doesNotThrow(() => module.shutdown());
});

test('generated overlay bypasses unrelated routes when integration is disabled and tolerates close failure', async t => {
  const data = await fixture(t);
  const filename = path.join(data.target, 'aliyun', 'chat-server.mjs');
  await fs.mkdir(path.join(data.target, 'aliyun', 'ilab'));
  await fs.writeFile(path.join(data.target, 'aliyun', 'ilab', 'integration.mjs'), `export const createIlabIntegration=()=>({
    async handle(request){
      if(!new URL(request.url).pathname.startsWith('/learning/ilab'))throw new Error('Unexpected interception of existing route');
      return Response.json({error:'disabled'},{status:503});
    },
    close(){throw new Error('SECRET_CLOSE_DETAIL');}
  });\n`);
  await fs.writeFile(filename, `const diagnostics=[]; const console={error:message=>diagnostics.push(message)};\n${renderOverlay(server)}\nexport const dispatch=server.listeners('request')[0]; export {shutdown,diagnostics};\n`);
  const module = await import(pathToFileURL(filename));
  const existing = {};
  await module.dispatch({ url: '/api/learning/state' }, existing);
  assert.equal(existing.response.status, 200);
  const disabled = {};
  await module.dispatch({ url: '/learning/ilab/session' }, disabled);
  assert.equal(disabled.response.status, 503);
  assert.doesNotThrow(() => module.shutdown());
  assert.deepEqual(module.diagnostics, ['iLAB store close failed']);
});

test('unsupported, duplicate, and partial server integration fail instead of guessing', () => {
  assert.throws(() => renderOverlay(server.replace('    database.close();', 'database.end();')), /anchor/);
  assert.throws(() => renderOverlay(server + '\n    database.close();'), /anchor/);
  assert.throws(() => renderOverlay(server + '\n// BEGIN ORIGINMIND_ILAB_OVERLAY REQUEST'), /incomplete/);
  assert.throws(() => renderOverlay(server + '\nconst ilabIntegration = null;'), /different/);
});

test('dry run needs an explicit target, lists changes, and changes no deployment files', async t => {
  const data = await fixture(t);
  await assert.rejects(installOverlay(), /absolute --target/);
  await assert.rejects(installOverlay({ target: 'relative' }), /absolute --target/);
  const result = await installOverlay(data);
  assert.equal(result.applied, false);
  assert.equal(result.environmentChanged, false);
  assert.equal(result.serviceRestarted, false);
  assert.equal(result.changes.length, 2);
  assert.equal(await fs.readFile(path.join(data.target, 'aliyun', 'chat-server.mjs'), 'utf8'), server);
  await assert.rejects(fs.access(data.backupDir), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(data.target, 'aliyun', 'ilab')), { code: 'ENOENT' });
});

test('apply requires a fresh separate backup and preserves all unrelated learning code', async t => {
  const data = await fixture(t);
  await assert.rejects(installOverlay({ ...data, backupDir: undefined, apply: true }), /backup-dir/);
  await assert.rejects(installOverlay({ ...data, backupDir: path.join(data.target, 'backup'), apply: true }), /separate/);
  const result = await installOverlay({ ...data, apply: true });
  assert.equal(result.applied, true);
  assert.equal(await fs.readFile(path.join(data.backupDir, 'aliyun', 'chat-server.mjs'), 'utf8'), server);
  assert.equal(await fs.readFile(path.join(data.target, 'aliyun', 'learning', 'service.mjs'), 'utf8'), 'production learning code kept exactly\n');
  assert.equal((await fs.stat(data.backupDir)).mode & 0o777, 0o700);
  const manifest = JSON.parse(await fs.readFile(path.join(data.backupDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.state, 'installed');
  assert.equal(manifest.environmentChanged, false);
  assert.match(manifest.changes.find(item => item.path.endsWith('chat-server.mjs')).before, /^[a-f0-9]{64}$/);
  await assert.rejects(fs.access(path.join(data.target, 'aliyun', 'ilab', 'ignored.test.mjs')), { code: 'ENOENT' });
  const repeated = await installOverlay({ ...data, apply: true });
  assert.equal(repeated.applied, false);
  assert.equal(repeated.changes.length, 0);
});

test('different existing runtime or server symlink is refused before creating backup', async t => {
  const data = await fixture(t);
  await fs.mkdir(path.join(data.target, 'aliyun', 'ilab'));
  await fs.writeFile(path.join(data.target, 'aliyun', 'ilab', 'integration.mjs'), 'export const localChanges = true;');
  await assert.rejects(installOverlay({ ...data, apply: true }), /different runtime/);
  await assert.rejects(fs.access(data.backupDir), { code: 'ENOENT' });
  await fs.unlink(path.join(data.target, 'aliyun', 'ilab', 'integration.mjs'));
  const serverPath = path.join(data.target, 'aliyun', 'chat-server.mjs');
  await fs.rename(serverPath, serverPath + '.original');
  await fs.symlink(serverPath + '.original', serverPath);
  await assert.rejects(installOverlay({ ...data, apply: true }), /regular file/);
});

test('source syntax error aborts before a target or backup is written', async t => {
  const data = await fixture(t);
  await fs.writeFile(path.join(data.runtimeRoot, 'aliyun', 'ilab', 'integration.mjs'), 'export const broken = ;');
  await assert.rejects(installOverlay({ ...data, apply: true }), /Syntax check failed/);
  assert.equal(await fs.readFile(path.join(data.target, 'aliyun', 'chat-server.mjs'), 'utf8'), server);
  await assert.rejects(fs.access(data.backupDir), { code: 'ENOENT' });
});

test('existing backup and symlinked target directories cannot be replaced', async t => {
  const data = await fixture(t);
  await fs.mkdir(data.backupDir);
  await fs.writeFile(path.join(data.backupDir, 'precious.txt'), 'older backup');
  await assert.rejects(installOverlay({ ...data, apply: true }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(data.backupDir, 'precious.txt'), 'utf8'), 'older backup');
  const link = path.join(data.directory, 'stage-link');
  await fs.symlink(data.target, link);
  await assert.rejects(installOverlay({ ...data, target: link }), /symlink/);
});

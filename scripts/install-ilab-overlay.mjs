import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(scriptPath), '..');
const marker = '// BEGIN ORIGINMIND_ILAB_OVERLAY';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`Expected one supported server anchor: ${anchor}`);
  return source.replace(anchor, replacement);
}

/** Deliberately supports the reviewed chat-server shape only; unknown versions fail closed. */
export function renderOverlay(source) {
  const importBlock = `${marker} IMPORT\nimport { createIlabIntegration } from './ilab/integration.mjs';\n// END ORIGINMIND_ILAB_OVERLAY IMPORT`;
  const initBlock = `${marker} INIT\nlet ilabIntegration = null;\ntry {\n  ilabIntegration = createIlabIntegration({\n    env,\n    databasePath: process.env.ILAB_SQLITE_PATH || '/var/lib/originmind-chat/ilab.sqlite',\n  });\n} catch { console.error('iLAB integration unavailable; existing Chat routes remain available'); }\n// END ORIGINMIND_ILAB_OVERLAY INIT\n\n`;
  const requestAnchor = '    const request = await webRequest(incoming, lifecycle.signal);';
  const requestBlock = `${requestAnchor}\n    ${marker} REQUEST\n    const ilabPath = new URL(request.url).pathname;\n    if (ilabPath === '/learning/ilab' || ilabPath.startsWith('/learning/ilab/') || ilabPath === '/api/internal/ilab/events') {\n      const ilabResponse = ilabIntegration ? await ilabIntegration.handle(request) : Response.json({ error: '国家实验空间接入暂不可用。' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });\n      await sendResponse(outgoing, ilabResponse);\n      return;\n    }\n    // END ORIGINMIND_ILAB_OVERLAY REQUEST`;
  const closeAnchor = '    database.close();';
  const closeBlock = `    ${marker} CLOSE\n    try { ilabIntegration?.close(); } catch { console.error('iLAB store close failed'); }\n    // END ORIGINMIND_ILAB_OVERLAY CLOSE\n${closeAnchor}`;
  const blocks = [importBlock, initBlock.trimEnd(), requestBlock, closeBlock];
  if (source.includes(marker)) {
    if (!blocks.every(block => source.split(block).length === 2)) throw new Error('Existing iLAB overlay is incomplete or differs; review it manually.');
    return source;
  }
  if (/\bcreateIlabIntegration\b|\bilabIntegration\b/.test(source)) throw new Error('Server already contains a different iLAB integration; review it manually.');
  if (!/^import /m.test(source)) throw new Error('Unsupported server: no top-level import.');
  let output = source.replace(/^import /m, `${importBlock}\nimport `);
  output = once(output, '// Separate AI store and sessions; no changes to currentVisitor or the human DB.', `${initBlock}// Separate AI store and sessions; no changes to currentVisitor or the human DB.`);
  output = once(output, requestAnchor, requestBlock);
  output = once(output, closeAnchor, closeBlock);
  return output;
}

async function regularFile(filename, optional = false) {
  let info;
  try { info = await fs.lstat(filename); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular file: ${filename}`);
  return { bytes: await fs.readFile(filename), mode: info.mode & 0o777 };
}

async function assertDirectoryTree(root, relative) {
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let info;
    try { info = await fs.lstat(cursor); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe target directory: ${cursor}`);
  }
}

async function runtimeFiles(root) {
  const base = path.join(root, 'aliyun', 'ilab');
  await assertDirectoryTree(root, path.join('aliyun', 'ilab'));
  const files = [];
  async function walk(relative = '') {
    for (const item of await fs.readdir(path.join(base, relative), { withFileTypes: true })) {
      const child = path.join(relative, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink is not allowed in iLAB runtime: ${child}`);
      if (item.isDirectory()) await walk(child);
      else if (item.isFile() && /\.(mjs|json|sql)$/.test(child) && !/\.test\.mjs$/.test(child)) files.push(path.join('aliyun', 'ilab', child));
    }
  }
  await walk();
  if (!files.includes(path.join('aliyun', 'ilab', 'integration.mjs'))) throw new Error('Source runtime integration.mjs is missing.');
  return files.sort();
}

async function checkJavaScript(filename) {
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Syntax check failed: ${path.basename(filename)}\n${result.stderr || result.error?.message || ''}`);
}

/** This installer never starts a process, imports target application code, or restarts a service. */
export async function installOverlay({ target, backupDir, apply = false, runtimeRoot = sourceRoot } = {}) {
  if (!target || !path.isAbsolute(target)) throw new Error('An explicit absolute --target directory is required.');
  const targetRoot = await fs.realpath(target);
  if (targetRoot !== path.resolve(target)) throw new Error('Target must be a real directory, without symlink components.');
  if (inside(await fs.realpath(runtimeRoot), targetRoot)) throw new Error('Target must be a separate staged deployment tree, outside the source repository.');
  const serverRelative = path.join('aliyun', 'chat-server.mjs');
  await assertDirectoryTree(targetRoot, 'aliyun');
  const original = await regularFile(path.join(targetRoot, serverRelative));
  const updated = Buffer.from(renderOverlay(original.bytes.toString('utf8')));
  const changes = [];
  for (const relative of await runtimeFiles(runtimeRoot)) {
    await assertDirectoryTree(targetRoot, path.dirname(relative));
    const source = await regularFile(path.join(runtimeRoot, relative));
    if (relative.endsWith('.mjs')) await checkJavaScript(path.join(runtimeRoot, relative));
    const current = await regularFile(path.join(targetRoot, relative), true);
    if (current && !current.bytes.equals(source.bytes)) throw new Error(`Refusing to replace a different runtime file: ${relative}`);
    if (!current) changes.push({ relative, bytes: source.bytes, mode: source.mode, original: null });
  }
  if (!original.bytes.equals(updated)) changes.push({ relative: serverRelative, bytes: updated, mode: original.mode, original });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'originmind-ilab-check-'));
  try { const candidate = path.join(temporary, 'chat-server.mjs'); await fs.writeFile(candidate, updated); await checkJavaScript(candidate); }
  finally { await fs.rm(temporary, { recursive: true, force: true }); }
  const plan = { target: targetRoot, applied: false, changes: changes.map(item => ({ path: item.relative, before: item.original ? hash(item.original.bytes) : null, after: hash(item.bytes) })), serviceRestarted: false, environmentChanged: false };
  if (!apply || changes.length === 0) return plan;
  if (!backupDir || !path.isAbsolute(backupDir)) throw new Error('--apply requires an explicit absolute --backup-dir.');
  const absoluteBackup = path.resolve(backupDir);
  if (inside(targetRoot, absoluteBackup) || inside(absoluteBackup, targetRoot)) throw new Error('Backup directory must be separate from the target tree.');
  // mkdir without recursive refuses existing backup paths, preserving every earlier backup.
  const parent = await fs.realpath(path.dirname(absoluteBackup));
  if (path.join(parent, path.basename(absoluteBackup)) !== absoluteBackup) throw new Error('Backup path must not contain symlink components.');
  await fs.mkdir(absoluteBackup, { mode: 0o700 });
  const manifest = { ...plan, createdAt: new Date().toISOString(), state: 'prepared' };
  const manifestPath = path.join(absoluteBackup, 'manifest.json');
  const applied = [];
  try {
    for (const item of changes) {
      if (item.original) {
        const destination = path.join(absoluteBackup, item.relative);
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await fs.writeFile(destination, item.original.bytes, { flag: 'wx', mode: item.original.mode });
      }
    }
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    for (const item of changes) {
      await assertDirectoryTree(targetRoot, path.dirname(item.relative));
      const destination = path.join(targetRoot, item.relative);
      const current = await regularFile(destination, true);
      if (item.original ? !current || !current.bytes.equals(item.original.bytes) : current !== null) throw new Error(`Target changed after review: ${item.relative}`);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const staging = `${destination}.ilab-${process.pid}-${Date.now()}.tmp`;
      try { await fs.writeFile(staging, item.bytes, { flag: 'wx', mode: item.mode }); await fs.rename(staging, destination); }
      finally { await fs.rm(staging, { force: true }); }
      applied.push(item);
    }
    manifest.state = 'installed'; manifest.applied = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    return { ...plan, applied: true, backup: absoluteBackup };
  } catch (error) {
    const rollbackErrors = [];
    for (const item of applied.reverse()) {
      try {
        const destination = path.join(targetRoot, item.relative);
        // Do not overwrite a concurrent third-party change while rolling back.
        const current = await regularFile(destination, true);
        if (!current || !current.bytes.equals(item.bytes)) throw new Error(`Concurrent change at ${item.relative}`);
        if (item.original) await fs.writeFile(destination, item.original.bytes, { mode: item.original.mode });
        else await fs.unlink(destination);
      } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    manifest.state = rollbackErrors.length ? 'rollback-incomplete' : 'rolled-back';
    manifest.rollbackErrors = rollbackErrors;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    throw new Error(`${error.message}; ${manifest.state}. Backup: ${absoluteBackup}`);
  }
}

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === '--target' || argument === '--backup-dir') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
      const key = argument === '--target' ? 'target' : 'backupDir';
      if (options[key]) throw new Error(`Duplicate ${argument}`);
      options[key] = value;
    } else if (argument === '--apply') options.apply = true;
    else if (argument === '--check') { if (options.apply) throw new Error('Use either --check or --apply.'); options.check = true; }
    else if (argument === '--help') { console.log('node scripts/install-ilab-overlay.mjs --target /absolute/staged-root [--check | --apply --backup-dir /absolute/new-backup]'); return; }
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.check && options.apply) throw new Error('Use either --check or --apply.');
  console.log(JSON.stringify(await installOverlay(options), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

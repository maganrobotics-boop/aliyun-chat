import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root || !root.endsWith('/20260927T190500Z-chat-workspace-r2')) throw new Error('Unexpected isolated release target');
const chat = path.join(root, 'chat-cloudflare');
function edit(relative, update) {
  const file = path.join(chat, relative);
  const before = fs.readFileSync(file, 'utf8');
  const after = update(before);
  if (before === after) throw new Error(`No change: ${relative}`);
  fs.writeFileSync(file, after);
}
function once(source, oldText, replacement) {
  if (source.split(oldText).length !== 2) throw new Error(`Expected one source anchor: ${oldText.slice(0, 90)}`);
  return source.replace(oldText, replacement);
}
const assets = '<link rel="stylesheet" href="/assets/workspace-r2.css">\n<script defer src="/assets/workspace-r2.js"></script>\n';
edit('frontend/index.html', s => once(s, '</head>', assets + '</head>'));
edit('public/newbie-village.html', s => {
  s = once(s, '</head>', assets + '</head>');
  s = once(s, 'newbie-village.js?v=20260927-no-guest-flash-v3', 'newbie-village.js?v=20260927-workspace-r2');
  s = once(s, '<title>新手村 · 个人学习主页</title>', '<title>课程 · OriginMind × ARTS Robotics</title>');
  const start = s.indexOf('<nav class="workspace-bottom-nav"');
  const end = s.indexOf('</nav>', start) + 6;
  if (start < 0 || end < start) throw new Error('Bottom navigation missing');
  let nav = s.slice(start, end);
  nav = once(nav, 'data-view="learning"', 'data-view="courses"');
  nav = once(nav, 'aria-controls="view-learning"', 'aria-controls="view-courses"');
  nav = once(nav, '<span>学习</span>', '<span>课程</span>');
  return s.slice(0, start) + nav + s.slice(end);
});
edit('public/newbie-village.js', s => {
  s = once(s, 'Object.freeze({ tasks: "courses", passes: "progress", my: "profile" })', 'Object.freeze({ learning: "courses", tasks: "courses", passes: "progress", my: "profile" })');
  s = once(s, 'return WORKSPACE_HASH_ALIASES[key] || (WORKSPACE_VIEWS.includes(key) ? key : "learning");', 'return WORKSPACE_HASH_ALIASES[key] || (WORKSPACE_VIEWS.includes(key) ? key : "courses");');
  s = once(s, 'function switchView(view, preserveHash = false, focus = false) {', 'function switchView(view, preserveHash = false, focus = false) {\n  if (view === "tutor") { location.assign("/?ta=1"); return; }');
  s = once(s, 'state.activeView = WORKSPACE_VIEWS.includes(view) ? view : WORKSPACE_HASH_ALIASES[view] || "learning";', 'state.activeView = WORKSPACE_HASH_ALIASES[view] || (WORKSPACE_VIEWS.includes(view) ? view : "courses");');
  s = once(s, 'elements.taskDialog.showModal();', 'elements.taskDialog.show();');
  s = once(s, 'elements.loginDialog.showModal();', 'elements.loginDialog.show();');
  return s;
});
edit('src/static-router.mjs', s => once(s,
  '  const kind = classifyPath(url.pathname);\n',
  '  const kind = classifyPath(url.pathname);\n' +
  '  const workspaceHome = url.pathname === "/" && [...url.searchParams.keys()].every(key => ["release", "v", "verify", "probe"].includes(key));\n' +
  '  if (workspaceHome) {\n' +
  '    if (!SAFE_METHODS.has(request.method)) return methodNotAllowed();\n' +
  '    return fetchAsset(request, env, "/newbie-village.html", "no-store");\n' +
  '  }\n'
));
console.log('WORKSPACE_SOURCE_PREPARED');

const $ = id => document.getElementById(id);
let service = { signedIn: false, canGrade: false, modelConfigured: false }, busy = false, result = null;
let sourceRevision = 0;
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
function updateActions() { $('grade').disabled = busy || !service.canGrade || !service.modelConfigured; $('editor').disabled = busy || !service.canGrade; $('grading-form').hidden = !service.canGrade; if (!service.canGrade) { result = null; $('result').hidden = true; } }
function setBusy(value) { busy = value; updateActions(); }
function invalidate() { sourceRevision++; $('confirmed').checked = false; result = null; $('result').hidden = true; }
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { service.canGrade = false; updateActions(); }
      throw new Error(data.error || `请求失败（${response.status}），请稍后重试。`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，未生成新成绩。内容仍保留，请分段重试。');
    throw error;
  } finally { clearTimeout(timer); }
}
async function checkSession() {
  try {
    service = await api('/api/grading/status');
    $('account').textContent = !service.canGrade ? '试卷批改仅限 @sztu.edu.cn 教师邮箱。请使用教师邮箱登录。' : !service.modelConfigured ? '已登录，AI 服务尚未配置，请联系管理员。' : '教师已登录 · 可上传试卷并开始批改';
    $('login-panel').hidden = service.canGrade === true;
    if (!service.canGrade) $('login-panel').open = true;
    if (service.notice) $('parser-notice').textContent = `${service.notice} 请逐题核对，补齐手写、公式和图形信息。`;
  } catch (error) { service = { signedIn: false, canGrade: false, modelConfigured: false }; $('account').textContent = error.message; $('login-panel').hidden = false; }
  updateActions();
}
const jsonOptions = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
$('request-code').addEventListener('click', async () => {
  if (!$('email').reportValidity()) return;
  if (!/^[^\s@]+@sztu\.edu\.cn$/i.test($('email').value.trim())) { $('login-status').textContent = '请使用 @sztu.edu.cn 教师邮箱。'; return; }
  $('request-code').disabled = true;
  try { await api('/api/visitor/request-code', jsonOptions({ email: $('email').value })); $('login-status').textContent = '验证码已发送，请检查邮箱。'; }
  catch (error) { $('login-status').textContent = error.message; }
  finally { $('request-code').disabled = false; }
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await api('/api/visitor/verify-code', jsonOptions({ email: $('email').value, code: $('code').value })); $('code').value = ''; await checkSession(); }
  catch (error) { $('login-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('refresh-session').addEventListener('click', checkSession);
const mime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
async function importFiles(target, picker) {
  const files = [...picker.files]; picker.value = '';
  if (!files.length || busy) return;
  if (!service.canGrade) { status('请先使用 @sztu.edu.cn 教师邮箱登录。', true); return; }
  if (files.length > 20) { status('一次最多选择 20 个文件。', true); return; }
  setBusy(true); let imported = 0;
  try {
    for (const file of files) {
      status(`正在识别 ${file.name}（${imported + 1}/${files.length}）…`);
      const extension = file.name.split('.').pop().toLowerCase();
      const isText = ['txt', 'md'].includes(extension);
      if (!isText && !mime[extension]) throw new Error('仅支持 TXT、MD、PDF、JPG、PNG、WebP。');
      const maxBytes = ['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? 8 * 1024 * 1024 : 10 * 1024 * 1024;
      if (!file.size || file.size > maxBytes) throw new Error(`${file.name} 为空或超出大小限制，请拆分后上传。`);
      if (!isText && !service.formats?.includes(extension)) throw new Error('当前服务不支持此文件的识别，请粘贴文字或改传 TXT / MD。');
      const text = isText ? new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) : (await api('/api/grading/extract', {
        method: 'POST', headers: { 'Content-Type': mime[extension], 'X-File-Name': encodeURIComponent(file.name) }, body: file,
      })).text;
      if (!text?.trim()) throw new Error('未识别到文字，请检查文件。');
      const next = `${$(target).value}${$(target).value.trim() ? '\n\n' : ''}【文件：${file.name}】\n${text.trim()}`;
      if (next.length > $(target).maxLength) throw new Error(`内容超过 ${$(target).maxLength} 字，请分段处理；已识别部分仍保留。`);
      $(target).value = next; imported++; invalidate();
    }
    status(`已添加 ${imported} 个文件。请对照原卷核对文字后勾选确认。`);
  } catch (error) { status(`已添加 ${imported} 个文件。${error instanceof TypeError ? '文件须为 UTF-8 文本，或请直接粘贴。' : error.message}`, true); }
  finally { setBusy(false); }
}
for (const target of ['paper', 'rubric']) $(target + '-files').addEventListener('change', () => importFiles(target, $(target + '-files')));
for (const id of ['title', 'paper', 'rubric', 'question-count', 'total-score']) $(id).addEventListener('input', invalidate);
$('demo').addEventListener('click', () => {
  if (($('paper').value || $('rubric').value) && !confirm('示例将替换当前试卷与答案，继续吗？')) return;
  $('title').value = 'ROS 基础练习（示例）'; $('question-count').value = '2'; $('total-score').value = '10';
  $('paper').value = '第 1 题（5 分）：ROS 2 中发布消息的一方称为什么？学生作答：发布者。\n第 2 题（5 分）：匀速直线运动速度 2 m/s，运动 3 s，位移是多少？学生作答：5 m。';
  $('rubric').value = '第 1 题（5 分）：发布者或 publisher 得 5 分，其他答案 0 分。\n第 2 题（5 分）：参考答案为 6 m；列出 s=v×t 得 2 分，代入与计算正确得 2 分，正确单位得 1 分。只写最终答案时，数值正确得 4 分；正确单位 m 独立得 1 分，即使数值错误也给单位分。未展示计算过程时，不推测运算过程。';
  invalidate(); status('示例已填入。请核对内容后勾选确认，再开始批改。');
});
$('clear').addEventListener('click', () => {
  if (($('paper').value || $('rubric').value || result) && !confirm('清空本次试卷和批改结果？未导出的内容无法恢复。')) return;
  $('grading-form').reset(); invalidate(); status('本次内容已清空。');
});
function node(tag, text, className) { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; }
function render(value) {
  $('result-title').textContent = value.title;
  $('score').replaceChildren(node('strong', value.suggestedScore === null ? '待复核' : `${value.suggestedScore} / ${value.totalScore}`), node('span', value.pendingCount ? `已评部分 ${value.subtotal} 分 · ${value.pendingCount} 题待复核 · 暂不汇总总分` : `AI 建议得分 · 共 ${value.questionCount} 题`));
  $('summary').textContent = value.summary; $('result-notice').textContent = value.notice;
  $('questions').replaceChildren();
  for (const q of value.questions) {
    const card = node('article', '', 'question'), head = node('div', '', 'question-head');
    head.append(node('h3', q.label), node('span', q.status === 'review' ? '待复核' : `${q.score} / ${q.maxScore} 分`, `badge${q.status === 'review' ? ' review' : ''}`));
    const dl = node('dl', '');
    for (const [label, content] of [['学生作答', q.studentAnswer || '未识别到作答'], ['参考答案', q.referenceAnswer || '缺少依据'], ['评分依据', q.reason], ['改进建议', q.improvement || '—']]) dl.append(node('dt', label), node('dd', content));
    card.append(head, dl); $('questions').append(card);
  }
  $('result').hidden = false; $('result').focus();
}
$('grading-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !service.canGrade || !service.modelConfigured) return;
  const revision = sourceRevision;
  result = null; $('result').hidden = true; setBusy(true); status('正在按评分标准逐题批改，通常需要数十秒…');
  try {
    const data = await api('/api/grading/grade', jsonOptions({ title: $('title').value, paper: $('paper').value, rubric: $('rubric').value, questionCount: Number($('question-count').value), totalScore: Number($('total-score').value), confirmed: $('confirmed').checked }));
    if (revision !== sourceRevision) throw new Error('材料已更改，请重新批改。');
    result = data; render(data); status(data.pendingCount ? '批改完成，部分题目需核对后再评分。' : '批改完成，请教师复核评分依据。');
  } catch (error) { status(error.message, true); }
  finally { setBusy(false); }
});
function download(text, suffix, type) {
  const blob = new Blob(['\ufeff', text], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `试卷批改-${new Date().toISOString().slice(0, 10)}.${suffix}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-report').addEventListener('click', () => {
  if (!result) return;
  const r = result;
  const lines = [r.title, r.notice, `AI 建议得分：${r.suggestedScore ?? '待复核'} / ${r.totalScore}；已评部分：${r.subtotal}；待复核：${r.pendingCount} 题`, r.summary];
  for (const q of r.questions) lines.push('', `${q.label}：${q.status === 'review' ? '待复核' : `${q.score} / ${q.maxScore}`}`, `学生作答：${q.studentAnswer}`, `参考答案：${q.referenceAnswer}`, `评分依据：${q.reason}`, `改进建议：${q.improvement}`);
  download(lines.join('\n'), 'txt', 'text/plain;charset=utf-8');
});
function csvCell(value) { const text = String(value ?? ''); return `"${(/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`; }
$('export-csv').addEventListener('click', () => {
  if (!result) return;
  const rows = [['试卷', '题号', '建议得分', '满分', '状态', '学生作答', '参考答案', '评分依据', '改进建议']];
  for (const q of result.questions) rows.push([result.title, q.label, q.score, q.maxScore, q.status === 'review' ? '待复核' : 'AI 建议，教师待复核', q.studentAnswer, q.referenceAnswer, q.reason, q.improvement]);
  download(rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'csv', 'text/csv;charset=utf-8');
});
$('print').addEventListener('click', () => window.print());
window.addEventListener('beforeunload', event => { if (busy || $('paper').value || $('rubric').value || result) { event.preventDefault(); event.returnValue = ''; } });
void checkSession();

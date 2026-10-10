const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const fieldSpecs = [
  ['name', '姓名', 60, '请填写本人姓名'], ['school', '学校、专业与年级', 120, '例如：深圳技术大学，机械专业，本科三年级'],
  ['academicResults', '课程成绩', 600, '可说明绩点、排名、相关课程成绩；成绩未出可如实说明'],
  ['introduction', '个人介绍', 800, '介绍兴趣、学习情况，以及为什么希望参与项目'],
  ['experience', '技能与项目经历', 600, '说明负责过什么、完成了什么，可附作品链接；暂无经历也可填写'],
  ['project', '意向项目', 160, '例如：四足巡检、移动双臂、定位导航，或其他方向'],
  ['availability', '每周可投入时间', 120, '例如：每周 6 小时，周三下午及周末'],
];
async function api(method = 'GET', body) {
  const response = await fetch('/api/learning/project-application', { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '项目报名暂不可用。'), { status: response.status });
  return result;
}
function bytesToBase64(bytes) { let text = ''; for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384)); return btoa(text); }
function snapshotView(learning) {
  const box = el('section', undefined, 'project-application-progress');
  box.append(el('h3', '自动附上平台学习记录'));
  box.append(el('p', learning.currentChapter ? `最近学习第 ${learning.currentChapter.index} 章：${learning.currentChapter.title}` : '暂无章节学习记录。'));
  box.append(el('p', `已提交 ${learning.submittedChapters}/${learning.totalChapters} 章，${learning.submissionCount} 份作业；${learning.reviewedCount} 份已有助教点评。`));
  const graduation = { passed: '已通过', needs_retry: '尚未通过', not_attempted: '尚未参加' }[learning.graduation.status] || '暂无记录';
  box.append(el('p', `结业测试：${graduation}。${learning.gradeNote}`));
  if (learning.reviews.length) {
    const details = el('details'); details.append(el('summary', '查看最近助教点评'));
    for (const review of learning.reviews) details.append(el('h4', review.chapter), el('p', review.review));
    box.append(details);
  }
  return box;
}
export function createProjectApplicationUI({ identity, onLogin, onReceipt, onProgress, onCourse, workCourses }) {
  const style = el('link'); style.rel = 'stylesheet'; style.href = '/learning/project-application.css'; document.head.append(style);
  const dialog = el('dialog', undefined, 'project-application-dialog'); dialog.setAttribute('aria-labelledby', 'project-application-title');
  const header = el('header'), title = el('h2', '申请参与项目'); title.id = 'project-application-title';
  const close = el('button', '关闭', 'secondary'); close.type = 'button'; header.append(title, close);
  const content = el('div'), status = el('p', '', 'project-application-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  dialog.append(header, content, status); document.body.append(dialog);
  const entry = el('button', '参与项目', 'secondary'); entry.type = 'button'; entry.id = 'project-application-entry'; entry.onclick = () => void open();
  const links = el('nav', undefined, 'project-course-links'); links.setAttribute('aria-label', '项目课程与报名'); links.append(entry); document.querySelector('main')?.prepend(links);
  const workEntry = el('button', '项目工作课程', 'secondary'); workEntry.type = 'button'; workEntry.id = 'project-work-courses-entry';
  links.prepend(workEntry);
  workEntry.onclick = () => {
    if (submitting) return;
    title.textContent = '项目工作课程'; returnFocus = document.activeElement; content.replaceChildren(el('h3', '项目工作课程'), el('p', '直接选择课程开始学习，无需提交项目报名申请。')); status.textContent = '';
    for (const course of workCourses()) { const button = el('button', course.title, 'project-work-course secondary'); button.type = 'button'; button.onclick = () => { dismiss(); onCourse(course.id); }; content.append(button); }
    if (!dialog.open) dialog.showModal();
  };
  let owner = '', pending = null, submitting = false, resubmitId = null, returnFocus = null, generation = 0;
  const drafts = new Map(),fileDrafts=new Map();
  function current() { return owner && identity().email?.toLowerCase() === owner; }
  function dismiss() { if (submitting) return; dialog.close(); if (returnFocus?.isConnected) returnFocus.focus(); }
  close.onclick = dismiss; dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  function reset() { generation++; owner = ''; pending = null; resubmitId = null; submitting = false; drafts.clear();fileDrafts.clear(); dialog.close(); content.replaceChildren(); status.textContent = ''; }
  function historyView(records, synchronized) {
    const section = el('section', undefined, 'project-application-history'); section.append(el('h3', '我的报名与审核状态'));
    if (!synchronized) section.append(el('p', 'OA 状态暂未同步。下方如有记录，是上次提交回执；请稍后重新查看。'));
    if (!records.length) section.append(el('p', '尚无报名记录。'));
    for (const record of records) {
      const card = el('article'); card.append(el('h4', record.project), el('p', `${record.status}${record.cached ? '（上次回执）' : ''} · ${new Date(record.updatedAt).toLocaleString('zh-CN')}`));
      if (record.returnNote) card.append(el('p', `需要补充：${record.returnNote}`));
      if (record.status === '已退回' && synchronized) {
        const edit = el('button', '补充材料后重新提交', 'secondary'); edit.type = 'button';
        edit.onclick = () => { if(submitting)return;fileDrafts.delete(owner);drafts.set(owner, record.fields); resubmitId = record.id; pending = null; void open(); };
        card.append(edit);
      }
      section.append(card);
    }
    return section;
  }
  async function open() {
    if(submitting)return;
    title.textContent = '申请参与项目';
    const account = identity();
    if (!account.email) { onLogin(); return; }
    const token = ++generation; owner = account.email.toLowerCase();
    if (!dialog.open) { returnFocus = document.activeElement; dialog.showModal(); }
    content.replaceChildren(el('p', '正在读取您的课程进度与申请记录…')); status.textContent = ''; close.disabled = false;
    try {
      const data = await api();
      if (token !== generation || !current() || data.email !== owner) return;
      await onProgress?.();
      if (token !== generation || !current()) return;
      const replies = el('section', undefined, 'project-application-history');
      if (data.replies?.length) { replies.append(el('h3', '老师回复与已开通课程')); for (const reply of data.replies) { const card = el('article'); card.append(el('p', reply.reply), el('small', new Date(reply.createdAt).toLocaleString('zh-CN'))); for (const courseId of reply.courseIds) { const course = data.learning.catalogue.find(course => course.id === courseId); const button = el('button', `进入 ${course?.title || courseId}`, 'project-work-course secondary'); button.type = 'button'; button.onclick = () => { dismiss(); onCourse(courseId); }; card.append(button); } replies.append(card); } }
      if (!data.learning.eligibility.canApply) {
        const gate = el('section'); gate.append(snapshotView(data.learning), el('p', '参与项目须先完成并通过新手村最后一关。项目工作课程可直接学习，无需报名。'));
        const finish = el('button', '前往新手村最后一关'); finish.type = 'button'; finish.onclick = () => { dismiss(); onCourse('graduation'); }; gate.append(finish);
        content.replaceChildren(gate, replies, historyView(data.records, data.synchronized)); return;
      }
      const form = el('form'), fields = new Map(), seed = drafts.get(owner) || { name: data.profile.name || '', school: [data.profile.major, data.profile.grade].filter(Boolean).join('，'), introduction: data.profile.bio || '' };
      form.append(el('p', '助教会整理以下报名资料，连同平台的章节进度、作业记录和成绩一起提交给马淦老师。'));
      if (resubmitId) form.append(el('p', '正在补充一份已退回的申请。'));
      for (const [key, label, maxLength, placeholder] of fieldSpecs) {
        const group = el('label', undefined, 'project-application-field'), input = el(['academicResults', 'introduction', 'experience'].includes(key) ? 'textarea' : 'input');
        input.name = key; input.required = true; input.maxLength = maxLength; input.placeholder = placeholder; input.value = seed[key] || '';
        if (input.tagName === 'TEXTAREA') input.rows = key === 'introduction' ? 4 : 3;
        fields.set(key, input); group.append(el('span', label), input); form.append(group);
        input.addEventListener('input', () => { drafts.set(owner, Object.fromEntries([...fields].map(([name, node]) => [name, node.value]))); pending = null; });
      }
      const fileLabel = el('label', undefined, 'project-application-field'), upload = el('input'); upload.type = 'file'; upload.multiple = true; upload.accept = '.pdf,.png,.jpg,.jpeg';
      fileLabel.append(el('span', '成绩单、作品或项目说明（可选）'), upload, el('small', '最多 3 份 PDF 或图片；每份不超过 3 MB，合计不超过 5 MB。')); form.append(fileLabel);
      const selectedNames=el('p');fileLabel.append(selectedNames);const fileNames=()=>{selectedNames.textContent=(fileDrafts.get(owner)||[]).map(file=>file.name).join('、');};fileNames();
      upload.onchange = () => { fileDrafts.set(owner,[...upload.files]);pending = null;fileNames(); };
      form.append(snapshotView(data.learning));
      const confirm = el('label', undefined, 'project-application-confirm'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.required = true;
      confirm.append(checkbox, el('span', '我已核对报名资料，同意将资料及平台学习记录提交给马淦老师审核。')); form.append(confirm);
      const submit = el('button', '确认提交给马淦'); submit.type = 'submit'; form.append(submit);
      form.onsubmit = async event => {
        event.preventDefault(); if (submitting || !current() || token !== generation) return;
        const values = Object.fromEntries([...fields].map(([key, node]) => [key, node.value.trim()])), selected = fileDrafts.get(owner)||[];
        drafts.set(owner, values);
        if (selected.length > 3 || selected.some(file => file.size > 3 * 1024 * 1024) || selected.reduce((total, file) => total + file.size, 0) > 5 * 1024 * 1024) { status.textContent = '最多 3 份材料，每份 3 MB，合计 5 MB。'; return; }
        submitting = true;for(const control of form.elements)control.disabled=true; submit.disabled = true; close.disabled = true; status.textContent = '正在将您的申请提交至 OA…';
        try {
          if (!pending) { const files = []; for (const file of selected) files.push({ name: file.name, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }); pending = { fields: values, files, confirmed: checkbox.checked, idempotencyKey: crypto.randomUUID(), expectedEmail: owner, ...(resubmitId ? { resubmitId } : {}) }; }
          if (!current() || token !== generation) return;
          const receipt = await api('POST', pending);
          if (!current() || token !== generation) return;
          drafts.delete(owner);fileDrafts.delete(owner); pending = null; resubmitId = null;
          content.replaceChildren(el('h3', '申请已送达 OA'), el('p', `已提交给${receipt.reviewerName}，当前状态：${receipt.status}。报名编号：${receipt.id.slice(0, 8)}。`), el('p', '老师审核后，再打开“参与项目”可查看处理结果或补充要求。'));
          status.textContent = '报名材料和平台学习记录已保存。'; onReceipt?.(receipt);
        } catch (error) { if (current() && token === generation) status.textContent = error.message; }
        finally { submitting = false; close.disabled = false; for(const control of form.elements)control.disabled=false;submit.disabled = false; }
      };
      content.replaceChildren(form, replies, historyView(data.records, data.synchronized));
    } catch (error) { if (current() && token === generation) { content.replaceChildren(el('p', error.message)); if (error.status === 401) { dialog.close(); onLogin(); } } }
  }
  addEventListener('hashchange', () => { if (location.hash === '#project-application') void open(); });
  return { open, reset, ready() { if (location.hash === '#project-application' && !dialog.open && identity().email) void open(); } };
}

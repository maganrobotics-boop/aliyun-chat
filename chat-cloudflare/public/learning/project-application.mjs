import { academicSemester, courseProjects, industrialProjects } from './project-catalogue.mjs';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const fieldSpecs = [
  ['name', '姓名', 60, '请填写本人姓名'], ['school', '学校、专业与年级', 120, '例如：深圳技术大学，机械专业，本科三年级'],
  ['academicResults', '课程成绩', 600, '可说明绩点、排名、相关课程成绩；成绩未出可如实说明'],
  ['introduction', '个人介绍', 800, '介绍兴趣、学习情况，以及为什么希望参与项目'],
  ['experience', '技能与项目经历', 600, '说明负责过什么、完成了什么，可附作品链接；暂无经历也可填写'],
  ['project', '意向项目', 160, '例如：四足巡检、移动双臂、定位导航，或其他方向'],
  ['availability', '每周可投入时间', 120, '例如：每周 6 小时，周三下午及周末'],
];
async function api(method = 'GET', body, endpoint = 'project-application') {
  const response = await fetch('/api/learning/'+endpoint, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
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
  const entry = el('button', '参与实验室项目', 'secondary'); entry.type = 'button'; entry.id = 'project-application-entry'; entry.onclick = () => void open();
  const links = el('nav', undefined, 'project-course-links'); links.setAttribute('aria-label', '项目课程与报名'); links.append(entry); document.querySelector('main')?.prepend(links);
  const workEntry = el('button', '课程项目介绍与选课', 'secondary'); workEntry.type = 'button'; workEntry.id = 'project-work-courses-entry';
  links.prepend(workEntry);
  workEntry.onclick = () => void openCourseProjects();
  let owner = '', pending = null, pendingSelection = null, submitting = false, resubmitId = null, returnFocus = null, generation = 0;
  const drafts = new Map(),fileDrafts=new Map();
  function current() { return owner && identity().email?.toLowerCase() === owner; }
  function dismiss() { if (submitting) return; dialog.close(); if (returnFocus?.isConnected) returnFocus.focus(); }
  close.onclick = dismiss; dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  function reset() { generation++; owner = ''; pending = null; pendingSelection = null; resubmitId = null; submitting = false; drafts.clear();fileDrafts.clear(); dialog.close(); content.replaceChildren(); status.textContent = ''; }
  function industrialView() {
    const section = el('section', undefined, 'industrial-project-introductions');
    section.append(el('h3', '先了解官网的三个工业项目'), el('p', '实验室报名与课程选题分别处理。请阅读项目介绍，选择意向，再提供成绩、个人介绍和可投入时间。'));
    for (const project of industrialProjects) {
      const card = el('article', undefined, 'project-introduction-card'), link = el('a', '查看官网项目介绍');
      link.href = project.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      card.append(el('h4', project.title), el('small', project.stage), el('p', project.description), link);
      const choose = el('button', '报名意向：'+project.title, 'secondary'); choose.type = 'button';
      choose.onclick = () => { if (submitting) return; const account = identity(); if (!account.email) { dismiss(); onLogin(); return; } selectedLabId = project.id; drafts.set(account.email.toLowerCase(), { ...(drafts.get(account.email.toLowerCase()) || {}), project: project.title }); pending = null; void open(); };
      card.append(choose); section.append(card);
    }
    return section;
  }
  let selectedLabId = '';
  async function openCourseProjects() {
    if (submitting) return;
    const token = ++generation, account = identity(); owner = account.email?.toLowerCase() || '';
    title.textContent = '课程项目介绍与选课'; status.textContent = '';
    if (!dialog.open) { returnFocus = document.activeElement; dialog.showModal(); }
    content.replaceChildren(el('p', '正在读取本学期选题…'));
    let data = { semester: academicSemester(), selected: null };
    try { if (owner) data = await api('GET', undefined, 'course-project-selection'); }
    catch(error) { if (token !== generation) return; content.replaceChildren(el('p', error.message)); if (error.status === 401) { dismiss(); onLogin(); } return; }
    if (token !== generation || (owner && !current()) || (data.email && data.email !== owner)) return;
    const introduction = el('section');
    introduction.append(el('h3', data.semester.label), el('p', '请每位同学每学期只选一个项目。选后，该项目所在章节自动解锁。系统会把你的姓名、学号同步给马淦老师，并进入 OA 待处理，无需等待审批。新手村的项目一是共同通关任务，不占本学期选题名额。'));
    if (data.selected) introduction.append(el('p', `姓名：${data.selected.name} · 学号：${data.selected.studentNumber || '尚未提供'}。`), el('p', `本学期已选：${data.selected.courseTitle}。${data.selected.oaDelivered ? '已送达 OA，'+(data.synchronized?'当前状态：':'上次回执：')+data.selected.oaStatus : '章节已开放，OA 待同步，系统会自动重试。'}`));
    for (const reply of data.replies || []) { const card=el('article',undefined,'project-introduction-card');card.append(el('h4','马淦老师回复'),el('p',reply.reply));for(const [index,courseId] of reply.courseIds.entries()){const button=el('button','进入老师开通的课程：'+(reply.courses?.[index]||courseId),'secondary');button.type='button';button.onclick=()=>{dismiss();onCourse(courseId);};card.append(button);}introduction.append(card);}
    content.replaceChildren(introduction);
    for (const project of courseProjects) {
      const card = el('article', undefined, 'project-introduction-card'); card.dataset.project = project.id;
      card.append(el('h4', project.title), el('p', project.description), el('p', '项目产出：'+project.outcomes));
      const chosen = data.selected?.courseId === project.id, button = el('button', chosen ? '进入已选项目章节' : data.selected ? '本学期已选择其他项目' : '选择本学期项目', 'secondary');
      button.type = 'button'; button.disabled = Boolean(data.selected && !chosen);
      button.onclick = () => {
        if (submitting) return;
        if (!owner) { dismiss(); onLogin(); return; }
        if (chosen) { dismiss(); onCourse(project.id); return; }
        content.replaceChildren(el('h3', project.title), el('p', project.description), el('p', `确认选择后，${data.semester.label}的选题名额将锁定为此项目，对应章节立即开放，选题与平台学习记录会提交给马淦老师。`));
        const form = el('form'), nameInput = el('input'), numberInput = el('input');
        for (const [label,node,key,value] of [['姓名',nameInput,'name',data.profile?.name || ''],['学号',numberInput,'studentNumber',data.profile?.studentNumber || '']]) {
          const group=el('label',undefined,'project-application-field');node.name=key;node.required=true;node.maxLength=key==='name'?60:40;node.value=value;node.autocomplete=key==='name'?'name':'off';
          if(key==='studentNumber'){node.minLength=2;node.pattern='[A-Za-z0-9._-]{2,40}';node.placeholder='请填写本人学号';}else node.placeholder='请填写本人姓名';
          group.append(el('span',label),node);form.append(group);
        }
        form.append(el('p','请核对本人姓名、学号。确认选题后，系统会将这些信息和项目选题同步给马淦老师。'));
        const confirm = el('button', '确认选题并打开章节'), back = el('button', '返回项目介绍', 'secondary'); confirm.type = 'submit';back.type = 'button';
        back.onclick = () => void openCourseProjects(); form.append(confirm,back);content.append(form);
        form.onsubmit = async event => {
          event.preventDefault();
          if (submitting || !current() || token !== generation) return;
          const name=nameInput.value.trim(),studentNumber=numberInput.value.trim();
          if (!pendingSelection || pendingSelection.courseId !== project.id || pendingSelection.expectedSemesterId !== data.semester.id || pendingSelection.name !== name || pendingSelection.studentNumber !== studentNumber) pendingSelection = { courseId: project.id, idempotencyKey: crypto.randomUUID(), expectedEmail: owner, expectedSemesterId: data.semester.id, name, studentNumber, confirmed: true };
          submitting = true; nameInput.disabled = numberInput.disabled = confirm.disabled = back.disabled = close.disabled = true; status.textContent = '正在保存本学期选题并开放章节…';
          try {
            const result = await api('POST', pendingSelection, 'course-project-selection');
            if (!current() || token !== generation || result.email !== owner) return;
            pendingSelection = null; await onProgress?.();
            if (!current() || token !== generation) return;
            submitting = false; dismiss(); onCourse(result.selected.courseId);
            onReceipt?.({ ...result.selected, kind: 'course_project_selection' });
          } catch(error) { if (current() && token === generation) status.textContent = error.message; }
          finally { submitting = false; nameInput.disabled = numberInput.disabled = confirm.disabled = back.disabled = close.disabled = false; }
        };
      };
      card.append(button); content.append(card);
    }
  }
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
    title.textContent = '参与实验室项目';
    const account = identity();
    if (!account.email) { title.textContent = '参与实验室项目'; ++generation; owner = ''; status.textContent = ''; content.replaceChildren(industrialView()); const login = el('button','登录后填写报名资料'); login.type='button'; login.onclick=()=>{dismiss();onLogin();};content.append(login); if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();} return; }
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
        const gate = el('section'); gate.append(snapshotView(data.learning), el('p', '参与实验室项目须先完成并通过新手村最后一关。课程项目按学期选题后即可学习，无需报名审批。'));
        const finish = el('button', '前往新手村最后一关'); finish.type = 'button'; finish.onclick = () => { dismiss(); onCourse('graduation'); }; gate.append(finish);
        content.replaceChildren(industrialView(), gate, replies, historyView(data.records, data.synchronized)); return;
      }
      const form = el('form'), fields = new Map(), seed = { name: data.profile.name || '', school: [data.profile.major, data.profile.grade].filter(Boolean).join('，'), introduction: data.profile.bio || '', ...(drafts.get(owner) || {}) };
      form.append(el('p', '助教会整理以下报名资料，连同平台的章节进度、作业记录和成绩一起提交给马淦老师。'));
      if (resubmitId) form.append(el('p', '正在补充一份已退回的申请。'));
      for (const [key, label, maxLength, placeholder] of fieldSpecs) {
        const group = el('label', undefined, 'project-application-field'), input = el(key === 'project' ? 'select' : ['academicResults', 'introduction', 'experience'].includes(key) ? 'textarea' : 'input');
        if (key === 'project') { const placeholderOption=el('option','请选择官网工业项目');placeholderOption.value='';input.append(placeholderOption);for(const project of industrialProjects){const option=el('option',project.title);option.value=project.title;input.append(option);} }
        input.name = key; input.required = true; input.maxLength = maxLength; input.placeholder = placeholder; input.value = key === 'project' ? seed.project || industrialProjects.find(p=>p.id===selectedLabId)?.title || '' : seed[key] || '';
        if (input.tagName === 'TEXTAREA') input.rows = key === 'introduction' ? 4 : 3;
        fields.set(key, input); group.append(el('span', label), input); form.append(group);
        input.addEventListener(key === 'project' ? 'change' : 'input', () => { drafts.set(owner, Object.fromEntries([...fields].map(([name, node]) => [name, node.value]))); pending = null; });
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
          if (!pending) { const files = []; for (const file of selected) files.push({ name: file.name, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }); pending = { fields: values, labProjectId: industrialProjects.find(p=>p.title===values.project)?.id, files, confirmed: checkbox.checked, idempotencyKey: crypto.randomUUID(), expectedEmail: owner, ...(resubmitId ? { resubmitId } : {}) }; }
          if (!current() || token !== generation) return;
          const receipt = await api('POST', pending);
          if (!current() || token !== generation) return;
          drafts.delete(owner);fileDrafts.delete(owner); pending = null; resubmitId = null;
          content.replaceChildren(el('h3', '申请已送达 OA'), el('p', `已提交给${receipt.reviewerName}，当前状态：${receipt.status}。报名编号：${receipt.id.slice(0, 8)}。`), el('p', '老师审核后，再打开“参与实验室项目”可查看处理结果或补充要求。'));
          status.textContent = '报名材料和平台学习记录已保存。'; onReceipt?.(receipt);
        } catch (error) { if (current() && token === generation) status.textContent = error.message; }
        finally { submitting = false; close.disabled = false; for(const control of form.elements)control.disabled=false;submit.disabled = false; }
      };
      content.replaceChildren(industrialView(), form, replies, historyView(data.records, data.synchronized));
    } catch (error) { if (current() && token === generation) { content.replaceChildren(el('p', error.message)); if (error.status === 401) { dialog.close(); onLogin(); } } }
  }
  addEventListener('hashchange', () => { if (location.hash === '#project-application') void open(); else if (location.hash === '#course-projects') void openCourseProjects(); });
  return { open, openCourseProjects, reset, ready() { if (location.hash === '#project-application' && !dialog.open) void open(); else if (location.hash === '#course-projects' && (!dialog.open || (!owner && identity().email))) void openCourseProjects(); } };
}

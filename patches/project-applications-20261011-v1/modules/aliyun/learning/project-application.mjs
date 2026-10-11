import { APPLICATION_DECISION_PATH, APPLICATION_PATH, APPLICATION_MAX_BYTES, APPLICATION_VERSION, applicationContent, applicationEmail, applicationError, applicationHash, applicationId, exactKeys, readApplicationBody, signApplication, validateApplicationFields, validateApplicationFiles, verifyApplication, applicationText } from '../../lib/project-application.mjs';

export function learningApplicationSnapshot({ db, courses, progressFor, graduationSummary, email, now = Date.now() }) {
  const catalogue = courses.filter(course => !course.parentId);
  const chapter = id => { const course = courses.find(c => c.id === id); const parent = courses.find(c => c.id === (course?.parentId || id)); return parent ? { id: parent.id, title: parent.title, index: catalogue.findIndex(c => c.id === parent.id) + 1 } : null; };
  const totals = db.prepare("SELECT COUNT(*) AS submissions,SUM(review_state='done') AS reviewed FROM learning_submissions WHERE lower(email)=? AND created_at<=?").get(email, now);
  const progress = progressFor(email);
  const stats = db.prepare("SELECT COALESCE(json_extract(payload,'$.courseId'),'python-basics') AS course_id,COUNT(*) AS submissions,SUM(review_state='done') AS reviewed,MAX(created_at) AS at FROM learning_submissions WHERE lower(email)=? AND created_at<=? GROUP BY course_id").all(email, now);
  const activity = db.prepare("SELECT course_id,at FROM (SELECT course_id,updated_at AS at FROM learning_course_drafts WHERE lower(email)=? UNION ALL SELECT COALESCE(json_extract(payload,'$.courseId'),'python-basics'),created_at FROM learning_submissions WHERE lower(email)=? UNION ALL SELECT course_id,created_at FROM learning_messages WHERE lower(email)=? AND kind='question') WHERE at<=? ORDER BY at DESC LIMIT 1").get(email, email, email, now);
  const chapterStats = new Map();
  for (const stat of stats) { const entry = chapter(stat.course_id); if (!entry) continue; const row = chapterStats.get(entry.id) || { ...entry, submissions: 0, reviewed: 0, lastSubmittedAt: 0 }; row.submissions += stat.submissions; row.reviewed += stat.reviewed || 0; row.lastSubmittedAt = Math.max(row.lastSubmittedAt, stat.at); chapterStats.set(entry.id, row); }
  const reviews = db.prepare("SELECT id,created_at,review,COALESCE(json_extract(payload,'$.courseId'),'python-basics') AS course_id FROM learning_submissions WHERE lower(email)=? AND created_at<=? AND review_state='done' AND review IS NOT NULL ORDER BY created_at DESC,id LIMIT 3").all(email, now).map(row => ({ id: row.id, chapter: chapter(row.course_id)?.title || row.course_id, at: row.created_at, review: row.review.slice(0, 1000), source: 'ai_tutor_feedback', numericScore: null }));
  const graduation=graduationSummary(email);
  const passed=db.prepare("SELECT result FROM learning_graduation_attempts WHERE lower(email)=? AND status='passed' ORDER BY completed_at DESC LIMIT 1").get(email);
  let checks=[];try{checks=JSON.parse(passed?.result||'{}').checks?.map(check=>({id:check.id,title:check.title,passed:check.passed===true}))||[];}catch{}
  return { eligibility:{canApply:graduation.status==='passed',requiredCourseId:'graduation',requiredCourseTitle:catalogue.find(c=>c.id==='graduation')?.title||'新手村最后一关',reason:graduation.status==='passed'?'已通过新手村最后一关':'请先完成并通过新手村最后一关，再申请参与项目。'}, catalogue:courses.map(c=>({id:c.id,title:c.title,openWithoutApplication:Boolean(c.requiredProject||c.optional||c.parentProject||c.id==='capstone-mower'||courses.find(parent=>parent.id===c.parentId)?.requiredProject),...(c.parentId?{parentId:c.parentId}:{})})), version: APPLICATION_VERSION, source: 'learning_database', capturedAt: new Date(now).toISOString(), totalChapters: catalogue.length, submittedChapters: chapterStats.size, submissionCount: totals.submissions, reviewedCount: totals.reviewed || 0, currentChapter: activity ? chapter(activity.course_id) : null, nextChapter: chapter(progress.currentCourseId), chapters: [...chapterStats.values()].sort((a, b) => a.index - b.index), exemptedChapters: (progress.exemptedCourseIds || []).map(chapter).filter(Boolean), graduation: {...graduation,checks}, reviews, numericGrade: null, gradeNote: '本平台尚无统一数值评分；已提交和助教点评不等于教师验收。' };
}

export function createProjectApplications({ db, env, courses, progressFor, graduationSummary, owner, limit, profile = () => ({}) }) {
  db.exec('CREATE TABLE IF NOT EXISTS learning_project_application_attempts(email TEXT NOT NULL,idem TEXT NOT NULL,application_id TEXT NOT NULL,body_hash TEXT NOT NULL,snapshot TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(email,idem))');
  db.exec('CREATE TABLE IF NOT EXISTS learning_course_access_grants(email TEXT NOT NULL COLLATE NOCASE,course_id TEXT NOT NULL,application_id TEXT NOT NULL,decision_id TEXT NOT NULL,granted_by TEXT NOT NULL,granted_at INTEGER NOT NULL,PRIMARY KEY(email,course_id));CREATE TABLE IF NOT EXISTS learning_project_decisions(id TEXT PRIMARY KEY,application_id TEXT NOT NULL,email TEXT NOT NULL,reply TEXT NOT NULL,courses_json TEXT NOT NULL,reviewer TEXT NOT NULL,created_at INTEGER NOT NULL,body_hash TEXT NOT NULL);CREATE TABLE IF NOT EXISTS learning_project_decision_nonces(nonce TEXT PRIMARY KEY,created_at INTEGER NOT NULL)');
  const locks = new Set();
  const snapshot = email => learningApplicationSnapshot({ db, courses, progressFor, graduationSummary, email });
  async function bridge(payload) {
    if (!env.OA_SERVICE || typeof env.OA_SERVICE.fetch !== 'function' || !env.PUBLIC_LAB_AI_SERVICE_TOKEN) applicationError('OA 报名通道暂不可用，请保留材料后重试。', 503);
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).length > APPLICATION_MAX_BYTES) applicationError('报名材料过大。', 413);
    let response;
    try { response = await env.OA_SERVICE.fetch(new Request(`https://oa.omindos.cn${APPLICATION_PATH}`, { method: 'POST', headers: await signApplication(body, env.PUBLIC_LAB_AI_SERVICE_TOKEN), body, redirect: 'manual', signal: AbortSignal.timeout(45000) })); }
    catch { applicationError('尚未确认 OA 已收到，申请材料仍保留，请重试同一份申请。', 503); }
    if (!response.headers.get('content-type')?.startsWith('application/json')) { await response.body?.cancel(); applicationError('OA 申请通道暂不可用。', 503); }
    let result; try { result = JSON.parse(await readApplicationBody(response, 128 * 1024)); } catch { applicationError('OA 未返回完整的申请回执，请重试。', 503); }
    if (!response.ok) applicationError([400, 409, 413, 429].includes(response.status) ? result.error || '申请未被接收。' : 'OA 申请通道暂不可用，请稍后重试。', [400, 409, 413, 429].includes(response.status) ? response.status : 503);
    if (result.received !== true) applicationError('未确认 OA 已收到申请，请重试。', 503);
    return result;
  }
  async function handle(request) {
    const email = applicationEmail(await owner(request));
    if (request.method === 'GET') {
      const learning = snapshot(email);
      let records = [], synchronized = true;
      try { limit(email, 'project-status', 120); records = (await bridge({ operation: 'list', email })).records; if (!Array.isArray(records)) throw new Error(); }
      catch { synchronized = false; records = db.prepare('SELECT receipt FROM learning_project_application_attempts WHERE email=? AND receipt IS NOT NULL ORDER BY created_at DESC LIMIT 20').all(email).map(row => ({ ...JSON.parse(row.receipt), cached: true })); }
      const replies=db.prepare('SELECT id,application_id AS applicationId,reply,courses_json,reviewer,created_at AS createdAt FROM learning_project_decisions WHERE lower(email)=? ORDER BY created_at DESC LIMIT 20').all(email).map(row=>({...row,courseIds:JSON.parse(row.courses_json),courses:JSON.parse(row.courses_json).map(id=>courses.find(c=>c.id===id)?.title||id)}));
      return { email, profile: profile(email), learning, records, synchronized, replies, reviewerName: '马淦' };
    }
    if (request.method !== 'POST') applicationError('不支持的方法。', 405);
    if (request.headers.get('origin') !== new URL(env.APP_ORIGIN).origin) applicationError('请从课程助教提交。', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) applicationError('需要 JSON 请求。', 415);
    let data; try { data = JSON.parse(await readApplicationBody(request)); } catch (error) { if (error.status) throw error; applicationError('报名资料格式不正确。'); }
    if (!exactKeys(data, ['fields', 'files', 'confirmed', 'idempotencyKey', 'resubmitId', 'expectedEmail']) || data.confirmed !== true) applicationError('请核对资料并确认提交给马淦。');
    if (applicationEmail(data.expectedEmail) !== email) applicationError('登录账号已变化，请重新打开报名入口。', 409);
    const fields = validateApplicationFields(data.fields); validateApplicationFiles(data.files || []);
    const idem = applicationId(data.idempotencyKey), resubmitId = data.resubmitId ? applicationId(data.resubmitId) : null;
    if (resubmitId && !db.prepare('SELECT 1 FROM learning_project_application_attempts WHERE email=? AND application_id=? AND receipt IS NOT NULL').get(email, resubmitId)) applicationError('未找到自己的待补充申请。', 404);
    const hash = await applicationHash(JSON.stringify({ fields, files: data.files || [], resubmitId }));
    let old = db.prepare('SELECT * FROM learning_project_application_attempts WHERE email=? AND idem=?').get(email, idem);
    if (old && old.body_hash !== hash) applicationError('这次提交编号已用于其他材料，请重新核对后提交。', 409);
    if (old?.receipt) return { ...JSON.parse(old.receipt), idempotent: true };
    const lock = `${email}:${idem}`;
    if (locks.has(lock)) applicationError('同一份申请正在提交，请稍后查看。', 409);
    locks.add(lock);
    try {
      if (!old) {
        if(!snapshot(email).eligibility.canApply)applicationError('请先完成并通过新手村最后一关，再申请参与项目。',403);
        limit(email, 'project-submit', 6);
        old = { email, idem, application_id: resubmitId || crypto.randomUUID(), snapshot: JSON.stringify(snapshot(email)), body_hash: hash };
        db.prepare('INSERT INTO learning_project_application_attempts(email,idem,application_id,body_hash,snapshot,state,created_at) VALUES(?,?,?,?,?,?,?)').run(email, idem, old.application_id, hash, old.snapshot, 'sending', Date.now());
      }
      const learning = JSON.parse(old.snapshot);
      const result = await bridge({ operation: 'submit', email, applicationId: old.application_id, submissionKey: idem, fields, files: data.files || [], learning, content: applicationContent(fields, learning), confirmed: true });
      const receipt = result.application;
      if (!receipt || receipt.id !== old.application_id) applicationError('OA 回执编号不一致，请稍后重试。', 503);
      db.prepare('UPDATE learning_project_application_attempts SET state=?,receipt=? WHERE email=? AND idem=?').run('submitted', JSON.stringify(receipt), email, idem);
      return { ...receipt, received: true };
    } finally { locks.delete(lock); }
  }
  async function handleDecision(request) {
    const {payload:data,nonce}=await verifyApplication(request,env.PUBLIC_LAB_AI_SERVICE_TOKEN,Date.now(),APPLICATION_DECISION_PATH);
    if(!exactKeys(data,['applicationId','decisionId','email','reply','courseIds','reviewer','approvedAt']))applicationError('回复格式不正确。');
    if(typeof data.approvedAt!=='string'||!Number.isFinite(Date.parse(data.approvedAt)))applicationError('审核时间不正确。');
    const email=applicationEmail(data.email),id=applicationId(data.applicationId),decisionId=applicationId(data.decisionId),reply=applicationText(data.reply,1000,'老师回复',2),reviewer=applicationEmail(data.reviewer);
    if(!db.prepare('SELECT 1 FROM learning_project_application_attempts WHERE email=? AND application_id=?').get(email,id))applicationError('未找到这位学生的项目申请。',404);
    if(!Array.isArray(data.courseIds)||data.courseIds.length>100||new Set(data.courseIds).size!==data.courseIds.length||data.courseIds.some(id=>!courses.some(c=>c.id===id)))applicationError('课程权限选择不正确。');
    const courseIds=[...new Set(data.courseIds.flatMap(id=>[id,...courses.filter(c=>c.parentId===id).map(c=>c.id)]))];
    const hash=await applicationHash(JSON.stringify(data)),old=db.prepare('SELECT * FROM learning_project_decisions WHERE id=?').get(decisionId);
    if(old){if(old.body_hash!==hash)applicationError('回复编号已用于其他内容。',409);return {received:true,delivered:true,courseIds:JSON.parse(old.courses_json),idempotent:true};}
    const claimed=db.prepare('INSERT OR IGNORE INTO learning_project_decision_nonces VALUES(?,?)').run(nonce,Date.now());
    if(claimed.changes!==1)applicationError('服务请求已处理。',409);
    db.prepare('DELETE FROM learning_project_decision_nonces WHERE created_at<?').run(Date.now()-3600000);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO learning_project_decisions VALUES(?,?,?,?,?,?,?,?)').run(decisionId,id,email,reply,JSON.stringify(courseIds),reviewer,Date.now(),hash);
      for(const courseId of courseIds)db.prepare('INSERT INTO learning_course_access_grants VALUES(?,?,?,?,?,?) ON CONFLICT(email,course_id) DO UPDATE SET application_id=excluded.application_id,decision_id=excluded.decision_id,granted_by=excluded.granted_by,granted_at=excluded.granted_at').run(email,courseId,id,decisionId,reviewer,Date.now());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {received:true,delivered:true,courseIds};
  }
  return { handle, snapshot, handleDecision }; 
}

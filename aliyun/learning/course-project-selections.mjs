import { academicSemester, courseProjects, projectCourseIds } from '../../lib/project-catalogue.mjs';
import { applicationContent, applicationEmail, applicationError, applicationId, exactKeys, readApplicationBody } from '../../lib/project-application.mjs';

export function createCourseProjectSelections({ db, env, courses, owner, limit, snapshot, profile, bridge, clock = Date.now, startTimer = true }) {
  db.exec(`CREATE TABLE IF NOT EXISTS learning_course_project_selections(
    email TEXT NOT NULL COLLATE NOCASE,semester_id TEXT NOT NULL,semester_label TEXT NOT NULL,
    course_id TEXT NOT NULL,application_id TEXT NOT NULL UNIQUE,idem TEXT NOT NULL,
    learning_json TEXT NOT NULL,fields_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
    receipt TEXT,error TEXT,created_at INTEGER NOT NULL,next_retry_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(email,semester_id),UNIQUE(email,idem));`);
  const sending = new Set();
  const publicRecord = row => row ? { courseId: row.course_id, courseTitle: courseProjects.find(c => c.id === row.course_id)?.title || row.course_id, semester: { id: row.semester_id, label: row.semester_label }, applicationId: row.application_id, selectedAt: row.created_at, openedCourseIds: projectCourseIds(courses, row.course_id), oaDelivered: row.state === 'delivered', oaStatus: row.receipt ? JSON.parse(row.receipt).status : '待同步', reviewerName: '马淦' } : null;
  async function synchronize(row) {
    if (row.state === 'delivered' || sending.has(row.application_id)) return;
    sending.add(row.application_id);
    try {
      const fields = JSON.parse(row.fields_json), learning = JSON.parse(row.learning_json);
      const selection = { courseId: row.course_id, semesterId: row.semester_id, semesterLabel: row.semester_label };
      const result = await bridge({ operation: 'submit', kind: 'course_project_selection', selection, email: row.email, applicationId: row.application_id, submissionKey: row.idem, fields, files: [], learning, content: applicationContent(fields, learning, { selection }), confirmed: true }, 8000);
      if (result.application?.id !== row.application_id) applicationError('选课回执编号不一致。', 503);
      db.prepare("UPDATE learning_course_project_selections SET state='delivered',receipt=?,error=NULL WHERE application_id=?").run(JSON.stringify(result.application), row.application_id);
    } catch(error) {
      db.prepare("UPDATE learning_course_project_selections SET error=?,next_retry_at=? WHERE application_id=? AND state!='delivered'").run(error.status ? error.message : 'OA 待同步', clock() + 60000, row.application_id);
    } finally { sending.delete(row.application_id); }
  }
  async function flushPending() {
    const rows = db.prepare("SELECT * FROM learning_course_project_selections WHERE state!='delivered' AND next_retry_at<=? ORDER BY created_at LIMIT 10").all(clock());
    for (const row of rows) await synchronize(row);
  }
  const timer = startTimer ? setInterval(() => void flushPending().catch(() => {}), 30000) : null;
  timer?.unref();
  const mine = (email, semester) => db.prepare('SELECT * FROM learning_course_project_selections WHERE email=? AND semester_id=?').get(email, semester.id);
  function chosenCourseIds(email) {
    return [...new Set(db.prepare('SELECT course_id FROM learning_course_project_selections WHERE email=?').all(email).flatMap(row => projectCourseIds(courses, row.course_id)))];
  }
  async function handle(request) {
    const email = applicationEmail(await owner(request)), semester = academicSemester(clock());
    if (request.method === 'GET') {
      let row = mine(email, semester), synchronized = false;
      if (row?.state === 'delivered') {
        try {
          limit(email, 'course-project-status', 120);
          const result = await bridge({ operation: 'list', email }, 8000), receipt = result.records?.find(r => r.id === row.application_id);
          if (receipt) { db.prepare('UPDATE learning_course_project_selections SET receipt=? WHERE application_id=?').run(JSON.stringify(receipt), row.application_id); row = mine(email, semester); synchronized = true; }
        } catch { /* Keep the last receipt without claiming the status is current. */ }
      }
      const replies = row ? db.prepare('SELECT id,reply,courses_json,created_at AS createdAt FROM learning_project_decisions WHERE email=? AND application_id=? ORDER BY created_at DESC LIMIT 20').all(email,row.application_id).map(record=>({...record,courseIds:JSON.parse(record.courses_json),courses:JSON.parse(record.courses_json).map(id=>courses.find(c=>c.id===id)?.title||id)})) : [];
      return { email, semester, selected: publicRecord(row), synchronized, replies, history: db.prepare('SELECT * FROM learning_course_project_selections WHERE email=? ORDER BY created_at DESC LIMIT 20').all(email).map(publicRecord), projects: courseProjects };
    }
    if (request.method !== 'POST') applicationError('不支持的方法。', 405);
    if (request.headers.get('origin') !== new URL(env.APP_ORIGIN).origin || request.headers.get('sec-fetch-site') === 'cross-site') applicationError('请从课程页面选课。', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) applicationError('需要 JSON 请求。', 415);
    let data; try { data = JSON.parse(await readApplicationBody(request, 4096)); } catch(error) { if (error.status) throw error; applicationError('选课格式不正确。'); }
    if (!exactKeys(data, ['courseId', 'idempotencyKey', 'expectedEmail', 'expectedSemesterId', 'confirmed']) || data.confirmed !== true) applicationError('请确认本学期的项目选题。');
    if (applicationEmail(data.expectedEmail) !== email) applicationError('登录账号已变化，请重新打开选课入口。', 409);
    const idem = applicationId(data.idempotencyKey), project = courseProjects.find(c => c.id === data.courseId);
    if (!project || !courses.some(c => c.id === project.id)) applicationError('请从课程项目列表选择一个项目。');
    let row = db.prepare('SELECT * FROM learning_course_project_selections WHERE email=? AND idem=?').get(email, idem);
    if (row && (row.course_id !== project.id || row.semester_id !== data.expectedSemesterId)) applicationError('这次选课编号已用于其他选题。', 409);
    if (!row && data.expectedSemesterId !== semester.id) applicationError('学期已变化，请刷新选课列表后重试。', 409);
    if (!row) {
      row = mine(email, semester);
      if (row && row.course_id !== project.id) applicationError(`本学期已选择“${courseProjects.find(c => c.id === row.course_id)?.title || row.course_id}”，每学期只能选择一个课程项目。`, 409);
      if (!row) {
        limit(email, 'course-project-selection', 20);
        const person = profile(email) || {};
        const fields = { name: String(person.name || email).slice(0, 60), school: [person.major, person.grade].filter(Boolean).join('，').slice(0, 120) || '学校与专业资料尚未填写', academicResults: '课程选题未要求补填自述成绩；请查看下方平台学习记录。', introduction: String(person.bio || '学生已确认本学期课程项目选题。').slice(0, 800), experience: '课程选题未要求补填项目经历。', project: project.title, availability: semester.label };
        // This synchronous insert reserves the quota before any asynchronous OA call.
        db.prepare('INSERT OR IGNORE INTO learning_course_project_selections(email,semester_id,semester_label,course_id,application_id,idem,learning_json,fields_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(email, semester.id, semester.label, project.id, crypto.randomUUID(), idem, JSON.stringify(snapshot(email, clock())), JSON.stringify(fields), clock());
        row = mine(email, semester);
        if (row?.course_id !== project.id) applicationError('本学期已有其他选题，请刷新列表。', 409);
      }
    }
    await synchronize(row);
    return { email, selected: publicRecord(db.prepare('SELECT * FROM learning_course_project_selections WHERE application_id=?').get(row.application_id)), opened: true };
  }
  return { handle, chosenCourseIds, flushPending, close() { if (timer) clearInterval(timer); } };
}

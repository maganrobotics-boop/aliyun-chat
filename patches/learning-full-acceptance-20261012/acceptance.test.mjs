import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
const root=process.env.LEARNING_CANDIDATE_ROOT;
if(!root)throw Error('Set LEARNING_CANDIDATE_ROOT to an isolated release copy');
const {createLearning}=await import(pathToFileURL(path.join(root,'aliyun/learning/service-core.mjs')));
const basic=JSON.parse(readFileSync(path.join(root,'chat-cloudflare/public/learning/curriculum.json')));
const advanced=JSON.parse(readFileSync(path.join(root,'chat-cloudflare/public/learning/advanced-courses.json'))).flatMap(t=>t.courses||[t]);
const {courseProjects}=await import(pathToFileURL(path.join(root,'lib/project-catalogue.mjs')));
const courses=[...basic,...advanced.filter(c=>!c.hiddenWithinProject)];
const origin='https://acceptance.example';
const answer=courseId=>({courseId,kind:'answer',question:'本次隔离验收如何核对保存和进度？',reflection:'这是隔离测试生成的合成作业，仅测试提交和状态协议，不是真实学生成果或教师验收记录。'});
function fixture(){
 const folder=mkdtempSync('/tmp/learning-full-acceptance-'),databasePath=path.join(folder,'test.sqlite');
 const worker={async fetch(r){const email=r.headers.get('cookie');return Response.json(new URL(r.url).pathname==='/api/visitor/status'?{signedIn:!!email,user:email?{email}:null}:{agreement:{approved:true}});}};
 let calls=0,offline=false;
 const options={root,databasePath,worker,env:{APP_ORIGIN:origin},reviewer:async()=>{calls++;if(offline)throw Error('injected-review-outage');return '隔离点评服务返回的合成反馈。已保存测试作业，但不产生任何真实成绩或教师验收。';}};
 let service=createLearning(options);
 const req=(route,method='GET',data,email='audit@example.test')=>service.handle(new Request(origin+'/api/learning/'+route,{method,headers:{cookie:email,origin,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}));
 const submit=(id,key='acceptance-'+id,email)=>req('submissions','POST',{payload:answer(id),idempotencyKey:key},email);
 const grant=email=>{const db=new DatabaseSync(databasePath);db.prepare("INSERT OR IGNORE INTO learning_access_grants VALUES(?,'all_courses',?,?,?)").run(email,Date.now(),'fixture@example.test','isolated test only');db.close();};
 return {req,submit,grant,calls:()=>calls,setOffline:value=>offline=value,restart(){service.close();service=createLearning(options);},close(){service.close();},folder};
}

for(const course of courses)test('chapter storage lifecycle: '+course.id,async()=>{
 const f=fixture();try{
  f.grant('audit@example.test');
  const p=answer(course.id);
  assert.equal((await f.req('state?courseId='+course.id)).status,200);
  const draft=await f.req('draft','PUT',{revision:0,payload:p});assert.equal(draft.status,200);
  const saved=await(await f.submit(course.id)).json();assert.equal(saved.saved,true);assert.ok(saved.id);
  const concurrent=await Promise.all(Array.from({length:5},()=>f.submit(course.id)));
  for(const r of concurrent)assert.equal((await r.json()).id,saved.id);
  assert.equal((await f.req('submissions/'+saved.id,'GET',undefined,'other@example.test')).status,404);
  const reviewed=await(await f.req('submissions/'+saved.id+'/review','POST',{})).json();assert.equal(reviewed.reviewState,'done');assert.equal(f.calls(),1);assert.match(reviewed.status,/尚未正式验收/);
  f.restart();
  const state=await(await f.req('state?courseId='+course.id)).json();assert.equal(state.submissions.length,1);assert.equal(state.submissions[0].id,saved.id);for(const [key,value] of Object.entries(p))assert.deepEqual(state.submissions[0].payload[key],value);assert.equal(state.submissions[0].reviewState,'done');assert.equal(state.cloudDraft?.payload?.reflection||state.draft?.payload?.reflection,p.reflection);
  assert.equal((await(await f.submit(course.id)).json()).id,saved.id,'response-loss retry after restart');
  assert.equal((await f.req('draft','PUT',{revision:0,payload:{...p,reflection:p.reflection+'新修改'}})).status,409,'stale draft cannot overwrite');
 }finally{f.close();}
});

test('normal learner progresses through common chapters without choosing every mutually exclusive project',async()=>{
 const f=fixture();try{
  const ids=[...basic.map(c=>c.id),'ros2-development','robot-perception','localization-slam','autonomous-navigation','manipulation-foundations'];
  for(const id of ids){const r=await f.submit(id);assert.equal(r.status,201,id+' '+await r.clone().text());}
  const p=(await(await f.req('progress')).json()).progress;
  assert.ok(p.availableCourseIds.includes('robot-learning'),'robot-learning should open after common foundations; current='+p.currentCourseId);
  assert.equal((await f.req('state?courseId=capstone-patrol')).status,403,'unselected project stays locked');
  for(const id of ['robot-learning','robot-agent','robot-mechanical-systems','robot-electrical-systems','capstone-integration'])assert.equal((await f.submit(id)).status,201,id);
  const final=(await(await f.req('progress')).json()).progress;
  for(const project of courseProjects){assert.ok(!final.submittedCourseIds.includes(project.id));assert.ok(!final.exemptedCourseIds.includes(project.id));}
 }finally{f.close();}
});

test('project selection opens only chosen project; retry is stable and second choice rejected',async()=>{
 const f=fixture();try{
  for(const [n,project] of courseProjects.entries()){
   const email=`selection-${n}@example.test`,before=await(await f.req('course-project-selection','GET',undefined,email)).json();
   const payload={courseId:project.id,idempotencyKey:crypto.randomUUID(),expectedEmail:email,expectedSemesterId:before.semester.id,confirmed:true,name:'隔离验收账户',studentNumber:'AUDIT-'+n};
   const r=await f.req('course-project-selection','POST',payload,email);assert.equal(r.status,200);const selected=await r.json();
   assert.equal(selected.opened,true);assert.equal(selected.selected.oaDelivered,false,'no real OA connector configured');
   assert.equal((await f.req('state?courseId='+project.id,'GET',undefined,email)).status,200);
   assert.equal((await(await f.req('course-project-selection','POST',payload,email)).json()).selected.applicationId,selected.selected.applicationId);
   const other=courseProjects[(n+1)%courseProjects.length];assert.equal((await f.req('course-project-selection','POST',{...payload,idempotencyKey:crypto.randomUUID(),courseId:other.id},email)).status,409);
   assert.equal((await f.req('state?courseId='+other.id,'GET',undefined,email)).status,403);
   assert.equal((await f.req('submissions','POST',{payload:answer(project.id),idempotencyKey:'selected-project-'+n},email)).status,201);
  }
 }finally{f.close();}
});

test('Newbie UI response-loss retry keeps the same submission after a page reload',async()=>{
 const f=fixture(),storage=new Map(),keys=[];let loseResponse=true;
 const source=readFileSync(path.join(root,'chat-cloudflare/public/learning/app.js'),'utf8');
 const functions=['current','changed','payload','saveLocal','applyDraft','submit','syncDatasetSelection'].map(name=>source.split('\n').find(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('))).filter(Boolean).join('\n');
 function page(){
  const elements={};for(const id of ['code','csv','reflection','question','submission-kind','output','tests','stale','save-state','submit','review-status'])elements[id]={value:'',textContent:'',focus(){}};
  const c={JSON,Date,crypto,$:id=>elements[id],localStorage:{setItem:(k,v)=>storage.set(k,v)},localKey:'test-only:registration',courseId:'registration',authGeneration:1,email:'audit@example.test',pendingSubmission:null,lastRun:null,active:false,advancedSelection:null,exercise:{starter:'{}',datasets:{normal:'{}'}},syncStructuredForm(){},note(){},tab(){},applyCourseProgress(){},review(){},api:async(route,method,data)=>{keys.push(data.idempotencyKey);const r=await f.req(route,method,data);if(!r.ok)throw Error(await r.text());const body=await r.json();if(loseResponse){loseResponse=false;throw new TypeError('response lost after server committed');}return body;}};
  // Only state/submit functions from the real app are evaluated; no browser is emulated.
  vm.createContext(c);vm.runInContext(functions,c);return c;
 }
 try{
  let p=page();p.applyDraft({...answer('registration'),code:'{}',csv:'{}'});await p.submit();
  p=page();p.applyDraft(JSON.parse(storage.get('test-only:registration')));await p.submit();
  const state=await(await f.req('state?courseId=registration')).json();
  assert.equal(state.submissions.length,1,'reload after lost response must not create a duplicate');assert.equal(keys[0],keys[1]);
 }finally{f.close();}
});

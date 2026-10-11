import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=process.env.LEARNING_CANDIDATE_ROOT;
if(!root)throw new Error('Set LEARNING_CANDIDATE_ROOT to the patched release copy.');
const {createLearning}=await import(pathToFileURL(path.join(root,'aliyun/learning/service-core.mjs')));
const origin='https://chat.example';
const payload={courseId:'registration',kind:'answer',question:'如何确认提交成功？',reflection:'应当看到服务器返回的提交编号，并且在历史记录中可以重新打开这次提交；点评完成与否应当单独显示。'};
function fixture(reviewer){
  let calls=0;
  const worker={async fetch(request){
    const url=new URL(request.url),email=request.headers.get('cookie');
    if(url.pathname==='/api/visitor/status')return Response.json({signedIn:!!email,user:email?{email}:null});
    if(url.pathname==='/api/newbie/dashboard')return Response.json({agreement:{approved:true}});
    return new Response('',{status:404});
  }};
  const service=createLearning({root,worker,env:{APP_ORIGIN:origin},databasePath:':memory:',reviewer:async()=>{calls++;if(reviewer)return reviewer();return '已核对提交记录与点评状态，证据完整；正式验收仍需由教师确认。';}});
  const req=(route,method='GET',data,email='student@example.test')=>service.handle(new Request(origin+'/api/learning/'+route,{method,headers:{cookie:email,origin,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}));
  const submit=n=>req('submissions','POST',{payload,idempotencyKey:'quota-fixture-'+n});
  return {service,req,submit,calls:()=>calls};
}

test('12 reviews/hour: next saved submission survives 429, refresh, retry and hour rollover',async t=>{
  let clock=Date.UTC(2026,9,12,4,10,0);
  t.mock.method(Date,'now',()=>clock);
  const f=fixture();
  try{
    const saved=[];
    for(let n=0;n<13;n++){
      const response=await f.submit(n);assert.equal(response.status,201);
      saved.push(await response.json());assert.equal(saved[n].saved,true);
    }
    for(const s of saved.slice(0,12)){
      const response=await f.req('submissions/'+s.id+'/review','POST',{});
      assert.equal(response.status,200);assert.equal((await response.json()).reviewState,'done');
    }
    const pending=saved[12];
    const response=await f.req('submissions/'+pending.id+'/review','POST',{});
    assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'3000');
    const limited=await response.json();
    assert.equal(limited.saved,true);assert.equal(limited.id,pending.id);assert.equal(limited.reviewState,'pending');
    assert.equal(limited.code,'review_rate_limited');assert.equal(limited.retryAfter,3000);assert.equal(f.calls(),12);
    const state=await(await f.req('state?courseId=registration')).json();
    assert.equal(state.submissions.length,13);
    assert.equal(state.submissions.find(s=>s.id===pending.id).retryAfter,3000);
    const duplicate=await(await f.submit(12)).json();assert.equal(duplicate.id,pending.id);
    assert.equal((await f.req('submissions/'+pending.id+'/review','POST',{},'other@example.test')).status,404);
    assert.equal((await f.req('submissions/'+saved[0].id+'/review','POST',{})).status,200);assert.equal(f.calls(),12);
    clock+=3000001;
    const reopened=await(await f.req('submissions/'+pending.id)).json();assert.equal(reopened.retryAfter,0);
    const retried=await(await f.req('submissions/'+pending.id+'/review','POST',{})).json();
    assert.equal(retried.id,pending.id);assert.equal(retried.reviewState,'done');assert.equal(f.calls(),13);
    assert.match(retried.status,/尚未正式验收/);
  }finally{f.service.close();}
});

test('submission quota reports unsaved and does not create a 41st submission',async()=>{
  const f=fixture();try{
    for(let n=0;n<40;n++)assert.equal((await f.submit(n)).status,201);
    const response=await f.submit(40);assert.equal(response.status,429);
    const result=await response.json();assert.notEqual(result.saved,true);assert.match(result.error,/本次尚未提交/);
    assert.ok(Number(response.headers.get('Retry-After'))>0);
    const state=await(await f.req('state?courseId=registration')).json();assert.equal(state.progress.submissionCount,40);
  }finally{f.service.close();}
});

test('review service failure retains immutable submission and can retry without resubmitting',async()=>{
  let fail=true;
  const f=fixture(()=>{if(fail)throw Error('temporary outage');return '已检查任务证据，当前回答已保存，正式验收仍由教师确认。';});
  try{
    const saved=await(await f.submit(0)).json();
    const failed=await(await f.req('submissions/'+saved.id+'/review','POST',{})).json();
    assert.equal(failed.saved,true);assert.equal(failed.reviewState,'failed');assert.equal(failed.payload.reflection,payload.reflection);
    fail=false;
    const retry=await(await f.req('submissions/'+saved.id+'/review','POST',{})).json();
    assert.equal(retry.id,saved.id);assert.equal(retry.reviewState,'done');
  }finally{f.service.close();}
});

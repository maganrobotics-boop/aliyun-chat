// Actual deployed Pyodide binaries in a Node VM. This is NOT a mobile/CSP/browser network test.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
const root=process.env.LEARNING_CANDIDATE_ROOT, evidence=process.env.LEARNING_EVIDENCE_ROOT||fileURLToPath(new URL('./fixtures',import.meta.url));
if(!root||!evidence)throw Error('Set isolated release and evidence roots');
const assets=path.join(root,'chat-cloudflare/public/learning');
const source=readFileSync(path.join(assets,'runner.js'),'utf8');
const {labs,harnesses}=await import(pathToFileURL(path.join(assets,'labs.mjs')));
const {advancedLabs}=await import(pathToFileURL(path.join(assets,'advanced-labs.mjs')));
const exercise=JSON.parse(readFileSync(path.join(assets,'exercise.json')));
const cases={toolkit:'pyDistance','python-basics':'pyLog','ros2-simulation':'pyCircle','mini-project':'pyPlan','ros2-development':'pyTransform','robot-perception':'pyCloud','localization-slam':'pyFuse','autonomous-navigation':'pyVelocity','capstone-patrol':'pyPatrol','robot-manipulation-pick-place':'pyPick','robot-learning':'pySplit','robot-agent':'pyDecide','capstone-mobile-agent':'pyVerify','capstone-dual-arm':'pyConflicts','capstone-mower':'pyCoverage'};

async function execute({code,csv='{}',harness='exec(student_source)',fault,slow=false}){
 const messages=[],requests=[],workers=[],blobs=new Map();let listener,serial=0,resolve;
 const done=new Promise(r=>resolve=r);
 const parent={postMessage(m){messages.push(m);if(m.type==='done'||m.type==='error')resolve(m);}};
 class U extends URL {static createObjectURL(blob){const url='blob:'+ ++serial;blobs.set(url,blob);return url;}static revokeObjectURL(url){blobs.delete(url);}}
 class W {
  constructor(url){this.blob=blobs.get(url);this.attempt=workers.length;workers.push(this);}
  terminate(){this.terminated=true;}
  async postMessage(request){
   const nativeFetch=async(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url),name=url.pathname.split('/').at(-1);
    assert.equal(url.origin,'https://course.example');assert.match(name,/^[a-zA-Z0-9_.-]+$/);
    requests.push({name,attempt:this.attempt,cache:options?.cache});
    const bytes=readFileSync(path.join(assets,'runtime',name));
    if(fault==='disconnect'&&this.attempt===0&&name.endsWith('.zip'))throw new TypeError('injected connection reset');
    if(fault==='truncated'&&this.attempt===0&&name.endsWith('.zip'))return new Response(bytes.subarray(0,100));
    if(fault==='always-fail'&&name.endsWith('.zip'))return new Response('',{status:503});
    if(slow&&name.endsWith('.wasm')){let offset=0;return new Response(new ReadableStream({async pull(controller){await new Promise(r=>setTimeout(r,5));if(offset===bytes.length){controller.close();return;}const end=Math.min(offset+262144,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;}}),{headers:{'Content-Type':'application/wasm'}});}
    return new Response(bytes,{headers:{'Content-Type':name.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});
   };
   const context=vm.createContext({console,URL,URLSearchParams,TextEncoder,TextDecoder,Response,Request,Headers,AbortSignal,AbortController,performance,crypto:webcrypto,fetch:nativeFetch,setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,location:new URL('https://course.example/learning/runtime/worker.js'),navigator:{userAgent:'Node WASM acceptance'},postMessage:m=>{if(!this.terminated)this.onmessage?.({data:m});}});
   context.self=context;context.importScripts=(...urls)=>{for(const url of urls){const name=new URL(url).pathname.split('/').at(-1);vm.runInContext(readFileSync(path.join(assets,'runtime',name),'utf8'),context,{filename:name});}};
   vm.runInContext(await this.blob.text(),context);await context.onmessage({data:request});
  }
 }
 vm.runInNewContext(source,{URL:U,Blob,Worker:W,parent,location:{href:'https://course.example/learning/runner.html'},addEventListener:(_,fn)=>listener=fn,setTimeout,clearTimeout});
 listener({source:parent,data:{channel:'arts-python-v1',type:'run',id:'audit-run',code,csv,harness}});
 const terminal=await done;return {messages,terminal,requests,workers};
}

for(const [id,file] of Object.entries(cases))test('real Python public checks: '+id,async()=>{
 const lab=advancedLabs[id]||labs[id];
 const csv=lab.data||lab.datasets?.normal||exercise.datasets.normal;
 const harness=lab.harness||harnesses[id]||exercise.harness;
 assert.equal(typeof harness,'string',id+' harness');
 const result=await execute({code:readFileSync(path.join(evidence,'python',file+'.py'),'utf8'),csv,harness});
 assert.equal(result.terminal.type,'done',JSON.stringify(result.messages));
 const output=result.messages.filter(m=>m.type==='output').map(m=>m.text).join('\n');
 assert.match(output,/PASS/);assert.doesNotMatch(output,/FAIL|Traceback/);
 assert.equal(result.messages.filter(m=>m.type==='running').length,1);
});
for(const fault of ['disconnect','truncated'])test('actual runtime recovery after '+fault+' with delayed WASM chunks',async()=>{
 const f=await execute({code:"import encodings, math\nprint('EXECUTED_ONCE', math.sqrt(81))",fault,slow:true});
 assert.equal(f.terminal.type,'done');assert.equal(f.workers.length,2);
 assert.equal(f.messages.filter(m=>m.type==='running').length,1);
 assert.equal(f.messages.filter(m=>m.type==='output'&&m.text.includes('EXECUTED_ONCE')).length,1);
 assert.ok(f.requests.some(r=>r.attempt===1&&r.cache==='reload'));
});
test('persistent download failure stops after two attempts before any Python runs',async()=>{
 const f=await execute({code:"print('MUST_NOT_EXECUTE')",fault:'always-fail'});
 assert.equal(f.terminal.type,'error');assert.equal(f.terminal.phase,'initializing');assert.equal(f.workers.length,2);
 assert.equal(f.messages.filter(m=>m.type==='running').length,0);assert.match(f.terminal.text,/代码尚未执行/);
});

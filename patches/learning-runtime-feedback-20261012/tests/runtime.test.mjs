import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../modules/chat-cloudflare/public/learning/runner.js',import.meta.url),'utf8');
function fixture({constructorFails=false}={}) {
  const messages=[],workers=[],timers=new Map(),blobs=new Map();let listener,serial=0;
  const parent={postMessage:message=>messages.push(message)};
  class Url extends URL {
    static createObjectURL(blob){const key='blob:'+ ++serial;blobs.set(key,blob);return key;}
    static revokeObjectURL(key){blobs.delete(key);}
  }
  class Worker {
    constructor(url){if(constructorFails)throw Error('worker unavailable');this.url=url;workers.push(this);}
    postMessage(message){this.request=message;}
    terminate(){this.terminated=true;}
    emit(type,rest={}){this.onmessage({data:{type,id:this.request.id,...rest}});}
  }
  vm.runInNewContext(source,{URL:Url,Blob,Worker,parent,location:{href:'https://course.example/learning/runner.html'},addEventListener:(_,fn)=>{listener=fn;},setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  const request={channel:'arts-python-v1',type:'run',id:'run-a',code:'print(2)',csv:'{}',harness:'exec(student_source)'};
  const send=data=>listener({source:parent,data:{...request,...data}});
  const tick=()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();};
  return {messages,workers,timers,blobs,send,tick,listener,parent};
}
test('initialization failure retries once in a fresh worker, discarding stale output',()=>{
  const f=fixture();f.send();const first=f.workers[0];
  first.emit('output',{text:'init stderr'});assert.equal(f.messages.filter(x=>x.type==='output').length,0);
  first.emit('error',{phase:'initializing',text:'No module named encodings'});
  assert.equal(f.workers.length,2);assert.equal(first.terminated,true);
  first.emit('done');assert.equal(f.messages.filter(x=>x.type==='done').length,0);
  const second=f.workers[1];second.emit('running');assert.equal(f.timers.size,0);
  second.emit('output',{text:'2'});second.emit('done');
  assert.equal(f.messages.filter(x=>x.type==='done').length,1);assert.equal(second.terminated,true);
  assert.deepEqual(f.workers.map(w=>w.request.code),['print(2)','print(2)']);
});
test('two initialization timeouts terminate rather than retry forever',()=>{
  const f=fixture();f.send();assert.equal([...f.timers.values()][0].ms,45000);
  f.tick();assert.equal(f.workers.length,2);f.tick();
  assert.equal(f.timers.size,0);assert.equal(f.messages.at(-1).phase,'initializing');
  assert.match(f.messages.at(-1).text,/代码尚未执行/);assert.ok(f.workers.every(w=>w.terminated));
});
test('manual stop cancels recovery and ignores late worker events',()=>{
  const f=fixture();f.send();const old=f.workers[0];f.send({type:'stop'});
  old.emit('error',{text:'late failure'});assert.equal(f.workers.length,1);assert.equal(f.timers.size,0);
  f.send({id:'run-b'});assert.equal(f.workers.length,2);assert.equal(f.workers[1].request.id,'run-b');
});
test('student exceptions are never automatically re-executed',()=>{
  const f=fixture();f.send();f.workers[0].emit('running');f.workers[0].emit('error',{text:'AssertionError',phase:'running'});
  assert.equal(f.workers.length,1);assert.equal(f.messages.at(-1).phase,'running');assert.equal(f.messages.at(-1).text,'AssertionError');
});
test('only the parent channel can start work; worker creation failure is bounded',()=>{
  const f=fixture();f.listener({source:{},data:{channel:'arts-python-v1',type:'run'}});assert.equal(f.workers.length,0);
  f.send({channel:'another-channel'});assert.equal(f.workers.length,0);
  const bad=fixture({constructorFails:true});bad.send();assert.equal(bad.messages.filter(x=>x.type==='error').length,1);assert.equal(bad.blobs.size,0);
});

async function workerFixture({broken=false,reload=false,studentError=false}={}) {
  const f=fixture();f.send();if(reload)f.workers[0].emit('error',{text:'temporary'});
  const blob=f.blobs.get(f.workers.at(-1).url),messages=[],requests=[];let loaded=0,ran=0;
  const nativeFetch=async(url,options)=>{
    requests.push({url,options});const zip=String(url).endsWith('.zip');
    const bytes=new Uint8Array(broken&&zip?4:zip?2360737:10105545);bytes.set(zip?[80,75,3,4]:[0,97,115,109]);
    return new Response(bytes);
  };
  const self={fetch:nativeFetch,postMessage:data=>messages.push(data)};
  const context={self,Uint8Array,Response,Map,importScripts:()=>{},loadPyodide:async()=>{
    loaded++;const r=await self.fetch('https://course.example/learning/runtime/pyodide.asm.wasm');
    assert.equal(r.headers.get('content-type'),'application/wasm');assert.equal((await r.arrayBuffer()).byteLength,10105545);
    return {globals:{set(){}},runPythonAsync:async()=>{ran++;await self.fetch('https://course.example/learning/runtime/pyodide-lock.json');if(studentError)throw Error('student error');}};
  }};
  await vm.runInNewContext(await blob.text(),context);
  await self.onmessage({data:f.workers.at(-1).request});
  return {messages,requests,loaded,ran};
}
test('complete binaries reach Pyodide and native fetch is restored before student code',async()=>{
  const f=await workerFixture();assert.equal(f.loaded,1);assert.equal(f.ran,1);assert.equal(f.messages.at(-1).type,'done');
  assert.equal(f.requests.length,3);assert.match(f.requests.at(-1).url,/pyodide-lock.json/);
});
test('truncated standard library is rejected before Pyodide or student code',async()=>{
  const f=await workerFixture({broken:true});assert.equal(f.loaded,0);assert.equal(f.ran,0);
  assert.equal(f.messages.at(-1).phase,'initializing');assert.match(f.messages.at(-1).text,/文件不完整/);
});
test('recovery reloads local binaries and student error keeps running phase',async()=>{
  const f=await workerFixture({reload:true,studentError:true});assert.equal(f.requests[0].options.cache,'reload');assert.equal(f.requests[1].options.cache,'reload');
  assert.equal(f.messages.at(-1).phase,'running');assert.equal(f.ran,1);
});

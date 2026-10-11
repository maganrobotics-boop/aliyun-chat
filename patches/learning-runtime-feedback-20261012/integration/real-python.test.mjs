// Real vendored WASM/stdlib in a VM worker-like context; this is not a browser/CSP test.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const root=process.env.LEARNING_CANDIDATE_ROOT;
if(!root)throw new Error('Set LEARNING_CANDIDATE_ROOT to a patched release containing vendored runtime files.');
const assets=path.join(root,'chat-cloudflare/public/learning');
const source=readFileSync(path.join(assets,'runner.js'),'utf8');
const workerSource=source.slice(source.indexOf('async function workerMain('),source.indexOf('\nfunction startAttempt('));
const base='https://course.example/learning/runtime/';

test('real Python loads encodings and executes current code once with restored fetch',async()=>{
  const messages=[],requests=[];
  const nativeFetch=async input=>{
    const url=new URL(typeof input==='string'?input:input.url);requests.push(url.href);
    assert.equal(url.origin,'https://course.example');
    const name=url.pathname.split('/').at(-1);
    assert.ok(/^[a-zA-Z0-9_.-]+$/.test(name));
    return new Response(readFileSync(path.join(assets,'runtime',name)),{headers:{'Content-Type':name.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});
  };
  const context=vm.createContext({console,URL,URLSearchParams,TextEncoder,TextDecoder,Response,Request,Headers,AbortSignal,AbortController,performance,crypto:webcrypto,fetch:nativeFetch,setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,location:new URL(base+'worker.js'),navigator:{userAgent:'Node WASM integration'},postMessage:message=>messages.push(message)});
  context.self=context;
  context.importScripts=(...urls)=>{for(const url of urls){const name=new URL(url).pathname.split('/').at(-1);assert.ok(/^[a-zA-Z0-9_.-]+$/.test(name));vm.runInContext(readFileSync(path.join(assets,'runtime',name),'utf8'),context,{filename:name});}};
  vm.runInContext(workerSource,context);
  await context.workerMain(base,false);
  await context.onmessage({data:{id:'actual-python',code:"import encodings, math, json\nprint('real-python-ok', math.sqrt(81), json.loads('{\"n\":7}')[\"n\"])\nraise ValueError('student-error-once')",csv:'{}',harness:'exec(student_source)'}});
  assert.deepEqual(messages.filter(m=>m.type==='running').map(m=>m.id),['actual-python'],JSON.stringify(messages));
  assert.ok(messages.some(m=>m.type==='output'&&m.text==='real-python-ok 9.0 7'));
  assert.equal(messages.at(-1).type,'error');assert.equal(messages.at(-1).phase,'running');assert.match(messages.at(-1).text,/student-error-once/);
  assert.equal(requests.filter(url=>url.endsWith('python_stdlib.zip')).length,1);
  assert.equal(requests.filter(url=>url.endsWith('pyodide.asm.wasm')).length,1);
});

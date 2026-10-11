// Copyright (c) 2026 OriginMind. All rights reserved.
// Opaque-origin iframe + a fresh worker per run/initialization attempt.
// Keep the sandbox/CSP and the parent's 10-second execution limit unchanged.
const base = new URL('/learning/runtime/', location.href).href;
const initializationTimeoutMs = 45000;
let worker = null, workerUrl = null, initializationTimer = null;
function send(data) { parent.postMessage({channel:'arts-python-v1', ...data}, '*'); }
function reset() {
  clearTimeout(initializationTimer);
  if (worker) worker.terminate();
  worker = null;
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = null;
}

// Pyodide 0.27.7 can swallow a failed stdlib fetch and later report missing
// encodings; a failed WASM stream can leave initialization pending forever.
// Fully receive and check both pinned local binaries before invoking Pyodide.
// Supply those responses only during initialization, then restore native fetch.
async function workerMain(runtimeBase, reload) {
  self.onmessage = async event => {
    const {code, csv, harness, id} = event.data;
    let chars = 0, phase = 'initializing';
    const emit = (stream, text) => {
      const value = String(text);
      if (chars < 10000) {
        self.postMessage({type:'output', id, stream, text:value.slice(0,10000-chars)});
        chars += value.length;
      }
    };
    try {
      const nativeFetch = self.fetch.bind(self);
      const binaries = new Map();
      async function receive(name, size, magic, mime) {
        const url = runtimeBase + name;
        const response = await nativeFetch(url, {credentials:'omit', cache:reload?'reload':'default'});
        if (!response.ok) throw new Error('运行环境文件下载失败：'+name+'（'+response.status+'）');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== size || magic.some((value,i)=>bytes[i]!==value)) {
          throw new Error('运行环境文件不完整：'+name);
        }
        binaries.set(url, {bytes, mime});
      }
      self.postMessage({type:'status', id, phase, text:'正在下载并检查 Python 运行环境…'});
      await Promise.all([
        receive('python_stdlib.zip', 2360737, [80,75,3,4], 'application/zip'),
        receive('pyodide.asm.wasm', 10105545, [0,97,115,109], 'application/wasm'),
      ]);
      let py;
      try {
        self.fetch = (input, init) => {
          const entry = binaries.get(typeof input==='string'?input:input?.url||String(input));
          return entry ? Promise.resolve(new Response(entry.bytes, {headers:{'Content-Type':entry.mime}})) : nativeFetch(input,init);
        };
        self.postMessage({type:'status', id, phase, text:'运行环境文件已就绪，正在启动 Python…'});
        importScripts(runtimeBase+'pyodide.js'+(reload?'?recovery=1':''));
        py = await loadPyodide({indexURL:runtimeBase, stdout:s=>emit('stdout',s), stderr:s=>emit('stderr',s)});
      } finally {
        self.fetch = nativeFetch;
        binaries.clear();
      }
      phase = 'running';
      self.postMessage({type:'running', id});
      py.globals.set('student_source',code);
      py.globals.set('student_csv',csv);
      await py.runPythonAsync(harness);
      self.postMessage({type:'done', id});
    } catch (error) {
      self.postMessage({type:'error', id, phase, text:String(error.message||error)});
    }
  };
}

function startAttempt(request, attempt=0) {
  reset();
  const source='('+workerMain.toString()+')('+JSON.stringify(base)+','+(attempt>0)+');';
  workerUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  let child=null, running=false;
  function fail(text) {
    if (child !== worker) return;
    if (!running && attempt===0) {
      send({type:'status', id:request.id, phase:'initializing', text:'Python 环境暂未载入，正在自动恢复一次；代码和输入已保留…'});
      startAttempt(request,1);
      return;
    }
    send({type:'error', id:request.id, phase:running?'running':'initializing', text:running?text:'Python 环境载入未完成，代码尚未执行。请稍后重试；代码和输入已保留。\n'+text});
    reset();
  }
  try { child=worker=new Worker(workerUrl); }
  catch(error) { fail(error.message||'运行环境创建失败'); return; }
  initializationTimer=setTimeout(()=>fail('运行环境载入超过45秒。'),initializationTimeoutMs);
  child.onmessage=event=>{
    if (child!==worker || event.data?.id!==request.id) return;
    const data=event.data;
    if (data.type==='output' && !running) return;
    if (data.type==='error') { fail(data.text); return; }
    if (data.type==='running') { running=true; clearTimeout(initializationTimer); }
    send(data);
    if (data.type==='done') reset();
  };
  child.onerror=event=>{event.preventDefault?.();fail(event.message||'运行环境载入失败');};
  child.postMessage(request);
}

addEventListener('message',event=>{
  if (event.source!==parent || event.data?.channel!=='arts-python-v1') return;
  if (event.data.type==='ping') { send({type:'ready'}); return; }
  if (event.data.type==='stop') { reset(); return; }
  if (event.data.type==='run') startAttempt(event.data);
});
send({type:'ready'});

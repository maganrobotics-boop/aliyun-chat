from pathlib import Path
import hashlib,shutil,subprocess,json
old=Path('/opt/omindos-chat-entry/releases/20261011-arena-v4')
new=Path('/opt/omindos-chat-entry/releases/20261013-exam-grading-v1')
assert Path('/opt/omindos-chat-entry/current').resolve()==old
assert hashlib.sha256((old/'gateway.mjs').read_bytes()).hexdigest()=='da5bef7c673bc7cbfc05f216628e926822f8ec0f9fe2a3a974626439c9d94bb8'
assert not new.exists()
shutil.copytree(old,new,symlinks=True)
p=new/'gateway.mjs';s=p.read_text();anchor='(?:api|assets|learning|'
assert s.count(anchor)==1
s=s.replace(anchor,'(?:api|assets|grading(?:\\.(?:html|js|css))?|learning|')
anchor="  text = rewriteOrigins(text);"
assert s.count(anchor)==1
s=s.replace(anchor,anchor+'\n  if (/^\\/grading(?:\\.html|\\/)?$/.test(pathname)) text = text.replace(\'href="/?ta=1"\', \'href="/chat/?ta=1"\');')
p.write_text(s)
t=new/'gateway.test.mjs'
with t.open('a') as f:f.write("""
test('exam grading page, entry, assets and APIs remain within the public Chat prefix',()=>{
 const html='<a href="/grading">批改试卷</a><link href="/grading.css"><script src="/grading.js"></script><a href="/?ta=1">返回</a>';
 const rewritten=rewriteStatic(html,'text/html','/grading');
 for(const expected of ['/chat/grading"','/chat/grading.css','/chat/grading.js','/chat/?ta=1']) assert.ok(rewritten.includes(expected),expected);
 const code=rewriteStatic("fetch('/api/grading/status');fetch('/api/grading/grade');const href='/grading';",'application/javascript','/grading.js');
 assert.ok(code.includes("'/chat/api/grading/status'"));assert.ok(code.includes("'/chat/api/grading/grade'"));assert.ok(code.includes("'/chat/grading'"));
 assert.equal(rewriteStatic('"/grading-other"','text/javascript','/assets/app.js'),'"/grading-other"');
});
""")
subprocess.run(['/usr/bin/node','--check',str(p)],check=True)
subprocess.run(['/usr/bin/node','--test',str(t)],check=True)
print(json.dumps({'candidate':str(new),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))

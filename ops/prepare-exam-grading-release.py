#!/usr/bin/env python3
"""Prepare an isolated, hash-checked overlay; never switch or restart production."""
import argparse, hashlib, json, re, shutil
from pathlib import Path

EXPECTED = {
 'aliyun/chat-server.mjs':'3c50452f49e79d5ffee3b8c2fc1834634f2b134274ba336d734fc4cdf6deae69',
 'chat-cloudflare/src/app.mjs':'022bebc70f9eb1e0dff5ab270296878fda474b701c337fefa51b0c3471e8c5c5',
 'chat-cloudflare/src/static-router.mjs':'1e649de241732f487fc2b44e81ab6c1b82dffbc2fee7b23bead1475041e72950',
 'chat-cloudflare/frontend/app.js':'3d18323b29790dd4c15637ac2b967f5839ef2cd45fb755cbec0bc6dfad2db971',
 'chat-cloudflare/frontend/styles.css':'4824cf7df179af1c1507954a4b1d1c88a446b2eb6a19309a56825c8103e41dfb',
 'chat-cloudflare/frontend/workspace-r4.css':'99ed802954e4a3a13b2905eb35178b9bc290225d2b7d04593e285e84667f4b06',
 'chat-cloudflare/public/index.html':'83a00f69843e5cb2206ae0744a2c92d95598b7fc0c2f8be4e7912e7647621800',
 'chat-cloudflare/public/newbie-village.html':'f2c5bacb4b431f041758d2507507460cf3a6585d7a0addd9993b83d265eeeefb',
 'chat-cloudflare/public/assets/workspace-r4.css':'99ed802954e4a3a13b2905eb35178b9bc290225d2b7d04593e285e84667f4b06',
 'chat-cloudflare/public/assets/ai-senior-sister-30759f93c1ef6b58.js':'30759f93c1ef6b58f37ecdf7e8dda55a3f29e880c886b265559330448831856d',
}
NEW_FILES=['chat-cloudflare/src/exam-grading.mjs','chat-cloudflare/public/grading.html','chat-cloudflare/public/grading.js','chat-cloudflare/public/grading.css','chat-cloudflare/test/exam-grading.test.mjs']
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def replace(s,a,b,count=1):
 if s.count(a)!=count:raise RuntimeError('Anchor count mismatch: '+a[:90])
 return s.replace(a,b)
def read(p):return p.read_bytes().decode('utf-8')
def write(p,s):p.write_bytes(s.encode('utf-8'))
def prepare(current,output,payload,source_commit):
 current=current.resolve(strict=True);payload=payload.resolve(strict=True)
 if output.exists():raise RuntimeError('Output already exists')
 for name,expected in EXPECTED.items():
  if digest(current/name)!=expected:raise RuntimeError('Production baseline changed: '+name)
 for name in NEW_FILES:
  if (current/name).exists():raise RuntimeError('Feature already present: '+name)
  if not (payload/name).is_file():raise RuntimeError('Missing payload: '+name)
 before={str(p.relative_to(current)):digest(p) for p in current.rglob('*') if p.is_file() and not p.is_symlink()}
 shutil.copytree(current,output,symlinks=True)
 changed=set()
 def edit(name,fn):
  p=output/name;write(p,fn(read(p)));changed.add(name)
 edit('aliyun/chat-server.mjs',lambda s: "import { localDocumentAi } from './local-document-ai.mjs';\n"+replace(s,'  DB: database,','  DB: database,\n  DOCUMENT_AI: localDocumentAi,'))
 route='''    if (path.startsWith("grading/")) return await handleExamGrading(context, {
      currentVisitor, ownerEmail, getModelConfig, modelProvider, json, limit,
      readBytes, readJson, documentExtractionBudget, globalBudget, modelCall, workersAiCall,
    });
'''
 edit('chat-cloudflare/src/app.mjs',lambda s:"import { handleExamGrading } from './exam-grading.mjs';\n"+replace(s,'    if (path === "shares" && method === "POST") {',route+'    if (path === "shares" && method === "POST") {'))
 static_route='''  if (url.pathname === "/grading" || url.pathname === "/grading/") {
    if (!SAFE_METHODS.has(request.method)) return methodNotAllowed();
    return fetchAsset(request, env, "/grading.html", "no-store");
  }

'''
 def static(s):
  s=replace(s,'  "/orientation.html",','  "/grading.html",\n  "/grading.js",\n  "/grading.css",\n  "/orientation.html",')
  s=replace(s,'  if (pathname === "/service-worker.js") {','  if (pathname.startsWith("/grading.")) return "no-store";\n  if (pathname === "/service-worker.js") {')
  return replace(s,'  if (kind === RouteKind.DYNAMIC) return null;',static_route+'  if (kind === RouteKind.DYNAMIC) return null;')
 edit('chat-cloudflare/src/static-router.mjs',static)
 old='<div class="topbar-actions"><span class="guest-badge">'
 new='<div class="topbar-actions"><a class="grading-entry" href="/grading">批改试卷</a><span class="guest-badge">'
 edit('chat-cloudflare/frontend/app.js',lambda s:replace(s,old,new))
 style='\n.grading-entry { display:inline-flex; align-items:center; min-height:44px; padding:0 10px; color:#245bdb; font-size:14px; white-space:nowrap; text-decoration:none; }\n'
 edit('chat-cloudflare/frontend/styles.css',lambda s:s+style)
 def workspace(s):return replace(s,':not(.new-chat-bottom)',':not(.new-chat-bottom):not(.grading-entry)',2).replace('/* Assistant header: laboratory title and existing new-chat control only. */','/* Assistant header: laboratory title, grading entry, and new-chat control. */')
 edit('chat-cloudflare/frontend/workspace-r4.css',workspace)
 edit('chat-cloudflare/public/newbie-village.html',lambda s:replace(s,'<div class="workspace-tutor-intro">','<p class="workspace-actions"><a href="/grading">批改试卷 · 上传与逐题反馈</a></p>\n<div class="workspace-tutor-intro">'))
 public=output/'chat-cloudflare/public';html=read(public/'index.html')
 def asset(old_path,content,prefix,ext):
  nonlocal html
  name=f'{prefix}-{hashlib.sha256(content.encode()).hexdigest()[:16]}.{ext}'
  write(public/'assets'/name,content);html=replace(html,old_path,'/assets/'+name)
  return '/assets/'+name
 app=asset('/assets/ai-senior-sister-30759f93c1ef6b58.js',replace(read(public/'assets/ai-senior-sister-30759f93c1ef6b58.js'),old,new),'app-exam-grading','js')
 styles=re.findall(r'/assets/styles-[a-f0-9]+\.css',html)
 if len(styles)!=1:raise RuntimeError('Stylesheet reference changed')
 css=asset(styles[0],read(public/styles[0].lstrip('/'))+style,'styles','css')
 workspace_css=asset('/assets/workspace-r4.css?v=20260928-four-prompts',workspace(read(public/'assets/workspace-r4.css')),'workspace-r4-exam','css')
 write(public/'index.html',html);changed.add('chat-cloudflare/public/index.html')
 for name in NEW_FILES:shutil.copy2(payload/name,output/name)
 for name,sha in before.items():
  if name not in changed and digest(output/name)!=sha:raise RuntimeError('Unrelated file changed: '+name)
 manifest={'sourceCommit':source_commit,'previousRelease':str(current),'release':str(output),'preservedFiles':len(before)-len(changed),'changed':{n:{'before':before[n],'after':digest(output/n)} for n in sorted(changed)},'added':{n:digest(output/n) for n in NEW_FILES},'assets':{'app':app,'style':css,'workspace':workspace_css}}
 write(output/'exam-grading-overlay.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(manifest,ensure_ascii=False))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--current',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--payload',type=Path,required=True);p.add_argument('--source-commit',required=True);a=p.parse_args();prepare(a.current,a.output,a.payload,a.source_commit)

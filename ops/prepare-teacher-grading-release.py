#!/usr/bin/env python3
"""Prepare the teacher-only grading correction on the checked current release."""
from pathlib import Path
import argparse, hashlib, json, re, shutil

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return p.read_bytes().decode('utf-8')
def write(p,s): p.write_bytes(s.encode('utf-8'))
def once(s,a,b):
    if s.count(a)!=1: raise RuntimeError('Changed production anchor: '+a[:70])
    return s.replace(a,b)

def prepare(current,output,payload):
    current=current.resolve(strict=True)
    if current.name!='chat-exam-grading-20261013-v2' or output.exists(): raise RuntimeError('Release changed or candidate exists')
    expected={'chat-cloudflare/src/exam-grading.mjs':'376894a58db1f6634606b9cf5af325093c306e6115b6bf39d6bba12443c3e847','chat-cloudflare/public/grading.js':'dda9cc5c6ecf59cdcc08337c6b1964658787c03c2c1fd9edd79b12dbd9ac8fd7','chat-cloudflare/public/index.html':'61c8d7416ff99200d8f56c0ad25b5c6be3c86b769a912a323699d6b76eb78ff4'}
    for n,h in expected.items():
        if digest(current/n)!=h: raise RuntimeError('Baseline changed: '+n)
    before={str(p.relative_to(current)):digest(p) for p in current.rglob('*') if p.is_file() and not p.is_symlink()}
    shutil.copytree(current,output,symlinks=True);changed=set()
    def edit(n,fn):
        p=output/n;write(p,fn(read(p)));changed.add(n)
    for n in ['chat-cloudflare/src/exam-grading.mjs','chat-cloudflare/public/grading.js','chat-cloudflare/public/grading.html','chat-cloudflare/test/exam-grading.test.mjs']:
        shutil.copy2(payload/n,output/n);changed.add(n)
    account=read(payload/'account-block.txt')
    def common(s):return once(s,'<a class="grading-entry" href="/grading">批改试卷</a>','').replace('AI 学姐','AI 助教')
    def source(s):
        s=common(s)
        s=once(s,'document.querySelectorAll(".settings-trigger").forEach((button) => button.addEventListener("click", () => window.location.assign("/newbie-village")));',account.rstrip())
        return once(s,'  updateLoginGuide();\n}', '  updateLoginGuide();\n  document.querySelectorAll(".settings-trigger").forEach(b => { b.textContent = visitorUser ? "我的" : "登录"; b.setAttribute("aria-label", visitorUser ? "我的" : "登录"); });\n}')
    edit('chat-cloudflare/frontend/app.js',source)
    edit('chat-cloudflare/frontend/index.html',lambda s:s.replace('AI 学姐','AI 助教'))
    edit('chat-cloudflare/public/newbie-village.html',lambda s:once(s,'<p class="workspace-actions"><a href="/grading">批改试卷 · 上传与逐题反馈</a></p>\n',''))
    edit('chat-cloudflare/frontend/workspace-r4.css',lambda s:s.replace(':not(.grading-entry)',':not(.settings-trigger)').replace('grading entry,','account menu,'))
    public=output/'chat-cloudflare/public';html=read(public/'index.html').replace('AI 学姐','AI 助教')
    old_app=re.findall(r'/assets/app-exam-grading-[a-f0-9]+\.js',html)
    if len(old_app)!=1:raise RuntimeError('App asset changed')
    app=common(read(public/old_app[0].lstrip('/')))
    a=app.index('function accountKey()');b=app.index('document.querySelectorAll(".student-login-trigger")',a)
    app=app[:a]+account+app[b:]
    app=once(app,'b.textContent = visitorUser ? accountNickname() : "登录"; b.setAttribute("aria-label", visitorUser ? "账户菜单" : "登录");','b.textContent = visitorUser ? "我的" : "登录"; b.setAttribute("aria-label", visitorUser ? "我的" : "登录");')
    new_app='/assets/app-teacher-grading-'+hashlib.sha256(app.encode()).hexdigest()[:16]+'.js';write(public/new_app.lstrip('/'),app)
    html=once(html,old_app[0],new_app)
    old_css=re.findall(r'/assets/workspace-r4-exam-[a-f0-9]+\.css',html)
    if len(old_css)!=1:raise RuntimeError('Workspace style changed')
    css=read(public/old_css[0].lstrip('/')).replace(':not(.grading-entry)',':not(.settings-trigger)').replace('grading entry,','account menu,')
    new_css='/assets/workspace-teacher-grading-'+hashlib.sha256(css.encode()).hexdigest()[:16]+'.css';write(public/new_css.lstrip('/'),css)
    html=once(html,old_css[0],new_css);write(public/'index.html',html);changed.add('chat-cloudflare/public/index.html')
    for n,h in before.items():
        if n not in changed and digest(output/n)!=h:raise RuntimeError('Unrelated file changed: '+n)
    manifest={'previousRelease':str(current),'release':str(output),'preservedFiles':len(before)-len(changed),'changed':{n:{'before':before[n],'after':digest(output/n)} for n in sorted(changed)},'assets':{'app':new_app,'workspace':new_css}}
    write(output/'teacher-grading-overlay.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(manifest,ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--current',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--payload',type=Path,required=True);a=p.parse_args();prepare(a.current,a.output,a.payload)

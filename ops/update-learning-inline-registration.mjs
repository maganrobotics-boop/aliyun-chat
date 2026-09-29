// Apply to the active /learning directory only after verifying the live files.
// Usage: node ops/update-learning-inline-registration.mjs /path/to/learning
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Pass the learning asset directory');
const appPath = join(directory, 'app.js');
const cssPath = join(directory, 'style.css');
const source = readFileSync(appPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
let app = source;
function once(before, after) {
  if (app.split(before).length !== 2) throw new Error('Expected exactly one source match: ' + before.slice(0, 90));
  app = app.replace(before, after);
}

once(
  "function showLogin(){setDirectory(false);if(!$('login-dialog').open)$('login-dialog').showModal();}",
  "function showLogin(){setDirectory(false);tab('history');renderLearningLogin();$('learning-email')?.focus();}",
);
once(
  "$('profile-entry').onclick=()=>{if(email){tab('history');window.scrollTo({top:0,behavior:'auto'});}else showLogin();};",
  "$('profile-entry').onclick=()=>{if(email){tab('history');window.scrollTo({top:0,behavior:'auto'});}else showLogin();};",
);
// The following replaces the earlier read-only profile card with the in-page
// login, agreement and profile registration flow. It uses existing APIs.
const start = app.indexOf('function renderReviewProfile(data){');
const end = app.indexOf('function note(text)', start);
if (start < 0 || end <= start || app.indexOf('function renderReviewProfile(data){', start + 1) !== -1) {
  throw new Error('Could not uniquely identify the profile renderer');
}
app = app.slice(0, start) + `
async function learningRequest(path,method='GET',body){
  const response=await fetch(path,{method,credentials:'same-origin',
    headers:body?{'Content-Type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'请求未完成，请重试');
  return data;
}
function reviewAccountCard(id){
  let card=$(id);
  if(!card){card=element('section',undefined,'card');card.id=id;$('history').insertBefore(card,$('history').firstChild);}
  return card;
}
function renderLearningLogin(){
  if(email)return;
  $('review-profile')?.remove();
  const card=reviewAccountCard('learning-login');
  card.innerHTML='<h2>登录并登记</h2><p class="muted">使用原有深技大账号；新同学在这里验证校内邮箱。游客可以继续学习新手村。</p><form id="learning-login-form"><label for="learning-email">校内邮箱</label><input id="learning-email" name="email" type="email" autocomplete="email" placeholder="学号@stumail.sztu.edu.cn" required><div class="actions"><button id="learning-send-code" type="button">发送验证码</button></div><label for="learning-code">六位验证码</label><input id="learning-code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required><div class="actions"><button type="submit">登录并查看点评</button></div><p id="learning-login-status" role="status"></p></form>';
  const form=$('learning-login-form'),status=$('learning-login-status'),send=$('learning-send-code');
  send.onclick=async()=>{if(!form.elements.email.reportValidity())return;send.disabled=true;status.textContent='正在发送验证码…';
    try{await learningRequest('/api/visitor/request-code','POST',{email:form.elements.email.value.trim()});status.textContent='验证码已发送，请检查邮箱。';form.elements.code.focus();}
    catch(error){status.textContent=error.message;}finally{send.disabled=false;}};
  form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;status.textContent='正在登录…';
    try{await learningRequest('/api/visitor/verify-code','POST',{email:form.elements.email.value.trim(),code:form.elements.code.value.trim()});await refresh();tab('history');note('登录成功');}
    catch(error){status.textContent=error.message;}finally{submit.disabled=false;}};
}
function renderReviewProfile(data){
  $('learning-login')?.remove();
  const card=reviewAccountCard('review-profile');
  const profile=data.profile||{},agreement=data.agreement||{};
  card.replaceChildren(element('h2','我的基本信息'),element('p','邮箱：'+(data.user?.email||email)));
  if(!agreement.approved){
    card.append(element('h3',agreement.title||'新手村保密协议'),
      element('p',agreement.introduction||'请先阅读并签署协议，才能保存个人资料和正式提交。'));
    const detail=element('details');detail.open=true;detail.append(element('summary','阅读完整协议'));
    for(const clause of agreement.clauses||[])detail.append(element('h3',clause.title),element('p',clause.text));
    detail.append(element('p',agreement.privacyNotice||''));card.append(detail);
    const form=element('form');form.innerHTML='<label for="learning-signer">真实签署姓名</label><input id="learning-signer" name="signerName" required maxlength="80"><label class="learning-check"><input name="accepted" type="checkbox" required>我已阅读并同意上述协议</label><div class="actions"><button type="submit">签署并自动归档</button></div><p role="status"></p>';
    form.elements.signerName.value=agreement.signerName||'';
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');button.disabled=true;status.textContent='正在签署和归档…';
      try{await learningRequest('/api/newbie/agreement','POST',{agreementVersion:agreement.version,signerName:form.elements.signerName.value.trim(),accepted:true});await refresh();note('协议已归档，可填写基本信息');}
      catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
    card.append(form);return;
  }
  const form=element('form');form.innerHTML='<label for="learning-name">姓名或昵称</label><input id="learning-name" name="displayName" maxlength="40" required><label for="learning-grade">年级</label><input id="learning-grade" name="grade" maxlength="40"><label for="learning-major">专业</label><input id="learning-major" name="major" maxlength="80"><label for="learning-direction">学习方向</label><select id="learning-direction" name="direction"><option value="undecided">待选择</option><option value="perception">感知</option><option value="navigation">导航</option><option value="control">控制</option><option value="mechanics">机械</option><option value="ai">人工智能</option></select><label for="learning-bio">个人介绍</label><textarea id="learning-bio" name="bio" maxlength="300"></textarea><div class="actions"><button type="submit">保存基本信息</button><button id="learning-logout" type="button" class="secondary">退出登录</button></div><p role="status"></p>';
  for(const name of ['displayName','grade','major','direction','bio'])form.elements[name].value=profile[name]||((name==='direction')?'undecided':'');
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');button.disabled=true;status.textContent='正在保存…';
    try{const payload={};for(const name of ['displayName','grade','major','direction','bio'])payload[name]=form.elements[name].value.trim();await learningRequest('/api/newbie/profile','PATCH',payload);await refresh();note('基本信息已保存');}
    catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
  form.querySelector('#learning-logout').onclick=async()=>{try{await learningRequest('/api/visitor/logout','POST',{});await refresh();tab('history');}catch(error){form.querySelector('[role=status]').textContent=error.message;}};
  card.append(form);
}
async function updateProfile(){
  const account=email;$('profile-entry').textContent=account?'个人信息':'游客';
  if(!account){$('review-profile')?.remove();renderLearningLogin();document.querySelectorAll('.gated-track').forEach(t=>t.open=false);return;}
  $('learning-login')?.remove();
  try{const data=await learningRequest('/api/newbie/dashboard');if(email===account){$('profile-entry').textContent=data.profile?.displayName||account.split('@')[0];renderReviewProfile(data);}}
  catch{if(email===account)reviewAccountCard('review-profile').replaceChildren(element('h2','我的基本信息'),element('p','信息暂时无法载入，请点击刷新重试。'));}
}
` + app.slice(end);
if (!app.includes("chooseCourse(curriculum[0].id)")) throw new Error('First lesson hotfix is missing');
const extraCss='#learning-login input,#review-profile input:not([type=checkbox]),#review-profile select{display:block;width:100%;max-width:560px;border:1px solid #b9cdd8;border-radius:8px;padding:12px;font:inherit;color:var(--ink);background:#fbfdfe}#learning-login input:focus,#review-profile input:focus{outline:2px solid #3d91bd;outline-offset:2px}#review-profile .learning-check{display:flex;gap:10px;align-items:center}#review-profile .learning-check input{width:20px;height:20px}#review-profile details{max-height:340px;overflow:auto;padding:12px;border:1px solid var(--line);border-radius:8px}';
if (css.includes('#learning-login input')) throw new Error('Inline login stylesheet is already present');
copyFileSync(appPath, appPath + '.bak-inline-registration');
copyFileSync(cssPath, cssPath + '.bak-inline-registration');
writeFileSync(appPath, app);
writeFileSync(cssPath, css + '\n' + extraCss + '\n');
console.log('Updated in-page login, agreement and profile forms; backups retained.');

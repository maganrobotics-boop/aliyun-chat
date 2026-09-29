// Apply the small UI correction to the currently deployed /learning/app.js.
// Usage: node ops/update-learning-entry.mjs /absolute/path/to/learning/app.js
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) throw new Error('Pass the absolute path to the deployed learning/app.js');
const original = readFileSync(path, 'utf8');
let updated = original;
function replaceOnce(before, after) {
  if (updated.split(before).length !== 2) throw new Error(`Expected exactly one match: ${before.slice(0, 80)}`);
  updated = updated.replace(before, after);
}

replaceOnce(
  "let curriculum,exercise,courseId='python-basics',lastRun=null",
  "let curriculum,exercise,courseId='registration',lastRun=null",
);
replaceOnce(
  "$('profile-entry').onclick=()=>{if(email)location.href='/newbie-village#profile';else showLogin();};",
  "$('profile-entry').onclick=()=>{if(email){tab('history');window.scrollTo({top:0,behavior:'auto'});}else showLogin();};",
);
replaceOnce(
  "if(email===account)$('profile-entry').textContent=data.profile?.displayName||'个人信息';}catch{}",
  "if(email===account){$('profile-entry').textContent=data.profile?.displayName||'个人信息';renderReviewProfile(data);}}catch{}",
);
replaceOnce(
  "if(!account){document.querySelectorAll('.gated-track').forEach(t=>t.open=false);return;}",
  "if(!account){$('review-profile')?.remove();document.querySelectorAll('.gated-track').forEach(t=>t.open=false);return;}",
);
replaceOnce(
  "email=data.email;void updateProfile();localKey=",
  "if(email!==data.email)$('review-profile')?.remove();email=data.email;void updateProfile();localKey=",
);
replaceOnce(
  "async function updateProfile(){",
  `function renderReviewProfile(data){
  let card=$('review-profile');
  if(!card){card=element('section',undefined,'card');card.id='review-profile';$('history').insertBefore(card,$('history').firstChild);}
  const profile=data.profile||{};
  const values=[['姓名',profile.displayName||'未填写'],['邮箱',data.user?.email||email],['年级',profile.grade||'未填写'],['专业',profile.major||'未填写'],['研究方向',profile.direction||'未填写'],['简介',profile.bio||'未填写']];
  card.replaceChildren(element('h2','我的基本信息'));
  for(const [label,value] of values)card.append(element('p',label+'：'+value));
  const edit=element('a','编辑个人资料');edit.href='/newbie-village#profile';card.append(edit);
}
async function updateProfile(){`,
);
replaceOnce(
  "chooseCourse('python-basics');await refresh();",
  "chooseCourse(curriculum[0].id);await refresh();",
);
if (updated === original) throw new Error('No changes made');
copyFileSync(path, `${path}.bak-pathway-entry`);
writeFileSync(path, updated);
console.log('Updated first course and profile review entry; backup:', `${path}.bak-pathway-entry`);

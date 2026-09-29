// Remove the obsolete cross-page login path after in-page registration is live.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const directory=process.argv[2];
if(!directory)throw new Error('Pass the active learning directory');
const appPath=join(directory,'app.js'),htmlPath=join(directory,'index.html');
let app=readFileSync(appPath,'utf8'),html=readFileSync(htmlPath,'utf8');
function replace(text,before,after){
  if(text.split(before).length!==2)throw new Error('Expected one match: '+before.slice(0,90));
  return text.replace(before,after);
}
app=replace(app,"$('login-cancel').onclick=()=>$('login-dialog').close();\n",'');
app=replace(app,"const link=element('a','打开新手村登录');link.href='/newbie-village';",
  "const link=element('button','在点评处登录','secondary');link.type='button';link.onclick=showLogin;");
html=replace(html,'<dialog id="login-dialog"><h2>使用深技大账号登录</h2><p>游客可以学习新手村；专业课和实战需要登录。</p><div class="actions"><a class="login-link" href="/newbie-village#profile">用深技大账号登录</a><button id="login-cancel" class="secondary">暂不登录</button></div></dialog>','');
copyFileSync(appPath,appPath+'.bak-remove-old-login');
copyFileSync(htmlPath,htmlPath+'.bak-remove-old-login');
writeFileSync(appPath,app);
writeFileSync(htmlPath,html);
console.log('Removed the old external login entry; backups retained.');

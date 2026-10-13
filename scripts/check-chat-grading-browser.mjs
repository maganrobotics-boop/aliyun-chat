// Browser interaction and layout checks. Synthetic APIs; no production requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to playwright/index.mjs');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = resolve('chat-cloudflare/public');
const output = resolve(process.env.GRADING_BROWSER_OUTPUT || '/tmp/chat-grading-browser');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/grading') path = '/grading.html';
    if (path === '/') path = '/index.html';
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep)) throw new Error('Invalid path');
    res.setHeader('content-type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'})[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const results=[];
const result={version:1,title:'ROS 基础练习（示例）',totalScore:10,questionCount:2,status:'ai_draft',pendingCount:0,subtotal:6,suggestedScore:6,summary:'建议复习匀速运动位移计算。',notice:'AI 批改建议，须由教师复核后确认；不自动写入课程成绩。',questions:[{index:1,label:'第1题',score:5,maxScore:5,status:'graded',studentAnswer:'发布者',referenceAnswer:'发布者 / publisher',reason:'答案正确，得5分。',improvement:'继续巩固发布与订阅的关系。'},{index:2,label:'第2题',score:1,maxScore:5,status:'graded',studentAnswer:'5 m',referenceAnswer:'6 m',reason:'未列公式且数值有误；单位正确得1分。',improvement:'s = v × t = 2 × 3 = 6 m。'}]};
try {
  for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844],['small-mobile',360,780]]){
    const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',acceptDownloads:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    let signedIn=true,mode='normal',calls=0;
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/grading/status')return route.fulfill({json:{signedIn,modelConfigured:true,formats:['pdf','png','jpg','jpeg','webp'],notice:'PDF 读取文字层，扫描 PDF 请先转图片。'}});
      if(path==='/api/grading/extract')return route.fulfill({json:{text:'第3题：3+3=? 学生作答：6。'}});
      if(path==='/api/grading/grade'){
        calls++;assert.equal(route.request().postDataJSON().confirmed,true);
        if(mode==='error')return route.fulfill({status:502,json:{error:'批改结果不完整，未生成成绩。'}});
        const r=structuredClone(result);
        if(mode==='review'){r.pendingCount=1;r.suggestedScore=null;r.subtotal=5;r.questions[1].status='review';r.questions[1].score=null;}
        if(mode==='hostile'){r.questions[0].studentAnswer='<img src=x onerror="window.pwned=1">';r.questions[0].label='=HYPERLINK("https://invalid.example")';}
        return route.fulfill({json:r});
      }
      if(path==='/api/visitor/status')return route.fulfill({json:{signedIn:true,user:{role:'student',roleLabel:'学生'}}});
      if(path==='/api/status')return route.fulfill({json:{systemReady:true,modelReady:true,knowledgeReady:true,retrievalReady:true}});
      return route.fulfill({json:{suggestions:[],courses:[]}});
    });
    await page.goto(origin+'/grading');await page.waitForFunction(()=>document.querySelector('#grade').disabled===false);
    await page.locator('#demo').click();await page.locator('#grade').click();assert.equal(calls,0,'unchecked confirmation prevents submit');
    await page.locator('#confirmed').check();await page.locator('#grade').click();await page.locator('#result:not([hidden])').waitFor();
    assert.match(await page.locator('#score').innerText(),/6 \/ 10/);assert.equal(await page.locator('.question').count(),2);
    const download=page.waitForEvent('download');await page.locator('#export-report').click();const d=await download;assert.match(await readFile(await d.path(),'utf8'),/评分依据/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
    await page.screenshot({path:resolve(output,`${name}.png`),fullPage:true});
    await page.locator('#paper').fill('新的试卷内容：第1题学生作答未知');assert.equal(await page.locator('#result').isVisible(),false);assert.equal(await page.locator('#confirmed').isChecked(),false);
    await page.locator('#demo').click();await page.locator('#paper-files').setInputFiles({name:'extra.txt',mimeType:'text/plain',buffer:Buffer.from('补充学生作答：此题答案为6。')});
    await page.waitForFunction(()=>document.querySelector('#paper').value.includes('补充学生作答'));assert.equal(await page.locator('#confirmed').isChecked(),false);
    mode='review';await page.locator('#confirmed').check();await page.locator('#grade').click();await page.locator('#result:not([hidden])').waitFor();assert.match(await page.locator('#score').innerText(),/暂不汇总总分/);
    mode='error';await page.locator('#grade').click();await page.waitForFunction(()=>document.querySelector('#status').className==='error');assert.equal(await page.locator('#result').isVisible(),false);assert.ok((await page.locator('#paper').inputValue()).includes('补充学生作答'));
    mode='hostile';await page.locator('#grade').click();await page.locator('#result:not([hidden])').waitFor();assert.equal(await page.evaluate(()=>window.pwned),undefined);assert.equal(await page.locator('#questions img').count(),0);
    const csvDownload=page.waitForEvent('download');await page.locator('#export-csv').click();const csv=await csvDownload;assert.match(await readFile(await csv.path(),'utf8'),/'=HYPERLINK/);
    signedIn=false;await page.reload();await page.locator('#login-panel:not([hidden])').waitFor();assert.equal(await page.locator('#grade').isDisabled(),true);
    // The assistant's existing workspace CSS must not hide the new entry.
    await page.goto(origin+'/?ta=1');await page.locator('.grading-entry').waitFor({state:'visible'});assert.equal(await page.locator('.grading-entry').getAttribute('href'),'/grading');
    assert.deepEqual(errors,[]);results.push({name,width,height,passed:true});await context.close();
  }
  console.log(JSON.stringify({apiMode:'synthetic',results,checks:['confirmation','grading','exports','stale result invalidation','file import','pending totals','error recovery','XSS','CSV formula escaping','guest guard','chat entry visibility','responsive overflow']},null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));}

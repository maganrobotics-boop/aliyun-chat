import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const source=readFileSync(path.join(process.env.LEARNING_CANDIDATE_ROOT,'chat-cloudflare/public/learning/app.js'),'utf8');
function fixture(confirmed){
 const select={value:'zero',options:[{value:'normal'},{value:'zero'}],append(o){this.options.push(o);}},csv={value:'{"seconds":4}'};let saved=0,backups=0;
 const c={$:id=>id==='dataset'?select:csv,exercise:{datasets:{normal:'{"seconds":4}',zero:'{"seconds":0}'}},confirm:()=>confirmed,element:(tag,text)=>({tag,text}),backup(){backups++;},saveLocal(){saved++;c.syncDatasetSelection();}};
 vm.createContext(c);vm.runInContext(source.split('\n').filter(s=>s.startsWith('function syncDatasetSelection(')||s.startsWith("$('dataset').onchange=")).join('\n'),c);
 return {c,select,csv,saved:()=>saved,backups:()=>backups};
}
test('cancel dataset replacement restores label and preserves custom data without saving',()=>{
 const f=fixture(false);f.select.onchange();assert.equal(f.select.value,'normal');assert.equal(f.csv.value,'{"seconds":4}');assert.equal(f.saved(),0);assert.equal(f.backups(),0);
 f.csv.value='{"seconds":7}';f.select.value='zero';f.select.onchange();assert.equal(f.select.value,'__custom__');assert.equal(f.csv.value,'{"seconds":7}');assert.equal(f.select.options.at(-1).disabled,true);
});
test('accepting dataset replacement backs up, applies and synchronizes label',()=>{
 const f=fixture(true);f.select.onchange();assert.equal(f.select.value,'zero');assert.equal(f.csv.value,'{"seconds":0}');assert.equal(f.saved(),1);assert.equal(f.backups(),1);
});

test('advanced practice mounts its guide and data exercises only once',()=>{
 const render=source.slice(source.indexOf('function renderAdvanced('),source.indexOf('\nfunction selectedCompanionId('));
 const host={children:[],replaceChildren(){this.children=[];},append(...items){this.children.push(...items);}};
 const course={id:'robot-learning',title:'机器人学习'},track={title:'训练营 · 进阶',courses:[course]};let mounts=0;
 const c={advancedSelection:{track,course},disposeAdvancedWorkspace:null,email:'fixture@example.test',authGeneration:1,$:id=>id==='advanced-course'?host:{},pauseCourseMedia(){},document:{querySelector:()=>({})},renderMethodGuide:()=>({kind:'guide'}),renderMechatronicsWorkshop:()=>({kind:'workshop'}),renderMechanicalDesignLab:()=>({kind:'mechanical'}),renderChapterDeepening:()=>({kind:'data-exercises'}),companionActions:()=>({}),renderSmallWheelPractice:()=>({kind:'wheel'}),mountAdvancedWorkspace(){mounts++;return ()=>{};},supportsWrs:()=>false,connectVideoTasks(){},openCompanion(){},tab(){},showLogin(){},applyCourseProgress(){}};
 vm.createContext(c);vm.runInContext(render,c);c.renderAdvanced('lab');
 assert.equal(host.children.filter(c=>c.kind==='guide').length,1);assert.equal(host.children.filter(c=>c.kind==='data-exercises').length,1);assert.equal(mounts,1);
});

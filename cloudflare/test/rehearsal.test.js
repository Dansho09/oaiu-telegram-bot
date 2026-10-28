import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { handleRehearsal, rehearsalItems, estimateRehearsal } from '../src/rehearsal.js';
import { captureResultContext } from '../src/companion.js';
const source = () => ({step:'ready',format:'script',language:'kk',brief:'Сынақ',result:'Дайын сценарий.',host_count:2,host_names:['Алия','Ерлан'],event_minutes:60,script_data:{blocks:[{title:'Ашылу',minutes:1,cue:'Оң жақтан шығу.',lines:{host_1:'Сәлем! '.repeat(160),host_2:'Қош келдіңіздер!'}},{title:'Матчтар',minutes:59,cue:'Алаң бос болсын.',lines:{host_1:'Жарысты бастаймыз!',host_2:'Сәттілік!'}}]}});
const chat = 901, last = f => JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='message' ORDER BY id DESC LIMIT 1").payload);
const action = (f,key,value='') => handleRehearsal(f.dialogue,chat,'',`rehearsal:${key}:${f.store.get(chat).rehearsal_state.token}${value?':'+value:''}`,'');
test('rehearsal selects spoken roles and estimates speech separately from stage and match time',()=>{
 const s=source();const role=rehearsalItems(s,'host_2');assert.equal(role.length,2);assert.ok(role.every(i=>i.role==='host_2'));assert.ok(!role.map(i=>i.text).join('').includes('Сәлем'));assert.match(role[0].cue,/Оң жақтан/);
 const estimate=estimateRehearsal(s);assert.equal(estimate.overflow.length,1);assert.equal(estimate.overflow[0].title,'Ашылу');assert.ok(estimate.seconds<600);assert.ok(estimateRehearsal(s,'slow').seconds>estimateRehearsal(s,'fast').seconds);
});
test('rehearsal uses finished snapshot instead of pending program changes',()=>{
 const s=source();s.result_context=captureResultContext(s);s.script_data={blocks:[]};s.host_count=4;assert.equal(rehearsalItems(s,'host_2').length,2);
});
test('rehearsal handler navigates with private token and never mutates the finished text',()=>{
 const f=fixture();const s=source();f.store.put(chat,s);handleRehearsal(f.dialogue,chat,'','','/rehearse');const token=f.store.get(chat).rehearsal_state.token;assert.match(last(f).text,/шамамен/);assert.match(last(f).text,/Матч/);
 action(f,'role','host_2');action(f,'view','0');assert.match(last(f).text,/Қош келдіңіздер/);assert.ok(!last(f).text.includes('Сәлем'));action(f,'view','999');assert.equal(f.store.get(chat).rehearsal_state.index,1);
 handleRehearsal(f.dialogue,902,'',`rehearsal:view:${token}:0`,'');assert.equal(f.store.get(902).rehearsal_state,undefined);
 f.store.put(chat,{...f.store.get(chat),result:'Басқа мәтін'});action(f,'view','0');assert.match(last(f).text,/ескірген/);assert.equal(f.store.get(chat).result,'Басқа мәтін');
});
test('manual rehearsal timer starts and stops without automatic notifications',()=>{
 const f=fixture();f.store.put(chat,source());handleRehearsal(f.dialogue,chat,'','','/rehearse');const original=Date.now;
 try{Date.now=()=>100000;action(f,'start');assert.equal(f.store.get(chat).rehearsal_state.started_at,100000);Date.now=()=>175000;action(f,'stop');assert.match(last(f).text,/1 мин 15 сек/);assert.equal(f.store.get(chat).rehearsal_state.started_at,undefined);assert.equal(f.store.job(chat),null);}finally{Date.now=original;}
});
test('rehearsal asks shortening only after explicit action, and rejects unfinished settings',()=>{
 const f=fixture();f.store.put(chat,source());handleRehearsal(f.dialogue,chat,'','','/rehearse');assert.equal(f.store.job(chat),null);action(f,'shorten');assert.ok(f.store.job(chat));assert.equal(f.store.job(chat).session.result,source().result);assert.match(f.store.job(chat).instruction,/ұзақтығын/);
 const other=fixture();other.store.put(chat,{...source(),step:'program_list'});handleRehearsal(other.dialogue,chat,'','','/rehearse');assert.equal(other.store.get(chat).step,'program_list');assert.match(last(other).text,/аяқтаңыз/);
});

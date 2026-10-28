import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { handleOperations, emergencyProposal, finalizeOperationsResult, OperationsConflict, filterAbsentGuests, eligibleGuests, operationsPrompt } from '../src/operations.js';
import { renderStructuredScenario, timeline } from '../src/scenario.js';
import { captureResultContext, roleSheet } from '../src/companion.js';
import { PEOPLE } from '../src/directory.js';
const CHAT = 901;
function ready() {
 const s={step:'ready',format:'script',language:'kk',brief:'Ертең акт залында кездесу.',event_minutes:60,event_start:840,host_count:2,stage_key:'right_left',event_preset:'general',program_blocks:[{id:'opening',titles:['Открытие','Ашылу','Opening'],minutes:10},{id:'welcome',titles:['Приветствие','Құттықтау','Welcome'],minutes:20},{id:'closing',titles:['Закрытие','Жабылу','Closing'],minutes:30}]};
 s.result=renderStructuredScenario(s,{blocks:[{index:0,lines:{host_1:'Алғашқы бекітілген сөз.',host_2:'Алғашқы екінші реплика.'}},{index:1,lines:{host_1:'Қонақтарға қош келдіңіздер!',host_2:'Кездесу жалғасады.'}},{index:2,lines:{host_1:'Кездесу аяқталды.',host_2:'Рақмет!'}}]});s.result_context=captureResultContext(s);return s;
}
const act=(f,callback='',text='',command='',chat=CHAT)=>f.store.transaction(()=>handleOperations(f.dialogue,chat,text,callback,command));
const token=(f,key)=>f.store.get(CHAT)[key].nonce;
const texts=f=>f.store.rows("SELECT payload FROM outbox WHERE kind='message' ORDER BY id").map(row=>JSON.parse(row.payload).text);
function regenerated(session) { delete session.result_context;return renderStructuredScenario(session,{blocks:timeline(session).map((_,index)=>({index,lines:{host_1:'Жаңартылған реплика '+index,host_2:'Екінші жаңа реплика '+index}}))}); }

test('emergency delays and early finish change only remaining time and preserve completed spoken lines',()=>{
 const s=ready(),old=s.script_data.blocks[0],delayed=emergencyProposal(s,{completed:1,kind:'delay10'});
 assert.equal(delayed.event_minutes,70);assert.deepEqual(timeline(delayed)[0],timeline(s)[0]);assert.equal(timeline(delayed)[1].minutes,10);assert.equal(timeline(delayed).at(-1).end,70);
 const text=finalizeOperationsResult(delayed,regenerated(delayed));assert.deepEqual(delayed.script_data.blocks[0],old);assert.match(text,/Алғашқы бекітілген сөз/);assert.match(text,/15:10/);
 delayed.result=text;delayed.result_context=captureResultContext(delayed);assert.match(roleSheet(delayed,'host_1'),/Алғашқы бекітілген сөз/);
 const shorter=emergencyProposal(s,{completed:1,kind:'short15'});assert.equal(shorter.event_minutes,45);assert.equal(shorter.program_blocks[0].minutes,10);assert.equal(timeline(shorter).at(-1).end,45);
});
test('emergency rejects impossible time, completed programs and too many segments without mutating the source',()=>{
 const s=ready(),before=structuredClone(s);assert.throws(()=>emergencyProposal(s,{completed:3,kind:'music'}),OperationsConflict);
 const full={...s,event_minutes:480,program_blocks:Array.from({length:16},(_,i)=>({id:'b'+i,titles:['x','x','x'],minutes:30})),script_data:{blocks:Array.from({length:16},(_,i)=>({index:i,title:'x',start:i*30,end:(i+1)*30}))}};
 assert.throws(()=>emergencyProposal(full,{completed:1,kind:'delay10'}),OperationsConflict);
 assert.throws(()=>emergencyProposal({...s,event_minutes:20,program_blocks:s.program_blocks.map((b,i)=>({...b,minutes:[5,5,10][i]}))},{completed:2,kind:'short15'}),OperationsConflict);assert.deepEqual(s,before);
});
test('emergency preview does not change the draft, cancel restores it, apply starts exactly the previewed plan',()=>{
 const f=fixture(),s=ready();f.store.put(CHAT,s);act(f,'','','/emergency');let n=token(f,'ops_ui');act(f,`ops:progress:${n}:1`);act(f,`ops:kind:${n}:delay20`);
 assert.equal(f.store.get(CHAT).step,'ops_review');assert.equal(f.store.get(CHAT).event_minutes,60);assert.equal(f.store.get(CHAT).result,s.result);assert.equal(f.store.job(CHAT),null);
 act(f,`ops:cancel:${n}`);assert.equal(f.store.get(CHAT).step,'ready');assert.equal(f.store.get(CHAT).result,s.result);
 act(f,'','','/emergency');n=token(f,'ops_ui');act(f,`ops:progress:${n}:1`);act(f,`ops:kind:${n}:delay20`);act(f,`ops:apply:${n}`);
 assert.equal(f.store.job(CHAT).session.event_minutes,80);assert.equal(f.store.job(CHAT).session.emergency_state.completed,1);assert.equal(f.store.get(CHAT).result,s.result);
});
test('music failure is applied only to future cues and finalization is idempotent',()=>{
 const s=ready(),p=emergencyProposal(s,{completed:1,kind:'music'}),text=finalizeOperationsResult(p,regenerated(p));assert.equal(p.script_data.blocks[0].cue,s.script_data.blocks[0].cue);assert.match(p.script_data.blocks[1].cue,/Музыка қосылмайды/);assert.match(p.script_data.technical,/МУЗЫКАСЫЗ/);assert.equal(finalizeOperationsResult(p,text),text);
});
test('script locks restore exact approved line and fail safely if the locked role or block is removed',()=>{
 const s=ready();s.locked_fragments=[{id:'abcdef01',kind:'script',block_id:'welcome',block_title:'Құттықтау',host:'host_1',text:'Сөзбе-сөз бекітілген құттықтау.'}];
 const text=finalizeOperationsResult(s,regenerated(s));assert.equal(s.script_data.blocks[1].lines.host_1,'Сөзбе-сөз бекітілген құттықтау.');assert.match(text,/Сөзбе-сөз бекітілген/);assert.match(s.operations_notice,/1 реплика/);
 const removed={...s,program_blocks:s.program_blocks.filter(b=>b.id!=='welcome')};assert.throws(()=>finalizeOperationsResult(removed,text),OperationsConflict);
});
test('ordinary text locks replace explicit placeholders and reject silently rewritten quotations',()=>{
 const s={format:'speech',locked_fragments:[{id:'lock001',kind:'text',text:'Университетімізге қош келдіңіздер!'}]};assert.equal(finalizeOperationsResult(s,'Сәлем! [[OAIU_LOCK_lock001]]'),'Сәлем! Университетімізге қош келдіңіздер!');assert.throws(()=>finalizeOperationsResult(s,'Басқаша жазылған құттықтау.'),OperationsConflict);
});
test('lock wizard requires exact existing text, confirms the quote, persists it into history and isolates chats',()=>{
 const f=fixture(),s={step:'ready',format:'speech',language:'en',brief:'Greeting',result:'Сәлем! Бекітілген мәтін. Рақмет!'};f.store.put(CHAT,s);f.store.exec('INSERT INTO drafts(chat_id,title,text,context) VALUES (?,?,?,?)',CHAT,'Greeting',s.result,JSON.stringify(s));
 act(f,'','','/locks');let n=token(f,'lock_ui');act(f,`lock:add:${n}`);act(f,'','Мұндай үзінді жоқ.');assert.equal(f.store.get(CHAT).step,'lock_text');act(f,'','Бекітілген мәтін.');assert.equal(f.store.get(CHAT).step,'lock_review');assert.equal(f.store.get(CHAT).locked_fragments,undefined);
 act(f,`lock:confirm:${n}`);assert.equal(f.store.get(CHAT).locked_fragments.length,1);const context=JSON.parse(f.store.one('SELECT context FROM drafts WHERE chat_id=?',CHAT).context);assert.equal(context.locked_fragments[0].text,'Бекітілген мәтін.');
 act(f,`lock:remove:${n}:${f.store.get(CHAT).locked_fragments[0].id}`);assert.equal(f.store.get(CHAT).locked_fragments.length,1,'old nonce is stale');act(f,`lock:confirm:${n}`,'','',CHAT+1);assert.equal(f.store.get(CHAT+1).locked_fragments,undefined);assert.ok(!texts(f).at(-1).includes('Бекітілген мәтін.'));
});
test('guest statuses are manual and require explicit apply before rewriting; absent guests cannot be invited',()=>{
 const f=fixture(),s=ready();s.people=['rector'];s.directory_people=[PEOPLE[0]];f.store.put(CHAT,s);act(f,'','','/guests');let n=token(f,'guest_ui');act(f,`guest:person:${n}:rector`);act(f,`guest:set:${n}:absent`);
 assert.equal(f.store.get(CHAT).guest_statuses.rector,'absent');assert.equal(f.store.get(CHAT).result,s.result);assert.equal(f.store.job(CHAT),null);n=token(f,'guest_ui');act(f,`guest:apply:${n}`);assert.equal(f.store.job(CHAT),null);act(f,`guest:confirm:${n}`);
 const job=f.store.job(CHAT);assert.deepEqual(job.session.people,[]);assert.equal(eligibleGuests(job.session).length,0);assert.match(operationsPrompt(job.session),/Ажидинов/);assert.match(operationsPrompt(job.session),/Келмейді/);assert.equal(f.sent.length,0,'no external guest messages');
 const custom={...s,people:['c1'],custom_people:[{id:'c1',name:'Айша Тест',role:'қонақ'}],guest_statuses:{c1:'absent'}};assert.equal(filterAbsentGuests(custom).custom_people.length,1,'keep the verified custom roster for future status edits');
});
test('absent guest and an approved future invitation produce an explicit conflict instead of unsafe rewriting',()=>{
 const s=ready(),name='Айша Тест';s.guest_statuses={test:'absent'};s.guest_records={test:{name,role:'Қонақ'}};s.locked_fragments=[{id:'l1',kind:'script',block_id:'welcome',host:'host_1',text:`Сөзге ${name} шақырамыз.`}];assert.throws(()=>finalizeOperationsResult(s,regenerated(s)),/Келмейтін қонақ/);
});
test('stale and expired operations cannot mutate another version or another user',()=>{
 const f=fixture(),s=ready();f.store.put(CHAT,s);act(f,'','','/emergency');const n=token(f,'ops_ui');f.store.put(CHAT,{...f.store.get(CHAT),ops_ui:{...f.store.get(CHAT).ops_ui,started:Date.now()-16*60000}});act(f,`ops:progress:${n}:1`);assert.equal(f.store.get(CHAT).step,'ops_progress');assert.equal(f.store.get(CHAT).event_minutes,60);act(f,`ops:apply:${n}`,'','',CHAT+1);assert.equal(f.store.job(CHAT+1),null);assert.equal(handleOperations(f.dialogue,CHAT,'ordinary','',''),true);assert.match(texts(f).at(-1),/ескірді/);
});

test('free text absence resolves selected guest before deterministic renderer can re-invite them',()=>{
 const s=ready();s.people=['rector'];s.directory_people=[PEOPLE[0]];const p=emergencyProposal(s,{completed:0,kind:'absent',detail:'Ажидинов келмейді.'});assert.equal(p.guest_statuses.rector,'absent');assert.match(p.emergency_state.detail,/Ажидинов/);
 const source={...p,people:[],directory_people:[]};const text=regenerated(source);source.script_data.blocks[1].lines.host_1='Құттықтау үшін ректорды шақырамыз.';const safe=finalizeOperationsResult(source,text);assert.doesNotMatch(source.script_data.blocks[1].lines.host_1,/ректорды/);assert.match(safe,/Бағдарламаны жалғастырамыз/);
 assert.throws(()=>emergencyProposal(s,{completed:0,kind:'absent',detail:'Біреу келмейді.'}),/батырмамен таңдаңыз/);
 const custom=emergencyProposal(s,{completed:0,kind:'absent',detail:'Айша Тест; қонақ'});assert.ok(Object.keys(custom.guest_statuses).some(id=>id.startsWith('absent_')));assert.ok(Object.values(custom.guest_records).some(record=>record.name==='Айша Тест'));
});
test('absent guest guard removes future names but preserves completed historical mentions',()=>{
 const s=ready();s.guest_statuses={rector:'absent'};s.guest_records={rector:{name:PEOPLE[0].nameKk,names:[PEOPLE[0].nameKk,PEOPLE[0].name],role:'OAIU ректоры'}};s.script_data.blocks[0].lines.host_1=PEOPLE[0].nameKk+' сөз сөйледі.';const p=emergencyProposal(s,{completed:1,kind:'music'});regenerated(p);p.script_data.blocks[1].lines.host_1=PEOPLE[0].name+' сөзге шақырамыз.';finalizeOperationsResult(p,'');assert.match(p.script_data.blocks[0].lines.host_1,/Ажидинов/);assert.doesNotMatch(p.script_data.blocks[1].lines.host_1,/Ажидинов/);
});

test('expired owned wizards can reopen and callbacks cannot omit the nonce',()=>{
 const f=fixture(),s=ready();f.store.put(CHAT,s);act(f,'','','/emergency');const first=token(f,'ops_ui');act(f,'ops:cancel:');assert.equal(f.store.get(CHAT).step,'ops_progress');act(f,'','','/emergency');assert.notEqual(token(f,'ops_ui'),first);act(f,`ops:cancel:${token(f,'ops_ui')}`);act(f,'','','/locks');const old=token(f,'lock_ui');act(f,'lock:close:');assert.equal(f.store.get(CHAT).step,'lock_menu');act(f,'','','/locks');assert.notEqual(token(f,'lock_ui'),old);
});

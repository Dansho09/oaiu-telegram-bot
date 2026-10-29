import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { renderStructuredScenario, timeline } from '../src/scenario.js';
import { captureResultContext } from '../src/companion.js';
import { completeVoice } from '../src/voice.js';
import { PEOPLE } from '../src/directory.js';
let sequence=1700000;
const chat=991;
const send=(f,text,c=chat)=>f.dialogue.accept({update_id:sequence++,message:{chat:{id:c,type:'private'},from:{id:c},text}});
const tap=(f,data,c=chat)=>f.dialogue.accept({update_id:sequence++,callback_query:{id:String(sequence),data,from:{id:c},message:{chat:{id:c,type:'private'}}}});
const messages=(f,c=chat)=>f.store.rows("SELECT payload FROM outbox WHERE kind='message' AND chat_id=? ORDER BY id",c).map(row=>JSON.parse(row.payload));
const last=(f,c=chat)=>messages(f,c).at(-1);
function click(f,prefix,value,c=chat){
 const candidates=messages(f,c).flatMap(m=>(m.reply_markup?.inline_keyboard||[]).flat()).reverse();
 const button=candidates.find(b=>b.callback_data?.startsWith(prefix)&&(value===undefined||b.callback_data.endsWith(':'+value)));
 assert.ok(button,`Missing button ${prefix} ${value||''}`);tap(f,button.callback_data,c);return button.callback_data;
}
function state(){return {step:'ready',format:'script',language:'kk',event_minutes:60,event_start:840,event_preset:'general',host_count:2,host_names:['Алия','Ерлан'],stage_key:'right_left',brief:'Ертең OAIU акт залында концерт өтеді.',people:['rector'],directory_people:[structuredClone(PEOPLE[0])],program_blocks:[{id:'opening',titles:['Открытие','Ашылу','Opening'],minutes:10},{id:'welcome',titles:['Слово руководства','Басшылықтың құттықтауы','Leadership address'],minutes:10},{id:'awards',titles:['Награждение','Марапаттау','Awards'],minutes:20},{id:'closing',titles:['Закрытие','Жабылу','Closing'],minutes:20}]};}
function ready(f,c=chat){const s=state();const result=renderStructuredScenario(s,{blocks:timeline(s).map((row,index)=>({index,lines:{host_1:`${index+1}-бөлімнің бастапқы репликасы.`,host_2:'Барлық қатысушыларға алғыс айтамыз.'}}))});s.result=result;s.result_context=captureResultContext(s);f.store.saveJob(c,{id:'seed',session:s});f.store.finish(c,'seed',s,result);f.store.cancel(c);return f.store.get(c);}
async function finish(f,c=chat){const job=f.store.job(c);assert.ok(job);const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({blocks:timeline(job.session).map((b,index)=>({index,lines:{host_1:`${index+1}-бөлімнің жаңа репликасы.`,host_2:'Келесі бөлімді бастаймыз.'}}))})},finish_reason:'stop'}]}));try{const text=await f.bot.generate(job);f.store.finish(c,job.id,job.session,text);f.store.cancel(c);return f.store.get(c);}finally{globalThis.fetch=old;}}

test('all seven organizer tools are reachable through the actual dialogue launcher with Kazakh captions',()=>{
 const tools=[['nav:live','ops:open','ops_progress'],['nav:live','rehearsal:open','rehearsal'],['nav:organize','tournament:open','tournament_teams'],['nav:live','lock:open','lock_menu'],['nav:organize','awards:open','awards_review'],['nav:people','guest:open','guest_menu'],['nav:home','nav:voice','ready']];
 for(const [page,callback,step]of tools){const f=fixture();ready(f);send(f,'/tools');tap(f,page);const buttons=last(f).reply_markup.inline_keyboard.flat();assert.ok(buttons.length<=7);assert.ok(buttons.some(b=>b.callback_data===callback));assert.ok(buttons.every(b=>!/(?:Награждение|Закреплён|Статус гостей|Голосовое задание|Форс-мажор)/iu.test(b.text)));tap(f,callback);assert.equal(f.store.get(chat).step,step,callback);assert.equal(f.store.get(chat).language,'kk');}
});

test('a locked host line survives a later emergency replan, new document snapshot and history restore',async()=>{
 const f=fixture(), original=ready(f);send(f,'/locks');click(f,'lock:add:');click(f,'lock:block:','0');click(f,'lock:host:','host_1');click(f,'lock:confirm:');click(f,'lock:close:');const locked=f.store.get(chat).locked_fragments[0];assert.equal(locked.text,original.script_data.blocks[0].lines.host_1);
 send(f,'/emergency');click(f,'ops:progress:','1');click(f,'ops:kind:','delay10');assert.equal(f.store.get(chat).event_minutes,60);click(f,'ops:apply:');const done=await finish(f);assert.equal(done.event_minutes,70);assert.deepEqual(done.script_data.blocks[0],original.script_data.blocks[0]);assert.equal(done.result_context.locked_fragments[0].text,locked.text);
 send(f,'/word');const doc=JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='document' ORDER BY id DESC LIMIT 1").payload);assert.ok(doc.text.includes(locked.text));
 send(f,'/history');const id=f.store.one('SELECT id FROM drafts WHERE chat_id=? ORDER BY id DESC LIMIT 1',chat).id;send(f,'/new');tap(f,'history:'+id);assert.equal(f.store.get(chat).locked_fragments[0].text,locked.text);assert.equal(f.store.get(chat).event_minutes,70);
});

test('guest absence removes the selected person from newly generated invitations and persists in history',async()=>{
 const f=fixture();ready(f);send(f,'/guests');click(f,'guest:person:','rector');click(f,'guest:set:','absent');click(f,'guest:apply:');click(f,'guest:confirm:');const job=f.store.job(chat);assert.ok(!job.session.people.includes('rector'));const done=await finish(f);assert.equal(done.guest_statuses.rector,'absent');assert.ok(!done.result.includes(PEOPLE[0].nameKk));assert.equal(done.result_context.guest_statuses.rector,'absent');
});

test('awards confirmation and tournament cancellation remain isolated from a saved script and another user',()=>{
 const f=fixture(),original=ready(f);ready(f,chat+1);send(f,'/awards');click(f,'awards:recipients:');send(f,'Алия Садыкова; Үздік студент\nЕрлан Асанов; Үздік жүргізуші');click(f,'awards:confirm:');assert.equal(f.store.get(chat).result,original.result);assert.equal(f.store.get(chat).awards_data.recipients.length,2);assert.equal(f.store.get(chat+1).awards_data,undefined);click(f,'awards:close:');
 send(f,'/tournament');send(f,'А тобы; Б тобы; В тобы; Г тобы');click(f,'tournament:format:','roundrobin');click(f,'tournament:courts:','2');send(f,'15');send(f,'5');send(f,'14:00');click(f,'tournament:export:','pdf');const doc=JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='document' ORDER BY id DESC LIMIT 1").payload);assert.ok(doc.text.includes('А тобы'));assert.equal(doc.format,'pdf');click(f,'tournament:cancel:');assert.equal(f.store.get(chat).result,original.result);assert.equal(f.store.get(chat).awards_data.recipients.length,2);assert.equal(f.store.get(chat).tournament_state,undefined);
});

test('rehearsal uses its saved speaker snapshot and cancels cleanly before an unrelated edit',()=>{
 const f=fixture(),original=ready(f);send(f,'/rehearse');click(f,'rehearsal:roles:');click(f,'rehearsal:role:','host_1');click(f,'rehearsal:view:','0');assert.ok(last(f).text.includes(original.script_data.blocks[0].lines.host_1));assert.ok(!last(f).text.includes(original.script_data.blocks[0].lines.host_2));click(f,'rehearsal:start:');click(f,'rehearsal:stop:');assert.match(last(f).text,/Қолмен өлшенген уақыт/);click(f,'rehearsal:summary:');click(f,'rehearsal:close:');assert.equal(f.store.get(chat).result,original.result);assert.equal(f.store.get(chat).rehearsal_state,undefined);send(f,'Мәтінді жылы ет.');assert.ok(f.store.job(chat));assert.equal(f.store.job(chat).session.language,'kk');
});

test('voice requires consent and transcript review, then delete cancels voice jobs without affecting another user',()=>{
 const f=fixture();ready(f);ready(f,chat+1);f.dialogue.accept({update_id:sequence++,message:{chat:{id:chat,type:'private'},from:{id:chat},voice:{file_id:'test-voice',file_size:1000,duration:10,mime_type:'audio/ogg'}}});assert.equal(f.store.get(chat).step,'voice_consent');assert.equal(f.store.one("SELECT COUNT(*) AS n FROM outbox WHERE kind='voice_transcribe'").n,0);click(f,'voice:transcribe:');const payload=JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='voice_transcribe'").payload);assert.equal(f.store.get(chat).step,'voice_loading');completeVoice(f.store,chat,payload,{text:'Мәтінді жылы ет.',duration:10});assert.equal(f.store.job(chat),null);assert.match(last(f).text,/Танылған мәтін/);click(f,'voice:cancel:');assert.equal(f.store.get(chat).step,'ready');assert.equal(f.store.one("SELECT COUNT(*) AS n FROM outbox WHERE kind='voice_transcribe'").n,0);
 send(f,'/delete');tap(f,'delete:confirm');assert.equal(f.store.get(chat).result,undefined);assert.ok(f.store.get(chat+1).result);assert.equal(f.store.get(chat).voice_request,undefined);assert.equal(f.store.get(chat).awards_data,undefined);
});

test('an absent guest cannot be silently re-invited by restoring a conflicting locked welcome',async()=>{
 const f=fixture(),original=ready(f);send(f,'/locks');click(f,'lock:add:');click(f,'lock:block:','1');click(f,'lock:host:','host_1');click(f,'lock:confirm:');click(f,'lock:close:');assert.ok(f.store.get(chat).locked_fragments[0].text.includes(PEOPLE[0].nameKk));
 send(f,'/guests');click(f,'guest:person:','rector');click(f,'guest:set:','absent');click(f,'guest:apply:');click(f,'guest:confirm:');const job=f.store.job(chat);
 if(!job){assert.equal(f.store.get(chat).result,original.result);assert.match(last(f).text,/қайшылық|бекітілген|құлпын/iu);return;}
 const previous=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({blocks:timeline(job.session).map((b,index)=>({index,lines:{host_1:'Жаңа мәтін.',host_2:'Кешімізді жалғастырамыз.'}}))})},finish_reason:'stop'}]}));
 try{const text=await f.bot.generate(job);assert.throws(()=>f.store.finish(chat,job.id,job.session,text),/қайшылық|бекітілген|құлпын/iu);assert.equal(f.store.get(chat).result,original.result);}finally{globalThis.fetch=previous;}
});

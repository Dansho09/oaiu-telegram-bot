import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { handleAwards, parseAwardRecipients, renderAwards, awardsPrompt, applyAwardsToStructured } from '../src/awards.js';
import { timeline } from '../src/scenario.js';
let seq = 1100000;
const chat=951;
const messages=f=>f.store.rows("SELECT payload FROM outbox WHERE kind='message' ORDER BY id").map(r=>JSON.parse(r.payload));
const last=f=>messages(f).at(-1);
function command(f){return handleAwards(f.dialogue,chat,'/awards','','/awards');}
function input(f,text){return handleAwards(f.dialogue,chat,text,'','');}
function tap(f,action,value=''){const revision=f.store.get(chat).awards_ui?.revision;return handleAwards(f.dialogue,chat,'',`awards:${action}:${revision}${value?':'+value:''}`,'');}
const ready=()=>({step:'ready',format:'script',language:'kk',event_minutes:60,event_preset:'general',host_count:2,stage_key:'right_left',brief:'Концерт',result:'Алдыңғы дайын сценарий.'});
function confirmed(f,rows='Алия Садыкова; Үздік студент\nЕрлан Асанов; Үздік жүргізуші'){
 command(f);tap(f,'recipients');input(f,rows);tap(f,'confirm');return f.store.get(chat).awards_data;
}
test('recipient parser preserves confirmed Kazakh names and pronunciation, rejects duplicates and sensitive identifiers',()=>{
 const rows=parseAwardRecipients('Алия Садыкова; Үздік студент; А-ли-я\nЕрлан Асанов; Үздік жүргізуші');assert.equal(rows.length,2);assert.equal(rows[0].pronunciation,'А-ли-я');assert.equal(rows[1].pronunciation,'');
 for(const text of ['Алия Садыкова; Үздік студент\nАЛИЯ  САДЫКОВА; Үздік студент','Алия 123456789012; Үздік студент','Алия Садыкова; https://invalid.test','Алия Садыкова; Үздік; +77771234567','Алия Садыкова; Үздік; бір; екі','x'.repeat(6001),Array.from({length:61},(_,i)=>`Алия Садыкова; Номинация ${i}`).join('\n')])assert.throws(()=>parseAwardRecipients(text));
 assert.equal(parseAwardRecipients('Алия Садыкова; Үздік студент\nАлия Садыкова; Үздік ұйымдастырушы').length,2);
});
test('preview and cancel preserve prior generated text and do not publish partial data',()=>{
 const f=fixture();f.store.put(chat,ready());command(f);tap(f,'recipients');input(f,'Алия Садыкова; Үздік студент');assert.match(last(f).text,/Алия Садыкова/);assert.equal(f.store.get(chat).awards_data,undefined);assert.equal(f.store.get(chat).result,ready().result);
 tap(f,'cancel');assert.equal(f.store.get(chat).step,'ready');assert.equal(f.store.get(chat).awards_work,undefined);assert.equal(f.store.get(chat).result,ready().result);assert.equal(f.store.job(chat),null);
});
test('duplicates require correction and same person in different nominations shows a warning',()=>{
 const f=fixture();command(f);tap(f,'recipients');input(f,'Алия Садыкова; Үздік студент\nАлия Садыкова; Үздік студент');assert.match(last(f).text,/қайталанған/);assert.equal(f.store.get(chat).step,'awards_recipients');
 input(f,'Алия Садыкова; Үздік студент\nАлия Садыкова; Үздік ұйымдастырушы');assert.match(last(f).text,/бір адам бірнеше номинацияда/);
});
test('recipient editing, ordering and removal use stable ids without silently changing the finished document',()=>{
 const f=fixture();f.store.put(chat,ready());confirmed(f);tap(f,'edit');let data=f.store.get(chat).awards_work;const first=data.recipients[0].id,second=data.recipients[1].id;
 tap(f,'item',second);tap(f,'up',second);assert.deepEqual(f.store.get(chat).awards_work.recipients.map(p=>p.id),[second,first]);
 tap(f,'item',second);tap(f,'rename',second);input(f,'Ерлан Асанов; Ерекше алғыс; Ер-лан');assert.equal(f.store.get(chat).awards_work.recipients[0].id,second);assert.equal(f.store.get(chat).awards_work.recipients[0].nomination,'Ерекше алғыс');
 tap(f,'list');tap(f,'item',first);tap(f,'remove',first);assert.equal(f.store.get(chat).awards_work.recipients.length,1);assert.equal(f.store.get(chat).result,ready().result);
});
test('presenter, prize and seconds are explicit confirmed facts; standalone scripts and exports include every recipient',()=>{
 const f=fixture();command(f);tap(f,'recipients');input(f,'Алия Садыкова; Үздік студент; А-ли-я\nЕрлан Асанов; Үздік жүргізуші');tap(f,'presenter_custom');input(f,'Тест Марапаттаушы; ұйымдастырушы');tap(f,'prize');input(f,'Алғыс хат');tap(f,'seconds');input(f,'9');assert.match(last(f).text,/10–120/);input(f,'45');tap(f,'confirm');
 const data=f.store.get(chat).awards_data,text=renderAwards(data);assert.match(text,/Тест Марапаттаушы/);assert.match(text,/Алғыс хат/);assert.match(text,/шамамен 2 минут/);assert.match(text,/А-ли-я/);for(const p of data.recipients)assert.ok(text.includes(p.name));assert.ok(!text.includes('кубок'));assert.match(awardsPrompt(f.store.get(chat)),/recipient_count/);assert.ok(!awardsPrompt(f.store.get(chat)).includes('Алия Садыкова'));
 for(const format of ['docx','pdf','txt'])tap(f,'download',format);const queued=f.store.rows("SELECT payload FROM outbox WHERE kind='document'").map(r=>JSON.parse(r.payload));assert.equal(queued.length,3);for(const payload of queued){assert.equal(payload.text,text);assert.equal(payload.title,'OAIU марапаттау сценарийі');}
});
test('stale and foreign user callbacks cannot confirm or export another persons list',()=>{
 const f=fixture();command(f);const rev=f.store.get(chat).awards_ui.revision;tap(f,'recipients');input(f,'Алия Садыкова; Үздік студент');handleAwards(f.dialogue,chat,'',`awards:confirm:${rev}`,'');assert.match(last(f).text,/ескірді/);assert.equal(f.store.get(chat).awards_data,undefined);
 handleAwards(f.dialogue,chat+1,'',`awards:confirm:${f.store.get(chat).awards_ui.revision}`,'');assert.equal(f.store.get(chat+1).awards_data,undefined);assert.equal(f.store.get(chat).awards_data,undefined);
});
test('applying awards requires an explicit second preview and adds enough time for the exact recipient count',()=>{
 const f=fixture();f.store.put(chat,{...ready(),event_minutes:15,program_blocks:[{id:'opening',titles:['Открытие','Ашылу','Opening'],minutes:10},{id:'closing',titles:['Закрытие','Жабылу','Closing'],minutes:5}]});
 confirmed(f);tap(f,'edit');tap(f,'seconds');input(f,'120');tap(f,'confirm');tap(f,'apply');assert.equal(f.store.job(chat),null);assert.match(last(f).text,/15 → 19 минут/);assert.equal(f.store.get(chat).event_minutes,15);
 tap(f,'apply_confirm');const job=f.store.job(chat);assert.equal(job.session.event_minutes,19);assert.deepEqual(job.session.program_blocks.map(b=>b.id).filter(id=>['opening','closing'].includes(id)),['opening','closing']);assert.equal(timeline(job.session).at(-1).end,19);
 const raw={blocks:timeline(job.session).map((b,index)=>({index,lines:{host_1:'Жалпы реплика',host_2:'Жалпы реплика'}}))};const replaced=applyAwardsToStructured(job.session,raw);assert.equal(raw.blocks[1].lines.host_1,'Жалпы реплика');for(const p of job.session.awards_data.recipients)assert.ok(JSON.stringify(replaced.blocks[1].lines).includes(p.name));
});
test('awards enlargement respects program limits and cancel restores pending settings',()=>{
 const f=fixture();f.store.put(chat,{...ready(),event_minutes:480,program_blocks:[{id:'main',titles:['Программа','Бағдарлама','Program'],minutes:480}]});confirmed(f);tap(f,'apply');assert.match(last(f).text,/сыймайды/);assert.equal(f.store.job(chat),null);assert.equal(f.store.get(chat).event_minutes,480);
 const f2=fixture();f2.store.put(chat,ready());confirmed(f2);tap(f2,'apply');tap(f2,'apply_cancel');assert.equal(f2.store.get(chat).step,'ready');assert.equal(f2.store.get(chat).result,ready().result);assert.equal(f2.store.job(chat),null);
});

test('sixty confirmed recipients and prize-like nomination labels survive structured generation and role snapshots', async()=>{
 const f=fixture();f.store.put(chat,ready());const rows=Array.from({length:60},(_,i)=>`Сынақ ${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)}; Кубок үздігі`).join('\n');confirmed(f,rows);tap(f,'apply');tap(f,'apply_confirm');const job=f.store.job(chat);
 const raw={blocks:timeline(job.session).map((block,index)=>({index,lines:{host_1:'Қош келдіңіздер!',host_2:'Барлық қатысушыға алғыс айтамыз.'}}))};const saved=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(raw)},finish_reason:'stop'}]}));
 try{const text=await f.bot.generate(job);for(const recipient of job.session.awards_data.recipients){assert.ok(text.includes(recipient.name),recipient.name);assert.ok(JSON.stringify(job.session.script_data).includes(recipient.name),recipient.name+' role snapshot');}assert.ok(text.includes('Кубок үздігі'));}finally{globalThis.fetch=saved;}
});

test('structured awards preserve the exact entered order with one, two and four hosts',async()=>{
 for(const count of [1,2,4]){
  const f=fixture();f.store.put(chat,{...ready(),host_count:count});confirmed(f,'Бірінші Тест; Бірінші номинация\nЕкінші Тест; Екінші номинация\nҮшінші Тест; Үшінші номинация');tap(f,'apply');tap(f,'apply_confirm');const job=f.store.job(chat);const raw={blocks:timeline(job.session).map((b,index)=>({index,lines:Object.fromEntries(Array.from({length:count},(_,i)=>['host_'+(i+1),'Бастапқы реплика.']))}))};const saved=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(raw)},finish_reason:'stop'}]}));
  try{const result=await f.bot.generate(job);const positions=job.session.awards_data.recipients.map(p=>result.indexOf(p.name));assert.ok(positions.every(n=>n>=0));assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));const block=job.session.script_data.blocks.find(b=>/Марапаттау/.test(b.title));assert.ok(block.lines.host_1.includes('Үшінші Тест'));}finally{globalThis.fetch=saved;}
 }
});

test('awards prompt is bounded and omits recipient personal data even for sixty long records',()=>{
 const data={version:1,confirmed:true,seconds:30,presenter:null,prize:'Алғыс хат',recipients:Array.from({length:60},(_,i)=>({id:String(i),name:'Сынақ '+String.fromCharCode(65+i%26)+' А'.repeat(40),nomination:'Номинация '.repeat(8),pronunciation:'Ұйымдастырушы растаған айтылу'}))};const prompt=awardsPrompt({awards_data:data});assert.ok(prompt.length<1000);assert.match(prompt,/"recipient_count":60/);assert.ok(!prompt.includes(data.recipients[0].name));assert.ok(!prompt.includes('Ұйымдастырушы растаған айтылу'));const text=renderAwards(data);for(const recipient of data.recipients)assert.ok(text.includes(recipient.name));
});

test('applying awards refuses to replace a locked or already completed award block',()=>{
 const f=fixture();const source={...ready(),program_blocks:[{id:'awards',titles:['Награждение','Марапаттау','Awards'],minutes:60}],locked_fragments:[{id:'pin',kind:'script',block_id:'awards',host:'host_1',text:'Бекітілген ресми мәтін.'}]};f.store.put(chat,source);confirmed(f);tap(f,'apply');assert.match(last(f).text,/қайшы/);assert.equal(f.store.job(chat),null);assert.equal(f.store.get(chat).result,source.result);
 const f2=fixture();f2.store.put(chat,{...source,locked_fragments:[],emergency_state:{version:1,completed:1}});confirmed(f2);tap(f2,'apply');assert.match(last(f2).text,/аяқталған/);assert.equal(f2.store.job(chat),null);
});

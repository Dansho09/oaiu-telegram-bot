import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { captureResultContext, roleSheet, preflight } from '../src/companion.js';
import { resultButtons } from '../src/core.js';
let seq = 710000;
const tap = (data, chat=29) => ({update_id:seq++, callback_query:{id:String(seq),data,from:{id:chat},message:{chat:{id:chat,type:'private'}}}});
const messages = f => f.store.rows("SELECT payload FROM outbox WHERE kind='message'").map(r=>JSON.parse(r.payload));
const state = () => ({step:'ready',format:'script',language:'kk',brief:'Ертең спортзалда волейбол жарысы болады.',result:'Дайын мәтін. [Марапаттаушы] [келісілген марапаттарды] табыстайды.',host_count:2,host_names:['Алия','Ерлан'],event_minutes:60,event_start:840,event_preset:'volleyball',stage_key:'gym',script_data:{blocks:[{index:0,title:'Ашылу',start:0,end:5,minutes:5,cue:'Оң жақтан шығу.',lines:{host_1:'Алияның репликасы.',host_2:'Ерланның репликасы.'}}]}});
test('role sheets preserve one host and routes without another host speech',()=>{
 const s=state(), text=roleSheet(s,'host_1'); assert.match(text,/Алияның репликасы/);assert.ok(!text.includes('Ерланның репликасы'));assert.match(text,/14:00–14:05/);assert.match(text,/Оң жақтан/);assert.equal(roleSheet(s,'host_3'),null);assert.equal(roleSheet(s,'../secret'),null);
 assert.ok(!roleSheet(s,'sound').includes('Алияның репликасы'));assert.match(roleSheet(s,'coordinator'),/Оң жақтан/);
});
test('saved result snapshot prevents pending constructor edits from changing attachments',()=>{
 const s=state();s.result_context=captureResultContext(s); s.event_start=600;s.host_names=['Другой','Чужой'];s.script_data={blocks:[]};assert.match(roleSheet(s,'host_1'),/14:00–14:05/);assert.match(roleSheet(s,'host_1'),/Алия/);assert.ok(!roleSheet(s,'host_1').includes('Другой'));
});
test('preflight finds placeholder names and missing time without treating stage cues as blanks',()=>{
 const s=state();delete s.event_start;s.result+=' [Ремарка: согласованный выход, проход свободен.]'; const report=preflight(s);assert.ok(report.issues.some(x=>x.includes('Марапаттаушы')));assert.ok(report.issues.some(x=>x.includes('00:00')));assert.ok(!report.issues.some(x=>x.includes('Ремарка')));
});
test('download menu queues requested formats and deduplicates pending clicks', async()=>{
 const f=fixture();f.store.put(29,state());f.dialogue.accept(tap('export:menu'));assert.match(JSON.stringify(messages(f)),/export:pdf/);
 f.dialogue.accept(tap('export:pdf'));f.dialogue.accept(tap('export:pdf'));assert.equal(f.store.one("SELECT COUNT(*) AS n FROM outbox WHERE kind='document'").n,1);
 await f.bot.flushOutbox(); await f.bot.flushOutbox();const file=f.sent.find(r=>r.method==='sendDocument').payload.get('document');assert.equal(file.type,'application/pdf');assert.equal((await file.text()).slice(0,5),'%PDF-');
});
test('separate sheet export queues only selected participant and other users cannot fetch it',()=>{
 const f=fixture();f.store.put(29,state());f.dialogue.accept(tap('sheetdoc:docx:host_2'));
 const payload=JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='document'").payload);assert.match(payload.text,/Ерланның репликасы/);assert.ok(!payload.text.includes('Алияның репликасы'));assert.equal(payload.format,'docx');
 f.dialogue.accept(tap('sheetdoc:docx:host_2',30));assert.equal(f.store.one("SELECT COUNT(*) AS n FROM outbox WHERE kind='document'").n,1);
});
test('old and non-script drafts do not fabricate role sheets',()=>{
 const f=fixture();f.store.put(29,{step:'ready',result:'Старая речь',format:'speech'});f.dialogue.accept(tap('sheet:host_1'));assert.match(messages(f).at(-1).text,/Жеке парақтар «Сценарий» форматына арналған/);assert.equal(roleSheet({result:'Старая речь'},'host_1'),null);
});
test('a kit never advertises or exports role sheets even with leftover structured data',()=>{
 const f=fixture(), kit={...state(),format:'kit'};f.store.put(29,kit);
 assert.ok(!resultButtons(kit).flat().some(button=>button.callback_data==='sheet:menu'));
 assert.equal(roleSheet(kit,'host_1'),null);
 f.dialogue.accept(tap('sheet:menu'));assert.match(messages(f).at(-1).text,/Жеке парақтар «Сценарий» форматына арналған/);
 f.dialogue.accept(tap('sheetdoc:docx:host_1'));assert.equal(f.store.one("SELECT COUNT(*) AS n FROM outbox WHERE kind='document'").n,0);
 f.dialogue.accept(tap('export:docx'));const payload=JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='document'").payload);assert.equal(payload.text,kit.result);assert.equal(payload.format,'docx');
});
test('export does not alter draft, cancel jobs or use model generation',()=>{
 const f=fixture();const s=state();f.store.put(29,s);f.dialogue.accept(tap('export:docx'));f.dialogue.accept(tap('check:open'));assert.deepEqual(f.store.get(29),s);assert.equal(f.store.job(29),null);
});

test('history restoration exits builder and cancels late generation',()=>{
 const f=fixture();const s=state();f.store.put(29,{...s,step:'program_list',program_revision:'x'});
 f.store.saveJob(29,{id:'late',session:s});f.store.exec('INSERT INTO drafts(id,chat_id,title,text,context) VALUES (?,?,?,?,?)',99,29,'История','Сохранённая версия',JSON.stringify({step:'ready',format:'speech'}));
 f.dialogue.accept(tap('history:99'));assert.equal(f.store.get(29).result,'Сохранённая версия');assert.equal(f.store.job(29),null);assert.equal(f.store.finish(29,'late',s,'Поздний ответ'),false);
});
test('correct details does not silently consume input inside pending settings',()=>{
 const f=fixture();f.store.put(29,{...state(),step:'program_list'});f.dialogue.accept(tap('check:fix'));assert.match(messages(f).at(-1).text,/Алдымен бағдарлама баптауын/);assert.equal(f.store.get(29).step,'program_list');
});
test('public export shortcuts work without an inline button',()=>{
 const f=fixture();f.store.put(29,state());f.dialogue.accept({update_id:seq++,message:{chat:{id:29,type:'private'},from:{id:29},text:'/word'}});assert.equal(JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='document'").payload).format,'docx');assert.equal(f.store.job(29),null);
});
test('preflight recognizes Kazakh inflected auditorium names from the original brief',()=>{
 const s=state();s.brief='Ертең OAIU акт залында студенттік концерт болады.';assert.ok(!preflight(s).issues.some(issue=>issue.startsWith('Орны:')));
});

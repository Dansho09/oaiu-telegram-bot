import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { emergencyProposal } from '../src/operations.js';
import { PEOPLE } from '../src/directory.js';
import { renderStructuredScenario } from '../src/scenario.js';

const oneBlock = (title='Марапаттау') => ({step:'ready',format:'script',language:'kk',brief:'Ертең OAIU акт залында іс-шара өтеді.',event_minutes:15,event_start:840,host_count:2,event_preset:'general',stage_key:'right_left',program_blocks:[{id:'single',titles:[title,title,title],minutes:15}]});
const raw = () => ({blocks:[{index:0,lines:{host_1:'Қош келдіңіздер!',host_2:'Іс-шарамызды бастаймыз!'}}]});
async function generate(f,session,instruction){
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(raw())},finish_reason:'stop'}]}));
 try{f.store.put(931,session);f.dialogue.generate(931,session,instruction,true);const job=f.store.job(931);const text=await f.bot.generate(job);assert.equal(f.store.finish(931,job.id,job.session,text),true);return f.store.get(931);}finally{globalThis.fetch=original;}
}
test('integrated awards keep the entered recipient order with two hosts',async()=>{
 const f=fixture(),session=oneBlock();session.result='Бұрынғы нұсқа.';session.awards_data={version:1,confirmed:true,seconds:30,presenter:null,prize:'Алғыс хат',recipients:[{id:'a',name:'Бірінші Аты Жөні',nomination:'Бірінші номинация',pronunciation:''},{id:'b',name:'Екінші Аты Жөні',nomination:'Екінші номинация',pronunciation:''},{id:'c',name:'Үшінші Аты Жөні',nomination:'Үшінші номинация',pronunciation:''}]};
 const result=await generate(f,session,'Расталған марапаттау тізімін енгіз.');const indices=session.awards_data.recipients.map(p=>result.result.indexOf(p.name));assert.ok(indices.every(i=>i>=0));assert.ok(indices[0]<indices[1]&&indices[1]<indices[2],'recipient sequence must stay 1,2,3 in the delivered script');
});
test('typed absence of a selected known guest prevents deterministic reinvitation',async()=>{
 const f=fixture(),rector=PEOPLE.find(p=>p.id==='rector'),session={...oneBlock('Құттықтау сөз'),people:['rector'],directory_people:[rector]};session.result=renderStructuredScenario(session,raw());
 const proposal=emergencyProposal(session,{completed:0,kind:'absent',detail:`${rector.nameKk} іс-шараға келмейді.`});
 const result=await generate(f,{...proposal,operation_generation:true},'Жедел өзгерісті қолдан. Келмейтін қонақты жаңадан шақырма.');assert.ok(!result.people.includes('rector'));assert.doesNotMatch(result.result,new RegExp(rector.nameKk));
});
test('a restored approved plain fragment remains exact after later editing',()=>{
 const f=fixture(),session={step:'ready',format:'speech',language:'kk',brief:'Құттықтау',result:'Расталған ресми мәтін. Қосымша сөз.',locked_fragments:[{id:'approved',kind:'text',text:'Расталған ресми мәтін.'}]};
 f.store.put(931,session);f.dialogue.generate(931,session,'Қысқарт.');let job=f.store.job(931);f.store.finish(931,job.id,job.session,'[[OAIU_LOCK_approved]] Жаңа финал.');const draft=f.store.one('SELECT id FROM drafts WHERE chat_id=?',931);
 f.dialogue.accept({update_id:972000,callback_query:{id:'history-lock',data:'history:'+draft.id,from:{id:931},message:{chat:{id:931,type:'private'}}}});assert.equal(f.store.get(931).locked_fragments[0].text,'Расталған ресми мәтін.');f.dialogue.generate(931,f.store.get(931),'Жылы ет.');job=f.store.job(931);f.store.finish(931,job.id,job.session,'[[OAIU_LOCK_approved]] Жылы финал.');assert.match(f.store.get(931).result,/Расталған ресми мәтін\./);
});

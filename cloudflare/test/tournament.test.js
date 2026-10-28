import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { parseTeams,validTournament,buildTournament,renderTournament,tournamentPrompt,handleTournament } from '../src/tournament.js';
const config = (n=5,format='roundrobin',courts=2) => ({teams:Array.from({length:n},(_,i)=>`Команда ${i+1}`),format,courts,match_minutes:20,break_minutes:5,start:840});
const chat=902,last=f=>JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='message' ORDER BY id DESC LIMIT 1").payload);
const action=(f,key,value='')=>handleTournament(f.dialogue,chat,'',`tournament:${key}:${f.store.get(chat).tournament_state.token}${value?':'+value:''}`,'');
const send=(f,text)=>handleTournament(f.dialogue,chat,text,'','');
function wizard(f,n=4){handleTournament(f.dialogue,chat,'','','/tournament');send(f,String(n));action(f,'format','roundrobin');action(f,'courts','2');send(f,'20');send(f,'5');send(f,'14:00');}
test('team parser and tournament bounds reject duplicates, control characters and invalid numbers',()=>{
 assert.equal(parseTeams('1'),null);assert.equal(parseTeams('17'),null);assert.equal(parseTeams('Астана; астана'),null);assert.equal(parseTeams('Аста\tна; Шымкент'),null);assert.equal(parseTeams('Астана; Шымкент').length,2);assert.equal(parseTeams('16').length,16);
 for(const value of [{...config(),courts:5},{...config(),match_minutes:4},{...config(),break_minutes:31},{...config(),start:1440}])assert.equal(validTournament(value),false);
});
test('every supported round-robin draw meets once without team or court overlap',()=>{
 for(let n=2;n<=16;n++)for(let courts=1;courts<=4;courts++){
  const schedule=buildTournament(config(n,'roundrobin',courts));assert.equal(schedule.matches.length,n*(n-1)/2);const pairs=new Set();
  for(const m of schedule.matches){const key=[...m.teams].sort().join('|');assert.ok(!pairs.has(key));pairs.add(key);assert.ok(m.court<=courts);for(const other of schedule.matches){if(m.id>=other.id||m.end<=other.start||other.end<=m.start)continue;assert.notEqual(m.court,other.court);assert.ok(m.entrants.every(i=>!other.entrants.includes(i)));}}
 }
});
test('elimination draws have n-1 matches, explicit byes and valid prior-round dependencies',()=>{
 for(let n=2;n<=16;n++)for(let courts=1;courts<=4;courts++){
  const schedule=buildTournament(config(n,'knockout',courts));assert.equal(schedule.matches.length,n-1);
  for(const m of schedule.matches)for(const id of m.dependencies){const prior=schedule.matches.find(p=>p.id===id);assert.ok(prior);assert.ok(prior.end<=m.start);assert.ok(prior.round<m.round);}
  for(const m of schedule.matches)for(const other of schedule.matches){if(m.id>=other.id||m.end<=other.start||other.end<=m.start)continue;assert.notEqual(m.court,other.court);assert.ok(m.entrants.every(i=>!other.entrants.includes(i)));}
 }
 const draw=buildTournament(config(5,'knockout'));assert.equal(draw.byes.length,3);assert.match(renderTournament(draw),/жеңімпазы/);assert.doesNotMatch(renderTournament(draw),/1-орын: Команда/);
});
test('wizard previews, exports and saves a private tournament without changing the ready document',()=>{
 const f=fixture();f.store.put(chat,{step:'ready',format:'speech',language:'ru',result:'Алдыңғы мәтін'});wizard(f);assert.equal(f.store.get(chat).step,'tournament_preview');assert.match(last(f).text,/ТУРНИР КЕСТЕСІ/);assert.match(last(f).text,/шамамен/);assert.equal(f.store.get(chat).tournament,undefined);
 action(f,'export','pdf');const payload=JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='document'").payload);assert.equal(payload.format,'pdf');assert.match(payload.text,/Команда/);assert.equal(f.store.job(chat),null);
 const token=f.store.get(chat).tournament_state.token;handleTournament(f.dialogue,903,'',`tournament:export:${token}:pdf`,'');assert.equal(f.store.one("SELECT COUNT(*) AS n FROM outbox WHERE kind='document'").n,1);
 action(f,'save');assert.equal(f.store.get(chat).result,'Алдыңғы мәтін');assert.equal(f.store.get(chat).step,'ready');assert.ok(tournamentPrompt(f.store.get(chat)).includes('1-команда'));
});
test('scenario tournament apply requires preview, retains other blocks and aligns first match time',()=>{
 const f=fixture();const source={step:'ready',format:'script',language:'kk',result:'Дайын сценарий',brief:'Турнир',event_minutes:60,event_start:840,host_count:2,event_preset:'sport',program_blocks:[{id:'opening',titles:['Opening','Ашылу','Opening'],minutes:5},{id:'matches',titles:['Matches','Матчтар','Matches'],minutes:50},{id:'end',titles:['Closing','Жабылу','Closing'],minutes:5}]};f.store.put(chat,source);wizard(f,4);action(f,'apply_preview');assert.equal(f.store.get(chat).result,source.result);assert.equal(f.store.get(chat).event_minutes,60);assert.equal(f.store.job(chat),null);assert.match(last(f).text,/жаңа ұзақтығы/);action(f,'apply');const job=f.store.job(chat);assert.equal(job.session.result,source.result);assert.equal(job.session.program_blocks[0].id,'opening');assert.equal(job.session.program_blocks.at(-1).id,'end');assert.equal(job.session.tournament.start,845);assert.equal(job.session.program_blocks[1].minutes,70);assert.equal(job.session.event_minutes,80);
});
test('excessive tournament schedules remain downloadable but cannot silently replace an 8-hour program',()=>{
 const f=fixture();f.store.put(chat,{step:'ready',format:'script',result:'Түпнұсқа',event_minutes:60,event_preset:'sport',host_count:2});wizard(f,16);action(f,'apply_preview');assert.match(last(f).text,/сыймайды/);assert.equal(f.store.get(chat).event_minutes,60);assert.equal(f.store.job(chat),null);action(f,'export','docx');assert.equal(f.store.one("SELECT COUNT(*) AS n FROM outbox WHERE kind='document'").n,1);
});
test('tournament callbacks expire after a restarted wizard and cancel preserves earlier saved config',()=>{
 const f=fixture();f.store.put(chat,{step:'type',language:'kk',tournament:config(3)});wizard(f);const token=f.store.get(chat).tournament_state.token;action(f,'restart');handleTournament(f.dialogue,chat,'',`tournament:save:${token}`,'');assert.match(last(f).text,/ескірген/);action(f,'cancel');assert.equal(f.store.get(chat).tournament.teams.length,3);assert.equal(f.store.get(chat).step,'type');
});
test('midnight day offset is displayed for an applied first match on the next day',()=>{const value={...config(2),start:30,day_offset:1};assert.match(renderTournament(value),/00:30 \(\+1\)/);assert.equal(buildTournament(value).elapsed,20);});

test('model tournament facts stay compact for maximum team names without changing the stored draw',()=>{
 const value={...config(16),teams:Array.from({length:16},(_,i)=>String(i+1).padStart(2,'0')+' '+'Ә'.repeat(67)),courts:4,match_minutes:5,break_minutes:0};const original=structuredClone(value);
 const prompt=tournamentPrompt({tournament:value});assert.ok(prompt.length<3000,`compact facts should not repeat 120 fixtures: ${prompt.length}`);assert.deepEqual(value,original);assert.equal(buildTournament(value).matches.length,120);assert.match(prompt,/"match_count":120/);assert.match(prompt,/Толық матчтар кестесі/);
 for(const name of value.teams)assert.equal(prompt.split(name).length-1,1);
});

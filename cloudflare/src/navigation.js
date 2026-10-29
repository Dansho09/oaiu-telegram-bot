import { FORMATS, LANGUAGES } from './ui.js';
import { isScenario } from './scenario.js';

export const HOME_KEY = '🏠 Басты мәзір';
const b=(text,callback_data)=>({text,callback_data});
const home=[b(HOME_KEY,'nav:home')];
const rows=items=>Array.from({length:Math.ceil(items.length/2)},(_,i)=>items.slice(i*2,i*2+2));
const active=s=>s.step!=='type'||Boolean(s.result||s.brief||s.voice_request);
const show=(store,chat,text,buttons)=>store.send(chat,text,buttons,null,false);
function workVersion(store,chat,s){
 const text=JSON.stringify({...s,navigation_new:undefined})+'|'+(store.job(chat)?.id||'');
 let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
 return (hash>>>0).toString(16);
}

export function showHome(dialogue,chat,owner=false,installKeyboard=false){
 const store=dialogue.store,s=store.get(chat);
 if(!store.one('SELECT 1 FROM sessions WHERE chat_id=?',chat))store.put(chat,s);
 if(installKeyboard)store.effect(chat,'message',{chat_id:chat,text:'Сәлем! Мен OAIU көмекшісімін. Іс-шараға мәтін мен сценарий дайындауға көмектесемін. Төмендегі «Басты мәзір» батырмасы әрдайым қолжетімді.',reply_markup:{keyboard:[[{text:HOME_KEY}]],resize_keyboard:true,is_persistent:true}});
 const buttons=[
  [b('✍️ Мәтін дайындау','nav:create'),b('🎭 Сценарий жасау','nav:script')],
  [b('🎤 Дауыспен айту','nav:voice'),b('📂 Менің мәтіндерім','nav:history')],
  [b('📋 Іс-шараны ұйымдастыру','nav:organize'),b('❓ Көмек','nav:help')],
 ];
 if(active(s)||store.job(chat))buttons.unshift([b('▶️ Ағымдағы жұмысқа оралу','nav:current')]);
 if(owner)buttons.push([b('⚙️ Басқару панелім','admin:open')]);
 show(store,chat,'Не дайындаймыз?\n\n'+(active(s)||store.job(chat)?'Жалғастыру үшін «Ағымдағы жұмысқа оралу» таңдаңыз. Жаңа тапсырма үшін төмендегі батырмаларды қолданыңыз.':'Батырманы таңдаңыз немесе іс-шараны өз сөзіңізбен жазыңыз. Мысалы: «Ертең волейбол жарысына сценарий керек».')+'\n\nҚазақша дайындаймын. Мәзірді ашу ағымдағы жұмысыңызды өзгертпейді.',buttons);
}

export function showFormats(dialogue,chat){
 dialogue.store.send(chat,'Не дайындаймыз? Қажет мәтін түрін таңдаңыз.', [...rows(Object.entries(FORMATS).map(([key,label])=>b(label,`type:${key}`))),home]);
}

function startNew(dialogue,chat,format,confirmed=false){
 const store=dialogue.store,s=store.get(chat);
 if(!confirmed&&(active(s)||store.job(chat))){
  const nonce=crypto.randomUUID();store.put(chat,{...s,navigation_new:{nonce,format,version:workVersion(store,chat,s)}});
  show(store,chat,'Жаңа тапсырма бастаймыз ба? Ағымдағы баптау мен күтіп тұрған сұраныс тоқтатылады. Бұрын дайындалған мәтіндер «Менің мәтіндерім» бөлімінде қалады.',[[b('✅ Жаңа тапсырма бастау',`nav:confirm_new:${nonce}`)],[b('↩️ Ағымдағы жұмысқа оралу','nav:current')]]);return;
 }
 dialogue.menu(chat,false,format);
}

export function handleNavigation(dialogue,chat,callback,owner=false){
 if(!callback.startsWith('nav:'))return false;
 const store=dialogue.store,s=store.get(chat),[,page,token]=callback.split(':');
 if(page==='home'){showHome(dialogue,chat,owner);return true;}
 if(page==='create'||page==='script'){startNew(dialogue,chat,page==='script'?'script':null);return true;}
 if(page==='confirm_new'){
  if(!s.navigation_new||s.navigation_new.nonce!==token||s.navigation_new.version!==workVersion(store,chat,s)){show(store,chat,'Бұл таңдау ескірген. Басты мәзірден қайта таңдаңыз.',[home]);return true;}
  startNew(dialogue,chat,s.navigation_new.format,true);return true;
 }
 if(page==='current'){
  if(s.navigation_new){const next={...s};delete next.navigation_new;store.put(chat,next);}
  if(store.job(chat)){show(store,chat,'Мәтінді дайындап жатырмын. Дайын болғанда осында жіберемін.',[home]);return true;}
  if(s.step==='ready'&&s.result){store.send(chat,s.result,dialogue.resultButtons(s));return true;}
  const saved=store.one('SELECT value FROM navigation_views WHERE chat_id=?',chat);
  const view=saved?JSON.parse(saved.value):null;
  if(view&&view.step===s.step){show(store,chat,view.text,view.buttons?.length?view.buttons:[home]);return true;}
  if(s.step==='type'){showFormats(dialogue,chat);return true;}
  show(store,chat,'Ағымдағы тапсырма сақталған. Жоғарыдағы соңғы сұраққа жауап беріңіз немесе жаңа тапсырма бастаңыз.',[[b('➕ Жаңа тапсырма','nav:create')],home]);return true;
 }
 if(page==='help'){
  show(store,chat,'Қалай қолданамын?\n\n1. «Мәтін дайындау» не «Сценарий жасау» таңдаңыз.\n2. Батырмаларға жауап беріп, іс-шараны жазыңыз немесе дауыспен айтыңыз.\n3. Дайын мәтінді тексеріңіз. «Өзгерту» арқылы түзетіп, «Жүктеу» арқылы Word не PDF алыңыз.\n\nТүзетуді жай хабарламамен де жаза аласыз: «Қысқарт», «Ұстаздарға алғыс қос». Команда жаттау қажет емес.',[[b('🔐 Деректерім туралы','nav:privacy'),b('🗑 Деректерімді өшіру','nav:delete')],home]);return true;
 }
 if(page==='edit'){
  if(!s.result){show(store,chat,'Алдымен мәтін дайындаңыз. Дайын мәтіннің астынан өзгертуге болады.',[[b('✍️ Мәтін дайындау','nav:create')],home]);return true;}
  show(store,chat,'Мәтінде нені өзгертеміз?\n\nҚалауыңызды жай хабарламамен жазуға да болады.',[
   [b('✂️ Қысқарту','edit:short'),b('✨ Салтанатты ету','edit:formal')],
   [b('💐 Алғыс қосу','edit:thanks'),b('💬 Еркін стиль','edit:simple')],
   [b('✏️ Өз түзетуім','edit:custom'),b('🌐 Мәтін тілін өзгерту','nav:language')],
   [b('🔄 Басқа нұсқа','again:yes'),b('↩️ Мәтінге оралу','nav:current')],
  ]);return true;
 }
 if(page==='language'){
  show(store,chat,'Дайын мәтінді қай тілге аударамыз?', [...rows(Object.entries(LANGUAGES).map(([key,label])=>b(label,`translate:${key}`))),[b('⬅️ Өзгертуге оралу','nav:edit')]]);return true;
 }
 if(page==='event'||page==='organize'){
  show(store,chat,'Іс-шараны ұйымдастыру\n\nҚажет бөлімді таңдаңыз. Бағдарлама, сахна және дайындық үшін алдымен сценарий дайындаңыз.',[
   [b('📋 Бағдарлама мен сахна','nav:program'),b('👥 Қатысушылар','nav:people')],
   [b('🏆 Марапаттау','awards:open'),b('🏐 Жарыс кестесі','tournament:open')],
   [b('🎙 Іс-шараға дайындық','nav:live')],home,
  ]);return true;
 }
 if(page==='people'){
  show(store,chat,'Қатысушылар\n\nБасшылықты анықтамалықтан қосыңыз немесе қонақтардың қатысуын белгілеңіз.',[[b('🎓 Басшылық пен кафедралар','staff:open')],[b('👥 Қонақтардың қатысуы','guest:open')],[b('⬅️ Іс-шараға оралу','nav:organize')]]);return true;
 }
 if(page==='program'||page==='live'){
  if(!s.result||(page==='program'&&!isScenario(s))){show(store,chat,'Бұл бөлім дайын сценариймен жұмыс істейді. Алдымен сценарий дайындаңыз; марапаттау мен жарыс кестесін бөлек жасауға болады.',[[b('🎭 Сценарий жасау','nav:script')],[b('⬅️ Іс-шараға оралу','nav:organize')]]);return true;}
  const buttons=page==='program'?
   [[b('🧩 Бағдарлама құрастыру','program:open')],[b('⚙️ Уақыт, жүргізушілер, сахна','event:config')],...(s.format==='script'?[[b('👥 Командаға жеке парақтар','sheet:menu')]]:[])]:
   [[b('✅ Деректерді тексеру','check:open'),b('🔒 Өзгермейтін үзінділер','lock:open')],[b('🎙 Репетиция','rehearsal:open'),...(s.format==='script'?[b('🚨 Жедел өзгеріс','ops:open')]:[])]];
  show(store,chat,page==='program'?'Бағдарлама мен сахна\n\nҚай бөлігін баптаймыз?':'Іс-шараға дайындық\n\nДеректерді тексеріңіз, репетиция жасаңыз немесе жоспарды өзгертіңіз.',[...buttons,[b('⬅️ Іс-шараға оралу','nav:organize')]]);return true;
 }
 return true;
}

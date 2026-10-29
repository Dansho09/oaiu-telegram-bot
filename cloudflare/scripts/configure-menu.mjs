import { PUBLIC_COMMANDS } from '../src/admin.js';
import { readSecrets, checkedJson } from './private-config.mjs';

const [path]=process.argv.slice(2);
if(!path)throw new Error('Usage: node scripts/configure-menu.mjs PRIVATE_CONFIG');
const secrets=await readSecrets(path);
if(!secrets.TELEGRAM_BOT_TOKEN)throw new Error('Missing Telegram token');
const telegram=(method,payload={})=>checkedJson(`https://api.telegram.org/bot${secrets.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
if((await telegram('getMe')).result.username!=='OAIUHELPbot')throw new Error('Wrong bot; menu update stopped');
let verified=0;
for(const scope of [{type:'default'},{type:'all_private_chats'}]){
 for(const language_code of ['','kk','ru','en']){
  const selection={scope,...language_code?{language_code}:{}};
  await telegram('setMyCommands',{...selection,commands:PUBLIC_COMMANDS});
  const commands=(await telegram('getMyCommands',selection)).result;
  if(JSON.stringify(commands)!==JSON.stringify(PUBLIC_COMMANDS))throw new Error('Command menu verification failed');
  verified++;
 }
}
await telegram('setChatMenuButton',{menu_button:{type:'commands'}});
if((await telegram('getChatMenuButton')).result.type!=='commands')throw new Error('Chat menu verification failed');
console.log(JSON.stringify({bot:'OAIUHELPbot',public_commands:PUBLIC_COMMANDS.map(c=>c.command),verified_scopes:verified,menu_button:'commands'}));

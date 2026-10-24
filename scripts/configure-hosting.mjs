import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'vercel.json');
const config=JSON.parse(fs.readFileSync(file,'utf8'));
if(process.argv.includes('--check')) {
  if(config.rewrites[0].destination.includes('.invalid'))throw Error('Prima del deploy: npm run configure:hosting -- https://NOME-SERVIZIO.onrender.com');
  console.log('Destinazione Render configurata.');
}else{
  const value=process.argv[2];
  if(!value)throw Error('Uso: npm run configure:hosting -- https://NOME-SERVIZIO.onrender.com');
  const url=new URL(value);
  if(url.protocol!=='https:' || !/^[a-z0-9-]+\.onrender\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw Error('Inserisci soltanto l’origine HTTPS del servizio Render, senza percorsi o credenziali.');
  config.rewrites[0].destination=url.origin+'/api/:path*';
  fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
  console.log('Proxy Vercel configurato: '+url.origin);
}

import fs from 'node:fs/promises';
import path from 'node:path';

export function documentStorage(directory,env=process.env) {
 const remote=!!env.SUPABASE_URL;
 const bucket=env.SUPABASE_STORAGE_BUCKET||'logiflow-documents';
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY||'',Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY||''}`};
 const key=name=>{if(!/^[a-zA-Z0-9-]+\.pdf$/.test(name))throw Error('Nome documento non valido.');return name;};
 const endpoint=name=>`${env.SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${key(name)}`;
 const request=async(url,options={})=>{
  const response=await fetch(url,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Archivio documenti non disponibile (${response.status}).`);
  return response;
 };
 return {
  async verify(){
   if(!remote)return;
   const info=await (await request(`${env.SUPABASE_URL}/storage/v1/bucket/${encodeURIComponent(bucket)}`)).json();
   if(info.public!==false)throw Error('Il bucket Logiflow deve essere privato.');
  },
  async put(name,buffer){
   if(remote)await request(endpoint(name),{method:'POST',headers:{'Content-Type':'application/pdf'},body:buffer});
   else {await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,key(name)),buffer);}
  },
  async get(name){return remote?Buffer.from(await (await request(endpoint(name))).arrayBuffer()):fs.readFile(path.join(directory,key(name)));},
  async remove(name){
   if(remote)await request(`${env.SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[key(name)]})});
   else await fs.rm(path.join(directory,key(name)),{force:true});
  }
 };
}

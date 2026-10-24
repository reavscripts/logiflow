import {createClient} from '@libsql/client';
import {AsyncLocalStorage} from 'node:async_hooks';
import {pathToFileURL} from 'node:url';

// Each HTTP request owns its transaction; another request cannot commit it.
export function openDatabase(filename, env=process.env) {
 const client=createClient({url:env.TURSO_DATABASE_URL || pathToFileURL(filename).href,authToken:env.TURSO_AUTH_TOKEN,intMode:'number'});
 const contexts=new AsyncLocalStorage(), startup={transaction:null};
 const context=()=>contexts.getStore()||startup;
 const execute=async(sql,args=[])=>{
  const result=await (context().transaction||client).execute({sql,args});
  return result;
 };
 return {
  get isTransaction(){return !!context().transaction;},
  middleware(req,res,next){
   const state={transaction:null};
   res.on('finish',()=>{if(state.transaction){state.transaction.close();state.transaction=null;}});
   contexts.run(state,next);
  },
  prepare(sql){return {
   async all(...args){return (await execute(sql,args)).rows.map(r=>({...r}));},
   async get(...args){const row=(await execute(sql,args)).rows[0];return row?{...row}:undefined;},
   async run(...args){const r=await execute(sql,args);return {changes:r.rowsAffected,lastInsertRowid:r.lastInsertRowid};}
  };},
  async batch(statements){return (context().transaction||client).batch(statements);},
  async exec(sql){
   const command=sql.trim().toUpperCase();
   if(command==='BEGIN'){if(context().transaction)throw Error('Transaction already active');context().transaction=await client.transaction('write');return;}
   if(command==='COMMIT'||command==='ROLLBACK'){
    const tx=context().transaction;if(!tx)throw Error('No transaction');
    try{await (command==='COMMIT'?tx.commit():tx.rollback());}finally{tx.close();context().transaction=null;}return;
   }
   // Schema statements only: no user input is passed to executeMultiple.
   await (context().transaction||client).executeMultiple(sql.replace(/PRAGMA journal_mode=WAL;?/gi,''));
  },
  close(){client.close();}
 };
}

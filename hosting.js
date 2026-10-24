export function hostingConfig(env = process.env) {
  const origins = new Set((env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean).map(value=>{
    const url = new URL(value);
    if(url.origin!==value || !['https:','http:'].includes(url.protocol))throw Error('ALLOWED_ORIGINS deve contenere origini esatte senza percorsi o slash finale.');
    return url.origin;
  }));
  if(env.RENDER==='true') {
    if(!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Configura Turso e Supabase Storage: Render Free non conserva i dati locali.');
    if(!/^libsql:\/\//.test(env.TURSO_DATABASE_URL))throw Error('Su Render usa il database remoto Turso (libsql://).');
    if(new URL(env.SUPABASE_URL).protocol!=='https:')throw Error('Supabase richiede HTTPS.');
    if(!origins.size)throw Error('Imposta ALLOWED_ORIGINS con il dominio Vercel autorizzato.');
    if(env.COOKIE_SECURE!=='true')throw Error('Imposta COOKIE_SECURE=true su Render.');
  }
  return {origins, trustProxy:env.TRUST_PROXY==='1', backendOnly:env.BACKEND_ONLY==='true'};
}

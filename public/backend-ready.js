/* Start before React downloads. Only readiness probes are retried, never writes. */
(() => {
  let pending = null, checkedAt = 0, state = 'connecting';
  const announce = next => { state = next; window.dispatchEvent(new Event('backend-state')); };
  function ensureReady() {
    if (checkedAt && Date.now() - checkedAt < 30000) return Promise.resolve();
    if (pending) return pending;
    announce('connecting');
    pending = (async () => {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(20000, deadline - Date.now()));
        try {
          const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
          const data = response.ok ? await response.json() : null;
          if (data?.ok === true && data?.db === true) {
            checkedAt = Date.now(); announce('ready'); return;
          }
        } catch { /* Render can return HTML or a gateway error during startup. */ }
        finally { clearTimeout(timer); }
        if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 3000));
      }
      announce('offline');
      throw Error('Il server non è ancora disponibile. Attendi qualche istante e riprova.');
    })().finally(() => { pending = null; });
    return pending;
  }
  window.logiflowBackend = { ensureReady, getState: () => state, invalidate: () => { checkedAt = 0; } };
  ensureReady().catch(() => {});
  window.addEventListener('focus', () => ensureReady().catch(() => {}));
})();

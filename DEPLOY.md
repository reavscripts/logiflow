# Logiflow: Render Free + Vercel

Versione senza funzionalità a pagamento: Render Free per API, Vercel per frontend, Turso Free per database e Supabase Storage Free per PDF. Il filesystem temporaneo Render non contiene dati definitivi. In locale, senza configurazione cloud, si usano SQLite e uploads in `data`.

**Vincolo del piano Vercel:** Hobby è riservato all'uso personale non commerciale. Per un gestionale aziendale non è possibile garantire che Vercel Hobby sia consentito. Il codice non richiede feature a pagamento, ma questa restrizione resta: per uso aziendale a costo zero occorre un hosting frontend che lo consenta. [Regole Vercel](https://vercel.com/docs/limits/fair-use-guidelines).

## Risveglio del backend

La richiesta `/api/health` parte dall'HTML prima di React e verifica anche il database. Riprende il meccanismo di viscitotraslochi: timeout di 20 secondi per tentativo, pausa di 3 secondi, limite totale circa 2 minuti. Le richieste dell'interfaccia condividono il controllo. Dopo 30 secondi il prossimo accesso controlla nuovamente; tornare alla finestra anticipa la verifica. Compare uno stato di connessione e, se necessario, un pulsante Riprova.

Solo i controlli sono ripetuti: uscite, caricamenti e salvataggi non vengono reinviati automaticamente. Non ci sono cron a pagamento o ping continui. Le migrazioni all'avvio usano query aggregate per non rileggere ogni vecchia uscita singolarmente.

Render Free si sospende dopo 15 minuti di inattività e può richiedere circa un minuto per ripartire. Il codice anticipa l'attesa, non elimina il tempo della piattaforma. [Limiti Render](https://render.com/docs/free).

## 1. Account e archivi gratuiti

1. Creare un database **Turso Free**, preferibilmente in Europa. Copiare URL `libsql://...` e token privato. Usare un database dedicato a Logiflow.
2. Creare un progetto **Supabase Free** e un bucket **privato** `logiflow-documents`, con limite file almeno 20 MB e tipo consentito `application/pdf`. Copiare URL progetto e chiave backend `service_role`. Non aggiungere policy pubbliche. Il server verifica che il bucket sia privato.
3. Pubblicare direttamente questa cartella di progetto in un repository GitHub privato, senza ZIP o sottocartelle di rilascio. `package.json`, `render.yaml` e `vercel.json` sono già nella radice. `.gitignore` esclude dati, password, dipendenze, build e file temporanei. Non caricare documenti reali.
4. Importare il repository in Vercel e annotare il dominio stabile. Framework Vite, Node 24.x, build `npm run build:vercel`, output `dist`. La prima build è bloccata finché non si configura l'URL Render.

Fonti: [Turso Free](https://turso.tech/pricing), [creazione bucket](https://supabase.com/docs/guides/storage/quickstart).

## 2. Render Free

Usare **New → Blueprint**, collegare il repository e selezionare `render.yaml`. Il file usa `plan: free`, una sola istanza, Frankfurt, Node 24 e nessun disco. Non selezionare upgrade o risorse a pagamento.

Impostare soltanto su Render:

| Variabile | Valore |
| --- | --- |
| TURSO_DATABASE_URL | URL libsql:// del database |
| TURSO_AUTH_TOKEN | Token privato Turso |
| SUPABASE_URL | https://ID-PROGETTO.supabase.co senza slash finale |
| SUPABASE_SERVICE_ROLE_KEY | Chiave privata backend Supabase |
| SUPABASE_STORAGE_BUCKET | logiflow-documents |
| ADMIN_PASSWORD | Password iniziale unica, almeno 16 caratteri |
| ALLOWED_ORIGINS | https://NOME-PROGETTO.vercel.app senza slash finale |

Il Blueprint configura già HOST=0.0.0.0, BACKEND_ONLY=true, TRUST_PROXY=1, COOKIE_SECURE=true. La porta arriva da Render. Health check `/api/health`. L'avvio viene fermato se mancano database o archivio remoto, per evitare di perdere dati sul disco effimero.

Utente: `operatore`. ADMIN_PASSWORD inizializza solo un database nuovo: cambiarla successivamente non cambia la password salvata. Token Turso e chiave Supabase non devono mai finire in Git, in Vercel, nel browser o in variabili VITE_*.

## 3. Collegamento frontend

Quando Render assegna l'URL reale, nella cartella del progetto eseguire:

```powershell
npm run configure:hosting -- https://NOME-REALE.onrender.com
```

Commit e push del vercel.json aggiornato, quindi ridistribuire Vercel. Non usare il backend di viscitotraslochi. Il proxy inoltra `/api/*`, inclusi PDF, mantenendo i cookie sotto il dominio frontend. Non si usano Functions Vercel per trasferire file. La cache API è disabilitata. [Rewrite Vercel](https://vercel.com/docs/routing/rewrites).

Aggiungere eventuali domini personalizzati ad ALLOWED_ORIGINS separati da virgole. Autorizzare solo origini esatte; nessun wildcard per tutte le preview.

## Limiti gratuiti

- Render ha limiti di ore, memoria e traffico. Per OCR usare scansioni leggere: PDF pesanti possono superare la memoria disponibile.
- Turso Free ha quote di spazio e operazioni: controllarle dal dashboard. Nessun upgrade automatico è configurato dal programma.
- Supabase Storage Free include 1 GB e quote di traffico. Dopo scarsa attività il progetto può essere sospeso: serve riattivarlo dal dashboard, il ping del frontend non lo ripristina. [Quote](https://supabase.com/docs/guides/storage/pricing), [sospensione](https://supabase.com/docs/guides/platform/free-project-pausing).
- Il proxy Vercel scade dopo 120 secondi; l'OCR si interrompe entro 100 secondi. Upload lenti possono fallire. Se si perde la risposta dopo un salvataggio, verificare l'elenco prima di riprovare. [Timeout](https://vercel.com/docs/errors/router_external_target_error).
- Sessioni e PDF temporanei da riconoscere vengono persi al riavvio: effettuare un nuovo accesso o ricaricare il PDF non salvato. Gli archivi definitivi restano remoti.

## Verifica online

1. Aprire `/api/health` sul dominio Render e su Vercel: entrambi devono rispondere con JSON `{"ok":true,"db":true}`.
2. Accedere, creare un'operazione, caricare/scaricare PDF, generare A77 e verificare ricerca pubblica e uscite.
3. Riavviare Render, accedere nuovamente e verificare che i dati e i documenti siano rimasti.
4. Provare PDF reali e monitorare le quote. I test locali non certificano le prestazioni dei propri account cloud.

## Dati e backup

La prima installazione online parte con un archivio vuoto. Per trasferire dati locali occorre importare SQLite in Turso e caricare `uploads` nel bucket privato mantenendo i nomi dei file. Fermare il server locale durante l'esportazione; usare un database cloud nuovo prima del primo avvio. L'importazione conserva l'hash della password locale. Questa consegna non invia dati reali né esegue importazioni.

Non pubblicare `data`, `.env` o documenti su GitHub/Vercel. Conservare esportazioni private periodiche del database e copie dei PDF e verificarne il ripristino. I backup Free non equivalgono a continuità aziendale garantita.

## Comandi locali

```powershell
npm ci
npm test
npm run build
npm run dev
```

Richiesto Node 24. `.env.example` è un promemoria: le variabili sono impostate dal processo/dashboard, non caricate automaticamente da .env. Per aggiornare la versione online modificare questa cartella ed eseguire commit e push sul repository collegato a Render e Vercel.

Restano l'account operatore unico e le dichiarazioni pubbliche delle uscite; non sono introdotti verifica dell'identità degli addetti o rettifiche delle uscite.

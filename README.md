# Logiflow

Gestionale per fascicoli portuali: ricerca pubblica per contenitore, clienti, PDF e posizione dei documenti stampati in cassetta.

## Avvio locale

Richiede Node.js 24 o successivo.

```powershell
npm install
npm run dev
```

Aprire http://localhost:3000. Al primo avvio vengono generati l'utente `operatore` e una password casuale, salvata nel file locale `data/accesso-operatore.txt`. In alternativa impostare `ADMIN_PASSWORD` prima del primo avvio. La password viene conservata nel database come hash scrypt; modificare la variabile dopo il primo avvio non cambia le credenziali già create.

## Utilizzo

1. Accedere all'area operatore e premere **Nuovo**.
2. Selezionare o trascinare un PDF (massimo 20 MB, 20 pagine). Il sistema legge il testo e usa OCR locale sulle pagine senza un numero riconosciuto.
3. Verificare il numero proposto, verificare l’intero elenco dei risultati e aggiungere o correggere manualmente i contenitori se necessario; selezionare il cliente.
4. Indicare cassetta, fascicolo cartaceo e separatore e selezionare **Operazione depositata in cassetta** solo dopo il deposito fisico.
5. Salvare: operazione e PDF di origine vengono registrati insieme. Altri PDF possono essere aggiunti in seguito (15 file per caricamento, 20 MB ciascuno).
6. Il trasportatore cerca il numero completo nella pagina pubblica e vede lo stato e la posizione di ritiro.

Il riconoscimento usa PDF.js e Tesseract con dati linguistici installati localmente: i PDF non vengono inviati a servizi esterni. L'analisi è limitata a una richiesta contemporanea e 100 secondi. Il PDF analizzato resta temporaneamente in memoria per 30 minuti, legato alla sessione operatore, e viene salvato soltanto alla conferma. Un nuovo caricamento nella stessa sessione sostituisce il precedente. Numeri ambigui o non rilevati richiedono la scelta/correzione dell'operatore; non si presume l'esattezza dell'OCR.

Sono precaricati i clienti VITALE e RV TRUCK. L'area Clienti permette di aggiungerne altri. Non sono presenti fascicoli dimostrativi.

L'interfaccia chiama i fascicoli digitali **Operazioni**. Ogni cliente ha una posizione della cassetta configurabile dalla scheda cliente o dal riepilogo **Cassette clienti**. Le posizioni iniziali sono vuote e devono essere impostate con i riferimenti reali. La cassetta viene associata automaticamente alle nuove operazioni; fascicolo cartaceo e separatore restano specifici dell'operazione. I depositi già confermati mantengono la posizione registrata, anche se cambia la configurazione del cliente. Per registrare uno spostamento reale, rimuovere il deposito, salvare e confermarlo nuovamente con la nuova posizione. Il riepilogo conta tutte le operazioni depositate per cliente, anche quelle ancora nella precedente posizione: la tabella riporta la posizione effettivamente registrata di ogni operazione. La migrazione del database aggiunge la configurazione senza alterare i depositi esistenti.

Il caricamento di un PDF non equivale al deposito. La conferma del deposito è dell’operatore. Non viene più richiesta né esposta una conferma di svincolo; non è presente un collegamento ai sistemi doganali. La posizione è esposta al pubblico soltanto dopo la conferma del deposito. Note, clienti e PDF sono riservati all'operatore. Il formato contenitore accetta 4 lettere e 7 cifre; non verifica il check digit ISO 6346.

## Camion usciti e bolle trattenute

Dalla ricerca contenitore, il trasportatore o l’addetto può registrare l’uscita effettiva indicando targa, nominativo e conferma esplicita. La data/ora è registrata dal server e visualizzata nel fuso italiano. La registrazione è disponibile per bolle in cassetta e non può essere duplicata. È una dichiarazione pubblica di chi compila: il nominativo non è autenticato. Targhe e nominativi sono visibili solo nel registro **Camion usciti** dell’operatore; la ricerca pubblica espone stato e conteggi, senza i codici degli altri contenitori.

La bolla viene riconosciuta come singola o multicontenitore dall’elenco collegato all’operazione. L’uscita dell’unico contenitore o dell’ultimo contenitore registra automaticamente la trattenuta GdF e rimuove la disponibilità in cassetta, nella stessa transazione. Nessuna seconda conferma è richiesta. Nelle uscite parziali la bolla è indicata come riconsegnata al trasportatore/addetto per consentire le uscite successive; restano visibili conteggio e contenitori già usciti. Al riavvio vengono riallineate anche le bolle già complete, usando la data dell’ultima uscita e preservando le trattenute già registrate. Con uscite presenti non si possono cambiare cliente o elenco contenitori; una bolla trattenuta non può essere rimessa in cassetta dalla normale modifica. La versione corrente non include rettifiche delle dichiarazioni di uscita.

## Fuori orario

Nell’area operatore, **FUORI ORARIO** permette di cercare e selezionare singoli contenitori, anche da operazioni differenti. I contenitori già usciti sono esclusi singolarmente, anche dalle bolle multiple. La lista si aggiorna ogni 15 secondi e al ritorno sulla finestra, rimuovendo dalla selezione i contenitori usciti nel frattempo. Il server verifica nuovamente le uscite prima e dopo la generazione del PDF; l’archivio storico resta invariato. I filtri mantengono la selezione; si possono selezionare tutti i risultati o svuotare la lista. La fascia predefinita è 18:00–21:00, modificabile dalle 18:00 fino alle 23:59 dello stesso giorno. Massimo 200 contenitori per lista.

**Genera A77 + elenco** salva un PDF unico: le due pagine del modello fornito, con entrambe le date e gli orari aggiornati, seguite dall’elenco numerato (28 contenitori per pagina). La data viene determinata dal server nel fuso Europe/Rome al momento della generazione. Il modello mantiene l’intestazione VITALE S.R.L., P.IVA IT04600780656, e il testo originale USCITA ED ENTRATA CONTENITORI. Le due pagine originali sono conservate come sfondi a 150 dpi. Firma e visto sono da acquisire in dogana; il software non registra un’approvazione doganale automatica.

Le liste generate e i relativi PDF sono archiviati nel database e accessibili solo all’operatore. I download successivi conservano data, fascia e selezione originarie anche se le operazioni vengono modificate. Per una nuova presentazione, generare una nuova lista. Sono ammesse più liste nello stesso giorno: ciascuna è un documento autonomo, non sostituisce automaticamente le precedenti.

## Dati e distribuzione

Database SQLite in `data/logiflow.sqlite`, PDF in `data/uploads/`. Eseguire copie di sicurezza dell'intera cartella `data` a server arrestato. Non cancellare questa cartella per aggiornare l'applicazione.

```powershell
npm run build
npm start
```

Il server ascolta solo sulla macchina locale. Le variabili `HOST`, `PORT`, `DATA_DIR` consentono di configurarlo. Per la pubblicazione usare HTTPS e impostare `COOKIE_SECURE=true`; il proxy deve preservare l'origine delle richieste. I cookie di sessione durano 8 ore e le sessioni decadono al riavvio. Questa prima versione utilizza un unico account operatore: account nominativi, audit delle modifiche, recupero password, antivirus dei PDF e politiche di conservazione sono estensioni da completare prima di un impiego aziendale su larga scala. I PDF sono verificati per estensione e firma iniziale, non analizzati per contenuti malevoli.

Frontend React con Vite; backend Express con SQLite tramite libSQL (locale o Turso). Nessun servizio esterno richiesto per i dati. I font Google hanno un fallback locale sans-serif.

## Verifica

```powershell
npm test
npm run build
```

Il test usa un database temporaneo e verifica accessi, clienti, creazione fascicolo, vincoli del deposito, caricamento e download PDF, ricerca pubblica e logout.

## Bolle con più contenitori e A88

Una operazione può contenere fino a 200 codici, tutti ricercabili nella pagina pubblica e nella lista operatore. Gli archivi esistenti vengono migrati automaticamente mantenendo documenti e posizioni. Ogni codice appartiene a una sola operazione.

Per più contenitori viene richiesto un A88 prima della conferma del deposito. Salvare prima l’operazione senza deposito, quindi usare **Carica A88 esistente** o **Genera A88**. Il caricamento verifica tramite lettura PDF/OCR che tutti i codici siano presenti; non certifica autenticità o compilazione del documento. Il PDF generato usa l’intestazione del modello fornito e una tabella con numero progressivo, contenitore, data uscita e firma (18 righe per pagina). I campi amministrativi non disponibili rimangono vuoti; è possibile indicare il riferimento bolla/svincolo. Le firme e le date di uscita si compilano al controllo sul modulo stampato.

Lo stato A88 si riferisce all’elenco esatto salvato. Se questo cambia, i vecchi moduli restano disponibili con indicazione Elenco precedente e il deposito richiede un modulo aggiornato. La ricerca pubblica non espone i codici degli altri contenitori della stessa bolla.

Il lettore include ora i decoder locali JBIG2 per le scansioni compresse. Tra letture OCR che differiscono di una lettera del prefisso e condividono tutte le cifre, preferisce quella coerente con la cifra di controllo ISO 6346. La verifica umana dei codici rimane richiesta.

## Versione online Render + Vercel

Questa cartella è la radice del progetto da pubblicare su GitHub e collegare a Render e Vercel. Non occorre creare o estrarre ZIP. `.gitignore` esclude dati locali, credenziali, dipendenze, build, vecchi rilasci e temporanei; questi file restano disponibili sul computer.

Configurazione, risveglio anticipato e pubblicazione descritti in [DEPLOY.md](DEPLOY.md). Dopo aver creato un repository GitHub privato vuoto, collegarlo a questa cartella, creare il primo commit e pubblicare il ramo `main`. L'URL reale di Render va inserito con `npm run configure:hosting -- https://NOME-REALE.onrender.com` prima della build Vercel.

La variante gratuita online usa Render Free senza disco, Turso Free per il database e Supabase Storage Free per i PDF. Leggere DEPLOY.md per quote, credenziali e restrizione non commerciale di Vercel Hobby.

### Operazioni comunitarie

Durante l’importazione del PDF, LogiFlow cerca T2L/T2LF e indicazioni esplicite come «merce CEE» anche nel testo ottenuto dalle scansioni. Se rilevate, propone la spunta **COMUNITARIO**, correggibile prima del salvataggio e nelle operazioni esistenti. Il caricamento con riconoscimento saltato richiede la scelta manuale. Non si deduce lo stato dai soli paesi o clienti; i documenti già archiviati non vengono riclassificati automaticamente.

Tutti i contenitori delle operazioni comunitarie sono esclusi dalla selezione, dal conteggio e dai nuovi PDF fuori orario. Il server verifica lo stato anche alla generazione, mentre le liste storiche restano invariate.

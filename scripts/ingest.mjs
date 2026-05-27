import { ingestAllSources } from '/app/src/services/knowledgeBase.js';
ingestAllSources().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e.message));

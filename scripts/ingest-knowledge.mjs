import { ingestAllSources } from '/app/src/services/knowledgeBase.ts';

(async () => {
  try {
    const result = await ingestAllSources();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Ingestion failed:', err.message);
    process.exit(1);
  }
})();

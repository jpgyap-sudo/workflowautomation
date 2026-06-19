/**
 * CentralBrain Import Script
 *
 * Parses memory/lessons-learned.md and imports all lessons into the
 * brain_lessons PostgreSQL table via the API's POST /brain endpoint.
 *
 * Usage:
 *   node scripts/import-brain-lessons.mjs [--api-url http://localhost:8080] [--file memory/lessons-learned.md]
 *
 * The script:
 * 1. Reads the lessons-learned markdown file
 * 2. Parses each lesson entry (separated by ---)
 * 3. Extracts title, summary, content, tags, source, source_ref, related_files
 * 4. POSTs each lesson to /brain (which auto-generates embeddings)
 * 5. Skips duplicates (matched by title)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Parse CLI args
const args = process.argv.slice(2);
const API_URL = args.find((a) => a.startsWith('--api-url='))?.split('=')[1] ?? 'http://localhost:8080';
const FILE_PATH = args.find((a) => a.startsWith('--file='))?.split('=')[1] ?? resolve(ROOT, 'memory/lessons-learned.md');

// Parse a single lesson block
function parseLessonBlock(block) {
  const lines = block.trim().split('\n');
  const lesson = {
    title: '',
    summary: '',
    content: '',
    tags: [],
    agent: 'superroo',
    source: 'manual',
    source_ref: null,
    related_files: [],
    confidence: 'medium',
  };

  let section = 'header';

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect lesson title
    if (trimmed.startsWith('### Lesson:')) {
      lesson.title = trimmed.replace(/^###\s*Lesson:\s*/, '').trim();
      section = 'summary';
      continue;
    }
    if (trimmed.startsWith('### Lesson ')) {
      lesson.title = trimmed.replace(/^###\s*Lesson\s*/, '').trim();
      section = 'summary';
      continue;
    }

    // Detect section headers
    if (trimmed.startsWith('**Summary:**') || trimmed.startsWith('**Task Summary**') || trimmed === '#### Task Summary') {
      section = 'summary';
      continue;
    }
    if (trimmed.startsWith('**Key changes:**') || trimmed.startsWith('**Key Changes:**')) {
      section = 'key_changes';
      continue;
    }
    if (trimmed.startsWith('**Reusable takeaway:**') || trimmed.startsWith('**Reusable Takeaway:**')) {
      section = 'takeaway';
      continue;
    }
    if (trimmed.startsWith('#### Tags') || trimmed.startsWith('**Tags:**') || trimmed.startsWith('**Tags**')) {
      section = 'tags';
      continue;
    }
    if (trimmed.startsWith('**What was fixed:**') || trimmed === '**What was fixed:**') {
      section = 'fix';
      continue;
    }
    if (trimmed.startsWith('**Why it broke:**') || trimmed === '**Why it broke:**') {
      section = 'cause';
      continue;
    }
    if (trimmed.startsWith('**Commit:**')) {
      lesson.source_ref = trimmed.replace(/^\*\*Commit:\*\*\s*/, '').trim();
      lesson.source = 'commit';
      continue;
    }
    if (trimmed.startsWith('**Date:**') || trimmed.startsWith('Date:')) {
      // Extract date
      continue;
    }
    if (trimmed.startsWith('**Related files:**') || trimmed.startsWith('Related files:')) {
      const files = trimmed.replace(/^\*{0,2}Related files:\*{0,2}\s*/, '').trim();
      if (files && files !== '-') {
        lesson.related_files = files.split(',').map((f) => f.trim()).filter(Boolean);
      }
      continue;
    }
    if (trimmed.startsWith('**Model/API used:**')) {
      continue;
    }
    if (trimmed.startsWith('**Confidence:**') || trimmed.startsWith('Confidence:')) {
      const conf = trimmed.replace(/^\*{0,2}Confidence:\*{0,2}\s*/, '').trim().toLowerCase();
      if (['high', 'medium', 'low'].includes(conf)) lesson.confidence = conf;
      continue;
    }
    if (trimmed.startsWith('Source:')) {
      const src = trimmed.replace(/^Source:\s*/, '').trim().toLowerCase();
      if (src.includes('superroo')) lesson.agent = 'superroo';
      else if (src.includes('claude')) lesson.agent = 'claude';
      else if (src.includes('codex')) lesson.agent = 'codex';
      else if (src.includes('kimi')) lesson.agent = 'kimi';
      continue;
    }

    // Tags line — comma or space separated
    if (section === 'tags') {
      const tagCandidates = trimmed
        .replace(/^Tags:\s*/i, '')
        .replace(/^\*{0,2}/, '')
        .replace(/\*{0,2}$/, '')
        .split(/[,;]/)
        .map((t) => t.trim().replace(/^`|`$/g, ''))
        .filter(Boolean);
      if (tagCandidates.length > 0) {
        lesson.tags.push(...tagCandidates);
      }
      // Tags section ends at next blank line or separator
      if (!trimmed && tagCandidates.length === 0) section = 'header';
      continue;
    }

    // Collect content per section
    if (section === 'summary' && trimmed) {
      lesson.summary += (lesson.summary ? ' ' : '') + trimmed.replace(/^\*\*/, '').replace(/\*\*$/, '');
    }
    if (section === 'takeaway' && trimmed) {
      lesson.content += (lesson.content ? '\n' : '') + trimmed;
    }
    if (section === 'fix' && trimmed && !trimmed.includes('What was fixed')) {
      lesson.content += (lesson.content ? '\n' : '') + `**Fix:** ${trimmed}`;
    }
    if (section === 'cause' && trimmed) {
      lesson.content += (lesson.content ? '\n' : '') + `**Root Cause:** ${trimmed}`;
    }
    // Collect raw content for anything not matched (fallback)
    if (section === 'header' && trimmed && !trimmed.startsWith('---') && !trimmed.startsWith('#')) {
      lesson.content += (lesson.content ? '\n' : '') + trimmed;
    }
  }

  // If no content was captured in specific sections, use summary as content
  if (!lesson.content && lesson.summary) {
    lesson.content = lesson.summary;
  }

  // Deduplicate tags
  lesson.tags = [...new Set(lesson.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, '')))];

  return lesson;
}

async function main() {
  console.log(`🧠 CentralBrain Import Script\n`);
  console.log(`  API:  ${API_URL}`);
  console.log(`  File: ${FILE_PATH}\n`);

  if (!existsSync(FILE_PATH)) {
    console.error(`❌ File not found: ${FILE_PATH}`);
    process.exit(1);
  }

  const md = readFileSync(FILE_PATH, 'utf-8');
  const blocks = md.split(/\n---\n/);

  console.log(`  Found ${blocks.length} potential lesson blocks\n`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const block of blocks) {
    const lesson = parseLessonBlock(block);

    if (!lesson.title && !lesson.content) {
      skipped++;
      continue;
    }

    if (!lesson.title) {
      lesson.title = (lesson.summary || lesson.content).substring(0, 80);
    }

    // Skip entries that are clearly not lessons
    if (lesson.title.length < 5 && !lesson.content) {
      skipped++;
      continue;
    }

    try {
      // Check if lesson already exists (by title)
      const checkRes = await fetch(
        `${API_URL}/brain/search?q=${encodeURIComponent(lesson.title)}&limit=1`
      );

      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.lessons?.length > 0) {
          const existing = checkData.lessons[0];
          const titleSim = existing.title.toLowerCase() === lesson.title.toLowerCase();
          if (titleSim) {
            console.log(`  ⏭️  Skipped (exists): ${lesson.title.substring(0, 60)}`);
            skipped++;
            continue;
          }
        }
      }

      // Import
      const res = await fetch(`${API_URL}/brain`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: lesson.title.substring(0, 500),
          content: lesson.content.substring(0, 10000),
          summary: lesson.summary ? lesson.summary.substring(0, 500) : undefined,
          tags: lesson.tags,
          agent: lesson.agent,
          confidence: lesson.confidence,
          source: lesson.source,
          source_ref: lesson.source_ref ?? undefined,
          related_files: lesson.related_files,
          metadata: lesson.source_ref ? { commit: lesson.source_ref } : undefined,
        }),
      });

      if (res.ok) {
        console.log(`  ✅ Imported: ${lesson.title.substring(0, 70)}`);
        imported++;
      } else {
        const errBody = await res.text();
        console.error(`  ❌ Failed (${res.status}): ${lesson.title.substring(0, 50)} — ${errBody.substring(0, 100)}`);
        errors++;
      }
    } catch (err) {
      console.error(`  ❌ Error: ${lesson.title.substring(0, 50)} — ${err.message}`);
      errors++;
    }
  }

  console.log(`\n─── Summary ───`);
  console.log(`  ✅ Imported: ${imported}`);
  console.log(`  ⏭️  Skipped:  ${skipped}`);
  console.log(`  ❌ Errors:   ${errors}`);
  console.log(`  📊 Total:    ${imported + skipped + errors}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

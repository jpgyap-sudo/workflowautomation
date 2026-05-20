#!/usr/bin/env node
/**
 * Query the shared-context.json file for project information.
 * Usage:
 *   node scripts/query-context.mjs                    # Show full context
 *   node scripts/query-context.mjs --key project      # Show a specific top-level key
 *   node scripts/query-context.mjs --key activity_log --last 5   # Last 5 activity entries
 *   node scripts/query-context.mjs --key lessons --last 3        # Last 3 lessons
 *   node scripts/query-context.mjs --search "deploy"             # Search all text
 *   node scripts/query-context.mjs --key project --path tech_stack  # Nested path
 *   node scripts/query-context.mjs --add-log                      # Interactive: add activity log entry
 *   node scripts/query-context.mjs --add-lesson                   # Interactive: add lesson entry
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTEXT_PATH = resolve(__dirname, '..', 'shared-context.json');

function loadContext() {
  if (!existsSync(CONTEXT_PATH)) {
    console.error('ERROR: shared-context.json not found at', CONTEXT_PATH);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONTEXT_PATH, 'utf-8'));
}

function saveContext(ctx) {
  ctx.last_updated = new Date().toISOString();
  writeFileSync(CONTEXT_PATH, JSON.stringify(ctx, null, 2), 'utf-8');
  console.log('✅ shared-context.json updated');
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) return acc[key];
    return undefined;
  }, obj);
}

function searchText(obj, term, path = '') {
  const results = [];
  const lowerTerm = term.toLowerCase();
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (typeof value === 'string' && value.toLowerCase().includes(lowerTerm)) {
      results.push({ path: currentPath, value });
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const itemStr = JSON.stringify(item).toLowerCase();
        if (itemStr.includes(lowerTerm)) {
          results.push({ path: `${currentPath}[${i}]`, value: item });
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      results.push(...searchText(value, term, currentPath));
    }
  }
  return results;
}

function printSection(label, data) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
}

// --- CLI ---
const args = process.argv.slice(2);
const ctx = loadContext();

if (args.length === 0) {
  // Full context
  console.log(JSON.stringify(ctx, null, 2));
  process.exit(0);
}

const keyIndex = args.indexOf('--key');
const searchIndex = args.indexOf('--search');
const lastIndex = args.indexOf('--last');
const pathIndex = args.indexOf('--path');
const addLog = args.includes('--add-log');
const addLesson = args.includes('--add-lesson');

if (keyIndex !== -1 && args[keyIndex + 1]) {
  const key = args[keyIndex + 1];
  let data = ctx[key];
  if (pathIndex !== -1 && args[pathIndex + 1]) {
    data = getNestedValue(data, args[pathIndex + 1]);
  }
  if (data === undefined) {
    console.error(`Key "${key}" not found in shared-context.json`);
    process.exit(1);
  }
  if (lastIndex !== -1 && args[lastIndex + 1] && Array.isArray(data)) {
    const count = parseInt(args[lastIndex + 1], 10);
    data = data.slice(-count);
  }
  printSection(key, data);
}

if (searchIndex !== -1 && args[searchIndex + 1]) {
  const term = args[searchIndex + 1];
  const results = searchText(ctx, term);
  if (results.length === 0) {
    console.log(`No results found for "${term}"`);
  } else {
    printSection(`Search results for "${term}"`, results);
  }
}

if (addLog) {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const ask = (q) => new Promise((r) => rl.question(q, r));
  
  const agent = await ask('Agent name (e.g. SuperRoo, Claude Code): ');
  const action = await ask('Action performed: ');
  const files = await ask('Files changed (comma-separated): ');
  const commit = await ask('Commit SHA (optional): ');
  
  ctx.activity_log.push({
    timestamp: new Date().toISOString(),
    agent: agent || 'unknown',
    action: action || 'No description',
    files_changed: files ? files.split(',').map(f => f.trim()) : [],
    commit: commit || null,
    deployed: false
  });
  
  saveContext(ctx);
  rl.close();
}

if (addLesson) {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const ask = (q) => new Promise((r) => rl.question(q, r));
  
  const agent = await ask('Agent name: ');
  const lesson = await ask('Lesson learned: ');
  
  ctx.lessons.push({
    timestamp: new Date().toISOString(),
    agent: agent || 'unknown',
    lesson: lesson || 'No lesson recorded',
    see_also: 'memory/lessons-learned.md'
  });
  
  saveContext(ctx);
  rl.close();
}

if (!keyIndex && !searchIndex && !addLog && !addLesson) {
  console.log('Usage: node scripts/query-context.mjs [options]');
  console.log('  (no args)       Show full context');
  console.log('  --key <key>     Show a top-level key (project, current_state, activity_log, lessons, known_issues)');
  console.log('  --path <path>   Nested path within key (e.g. tech_stack, vps.public_ip)');
  console.log('  --last <n>      Show last N items (for arrays)');
  console.log('  --search <term> Search all text');
  console.log('  --add-log       Add an activity log entry (interactive)');
  console.log('  --add-lesson    Add a lesson entry (interactive)');
}

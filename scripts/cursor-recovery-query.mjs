import fs from 'fs';
import path from 'path';
import os from 'os';

const dbPath = path.join(
  os.homedir(),
  'AppData/Roaming/Cursor/User/globalStorage/state.vscdb'
);

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.error('better-sqlite3 not installed');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

const patterns = ['%rule%', '%composer%', '%chat%', '%memory%', '%aichat%', '%cursor%'];
const where = patterns.map((p) => `key LIKE '${p}'`).join(' OR ');
const rows = db
  .prepare(`SELECT key, length(value) as len FROM ItemTable WHERE ${where} ORDER BY len DESC LIMIT 60`)
  .all();

console.log('=== KEYS ===');
for (const r of rows) console.log(`${r.len}\t${r.key}`);

const ruleKeys = db
  .prepare(`SELECT key, value FROM ItemTable WHERE key LIKE '%rule%' OR key LIKE '%memory%' LIMIT 20`)
  .all();

console.log('\n=== RULE/MEMORY SAMPLES ===');
for (const r of ruleKeys) {
  const preview = String(r.value).slice(0, 500);
  console.log(`\n--- ${r.key} ---\n${preview}`);
}

db.close();

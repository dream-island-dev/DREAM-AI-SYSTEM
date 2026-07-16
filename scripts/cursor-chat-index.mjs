import fs from 'fs';
import path from 'path';
import os from 'os';

const transcriptsDir = path.join(
  os.homedir(),
  '.cursor/projects/c-Users-mikek-DREAM-AI-SYSTEM/agent-transcripts'
);

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.jsonl') && !p.includes('subagents')) out.push(p);
  }
  return out;
}

function firstUserMessage(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (const line of lines.slice(0, 30)) {
    try {
      const obj = JSON.parse(line);
      const text =
        obj?.message?.content?.[0]?.text ||
        obj?.content ||
        obj?.text ||
        '';
      if (typeof text === 'string' && text.trim().length > 8) {
        return text.trim().replace(/\s+/g, ' ').slice(0, 120);
      }
    } catch {
      /* skip */
    }
  }
  return '(no preview)';
}

const files = walk(transcriptsDir).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const rows = files.map((f) => {
  const id = path.basename(f, '.jsonl');
  const st = fs.statSync(f);
  return {
    id,
    date: st.mtime.toISOString().slice(0, 16).replace('T', ' '),
    sizeKb: Math.round(st.size / 1024),
    preview: firstUserMessage(f),
    path: f,
  };
});

const outPath = path.join(process.cwd(), 'docs/cursor_chat_recovery_index.md');
let md = `# Cursor Chat Recovery Index\n\nGenerated: ${new Date().toISOString()}\n\nTotal sessions: **${rows.length}**\n\n| Date | ID | Size | First message |\n|---|---|---:|---|\n`;
for (const r of rows) {
  md += `| ${r.date} | \`${r.id}\` | ${r.sizeKb}KB | ${r.preview.replace(/\|/g, '/')} |\n`;
}
md += `\n## Raw paths\n\nBase: \`${transcriptsDir}\`\n`;
fs.writeFileSync(outPath, md, 'utf8');
console.log(`Wrote ${rows.length} sessions to ${outPath}`);

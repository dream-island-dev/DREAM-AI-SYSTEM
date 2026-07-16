import json
import os
import sqlite3

p = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
cur = c.cursor()

cur.execute("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'")
row = cur.fetchone()
if row:
    raw = row[0]
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
    data = json.loads(text)
    out = os.path.join(os.path.dirname(__file__), "..", "docs", "cursor_composer_headers_recovery.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"composerHeaders entries: {len(data) if isinstance(data, list) else type(data)}")
    if isinstance(data, list):
        for h in data[:15]:
            name = h.get("name") or h.get("title") or h.get("subtitle") or "?"
            cid = h.get("composerId") or h.get("id") or "?"
            print(f"  {cid[:8]}... | {str(name)[:80]}")
    print(f"Wrote {out}")

# broader key search for rules/memories
cur.execute("SELECT key FROM ItemTable WHERE key LIKE '%personal%' OR key LIKE '%aicontext%' OR key LIKE '%cursorRules%' OR key LIKE '%userRules%'")
keys = [r[0] for r in cur.fetchall()]
print("\nOther rule-related keys:", keys[:30])

c.close()

import json
import os
import sqlite3

p = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
key = "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser"

c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
cur = c.cursor()
cur.execute("SELECT value FROM ItemTable WHERE key = ?", (key,))
row = cur.fetchone()
c.close()

raw = row[0]
text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
data = json.loads(text)

out = os.path.join(os.path.dirname(__file__), "..", "docs", "cursor_application_user_storage.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Wrote {out}")
print("Top-level keys:", list(data.keys()) if isinstance(data, dict) else type(data))

if isinstance(data, dict):
    for k, v in data.items():
        if any(x in k.lower() for x in ("rule", "memory", "prefer", "ai", "cursor")):
            preview = json.dumps(v, ensure_ascii=False)[:300]
            print(f"\n{k}: {preview}")

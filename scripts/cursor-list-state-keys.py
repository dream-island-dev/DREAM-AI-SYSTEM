import os
import sqlite3

p = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
cur = c.cursor()

cur.execute("SELECT key, length(value) FROM ItemTable ORDER BY length(value) DESC LIMIT 80")
print("=== TOP 80 KEYS BY SIZE ===")
for key, ln in cur.fetchall():
    print(f"{ln}\t{key}")

cur.execute("SELECT key FROM ItemTable WHERE lower(key) LIKE '%rule%' OR lower(key) LIKE '%memory%' OR lower(key) LIKE '%preference%' OR lower(key) LIKE '%aicontext%'")
print("\n=== RULE/MEMORY KEYS ===")
for (key,) in cur.fetchall():
    print(key)

c.close()

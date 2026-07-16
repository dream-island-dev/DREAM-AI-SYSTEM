import os
import sqlite3

p = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
cur = c.cursor()

cur.execute(
    """
    SELECT key, length(value)
    FROM ItemTable
    WHERE key LIKE '%rule%' OR key LIKE '%composer%' OR key LIKE '%chat%'
       OR key LIKE '%memory%' OR key LIKE '%aichat%'
    ORDER BY length(value) DESC
    LIMIT 50
    """
)
print("=== TOP KEYS ===")
for key, ln in cur.fetchall():
    print(f"{ln}\t{key}")

cur.execute(
    """
    SELECT key, value
    FROM ItemTable
    WHERE key LIKE '%userRule%' OR key LIKE '%cursor.rules%'
       OR key LIKE '%memories%' OR key LIKE '%aicontext.personal%'
    LIMIT 20
    """
)
print("\n=== RULE CONTENT ===")
for key, val in cur.fetchall():
    print(f"\n--- {key} ---")
    text = val.decode("utf-8", errors="replace") if isinstance(val, bytes) else str(val)
    print(text[:2000])

c.close()

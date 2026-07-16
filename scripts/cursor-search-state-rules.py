import os
import sqlite3

p = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
cur = c.cursor()

needles = [
    "committing-changes-with-git",
    "Only create commits when requested",
    "userRules",
    "personalRules",
    "cursor.rules",
]

for needle in needles:
    cur.execute("SELECT key FROM ItemTable WHERE CAST(value AS TEXT) LIKE ?", (f"%{needle}%",))
    rows = cur.fetchall()
    print(f"=== {needle} -> {len(rows)} matches ===")
    for (key,) in rows[:10]:
        print(f"  {key}")

c.close()

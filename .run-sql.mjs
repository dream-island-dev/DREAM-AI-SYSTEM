import { readFileSync } from "node:fs";
const sql = readFileSync(process.argv[2], "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPA_REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SUPA_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
console.log("HTTP", res.status, (await res.text()).slice(0, 800));

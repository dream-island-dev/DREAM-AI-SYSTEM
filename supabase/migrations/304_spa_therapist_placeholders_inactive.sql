-- Hide migration-176 placeholder slots ("מטפל/ת 01" …) from spa board dropdowns.
-- Real names come from the day's Activities import. Do not DELETE — appointments
-- may still reference a slot; Align/import will re-point to canonical staff.

UPDATE public.spa_therapists
SET active = false
WHERE active = true
  AND (
    name ~ '^מטפל/?ת[[:space:]]*0*[0-9]+$'
    OR name ~ '^מטפלת[[:space:]]*0*[0-9]+$'
  );

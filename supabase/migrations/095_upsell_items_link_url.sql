-- migration 095 — upsell_items: add link_url column + workshop seed
-- Enables "workshop" catalog items that link to an external booking page
-- instead of using the PreOrder qty stepper. Admin can set link_url via
-- PortalSettingsPanel's new Day-Pass catalog tab.
--
-- No RLS change — upsell_items inherits the authenticated policy from 093.
-- guest-portal-data reads via service-role key, so RLS is bypassed there.

ALTER TABLE upsell_items
  ADD COLUMN IF NOT EXISTS link_url TEXT;

-- Seed a Workshop item for day_use pointing at the existing OnceHub link.
-- Admin can edit the URL, price, and description freely via the new UI.
-- The OnceHub link is the same URL used in the portal_scenes wine/padel CTA.
INSERT INTO upsell_items (name, description, price, category, target_audience, sort_order, is_active, link_url)
VALUES (
  'סדנאות וטעימות',
  'בחרו סדנה מרשימת ה-Dream Experience — יין, בישול, יוגה ועוד',
  NULL,
  'workshop',
  'day_use',
  50,
  true,
  'https://go.oncehub.com/DreamIsland'
)
ON CONFLICT DO NOTHING;

-- 259: standard + special published menus (one active per kind)

ALTER TABLE public.restaurant_menu_versions
  ADD COLUMN IF NOT EXISTS menu_kind TEXT NOT NULL DEFAULT 'standard'
  CHECK (menu_kind IN ('standard', 'special'));

DROP INDEX IF EXISTS idx_restaurant_menu_versions_one_published;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_menu_versions_one_published_per_kind
  ON public.restaurant_menu_versions (menu_kind)
  WHERE status = 'published';

COMMENT ON COLUMN public.restaurant_menu_versions.menu_kind IS
  'standard = תפריט קבוע (מסונכרן מאתר); special = תפריט ספיישל/אירוע';

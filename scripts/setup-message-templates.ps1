# Dream Island — Setup Message Templates Infrastructure
# Runs migration 027 + creates test template
# Usage: powershell -ExecutionPolicy Bypass -File setup-message-templates.ps1

param(
    [string]$SupabaseUrl = "https://bunohsdggxyyzruubvcd.supabase.co",
    [string]$ApiKey = ""  # Pass via -ApiKey or set SUPABASE_SERVICE_ROLE_KEY env var
)

if (!$ApiKey) {
    $ApiKey = $env:SUPABASE_SERVICE_ROLE_KEY
    if (!$ApiKey) {
        Write-Host "❌ Error: SUPABASE_SERVICE_ROLE_KEY not set" -ForegroundColor Red
        Write-Host "Run: `$env:SUPABASE_SERVICE_ROLE_KEY='your-key'" -ForegroundColor Yellow
        exit 1
    }
}

$headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type"  = "application/json"
}

Write-Host "🚀 Dream Island — Message Templates Setup" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Run migration 027 ──────────────────────────────────────────────
Write-Host "📦 Running migration 027 (message_templates table)..." -ForegroundColor Yellow

$migration027 = @"
CREATE TABLE IF NOT EXISTS message_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL UNIQUE,
  category     text        NOT NULL DEFAULT 'MARKETING'
    CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  language     text        NOT NULL DEFAULT 'he',
  body         text        NOT NULL,
  header       text,
  footer       text,
  meta_status  text        NOT NULL DEFAULT 'pending_approval'
    CHECK (meta_status IN ('pending_approval','approved','rejected','in_review')),
  meta_id      text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_templates_status_idx ON message_templates(meta_status);

CREATE OR REPLACE FUNCTION set_updated_at_tpl()
RETURNS TRIGGER LANGUAGE plpgsql AS \$\$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
\$\$;

DROP TRIGGER IF EXISTS message_templates_updated_at ON message_templates;
CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_tpl();

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_all_message_templates" ON message_templates
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager')
    )
  );
"@

$sqlBody = @{
    "query" = $migration027
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest `
        -Uri "$SupabaseUrl/rest/v1/rpc/exec_sql" `
        -Method POST `
        -Headers $headers `
        -Body $sqlBody `
        -ErrorAction Stop

    Write-Host "✅ Migration 027 executed" -ForegroundColor Green
} catch {
    # Ignore "table already exists" errors — they're OK
    if ($_.Exception.Message -like "*already exists*" -or $_.Exception.Response.StatusCode -eq 409) {
        Write-Host "✅ Migration 027 already exists (skipped)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Migration warning: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""

# ── Step 2: Create test template ────────────────────────────────────────────
Write-Host "📋 Creating test template (dream_arrival_confirm)..." -ForegroundColor Yellow

$testTemplate = @{
    "name"        = "dream_arrival_confirm"
    "category"    = "UTILITY"
    "body"        = "שלום {{1}}, ברוכים הבאים לדרים איילנד! אנחנו שמחים שאתם כאן 🏝️"
    "header"      = $null
    "footer"      = "Dream Island Resort | 08-6705600"
    "language"    = "he"
    "meta_status" = "approved"
    "is_active"   = $true
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest `
        -Uri "$SupabaseUrl/rest/v1/message_templates" `
        -Method POST `
        -Headers $headers `
        -Body $testTemplate `
        -ErrorAction Stop

    Write-Host "✅ Test template created" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 409) {
        Write-Host "✅ Test template already exists" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Template creation: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Deploy submit-wa-template: npx supabase functions deploy submit-wa-template --no-verify-jwt" -ForegroundColor Gray
Write-Host "  2. Open BroadcastDashboard → test creating a template" -ForegroundColor Gray

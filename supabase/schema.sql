-- ================================================================
-- DREAM ISLAND — Multi-Agent System Database Schema
-- Target: Supabase (PostgreSQL 15+)
-- Run via: Supabase Dashboard → SQL Editor
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- 1. PROFILES (extends Supabase Auth users)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'manager'
                           CHECK (role IN ('admin', 'manager')),
  department   TEXT,
  avatar_text  TEXT,
  email        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- 2. AGENT PROFILES (one active profile per manager)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.agent_profiles (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  manager_id         UUID        NOT NULL
                                 REFERENCES public.profiles(id) ON DELETE CASCADE,
  department         TEXT        NOT NULL,
  display_name       TEXT        NOT NULL,
  -- Full system prompt injected before every Claude call
  system_prompt      TEXT        NOT NULL,
  -- Personality settings derived from questionnaire
  personality_traits JSONB       NOT NULL DEFAULT '{
    "communication_style": "formal",
    "response_length": "concise",
    "proactivity": "medium"
  }',
  drive_folder_url   TEXT,
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  questionnaire_id   UUID,       -- FK added after questionnaire_responses is created
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (manager_id)             -- one agent per manager
);

-- ================================================================
-- 3. QUESTIONNAIRE RESPONSES
-- Stores raw answers; used to generate & regenerate system_prompt
-- ================================================================
CREATE TABLE IF NOT EXISTS public.questionnaire_responses (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  manager_id        UUID        NOT NULL
                                REFERENCES public.profiles(id) ON DELETE CASCADE,
  department        TEXT        NOT NULL,
  -- JSONB map: { dept_overview, challenges, kpis, communication_style,
  --              sensitive_topics, agent_help_areas, drive_url }
  responses         JSONB       NOT NULL,
  drive_folder_url  TEXT,
  completed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_profile_id  UUID        REFERENCES public.agent_profiles(id)
);

-- Back-reference FK from agent_profiles → questionnaire_responses
ALTER TABLE public.agent_profiles
  ADD CONSTRAINT fk_agent_questionnaire
  FOREIGN KEY (questionnaire_id)
  REFERENCES public.questionnaire_responses(id)
  ON DELETE SET NULL;

-- ================================================================
-- 4. CONVERSATION HISTORY
-- Full message log per agent session (used for context window)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.conversation_history (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_profile_id  UUID        NOT NULL
                                REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
  manager_id        UUID        NOT NULL
                                REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Groups messages belonging to one chat session
  session_id        TEXT        NOT NULL,
  role              TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content           TEXT        NOT NULL,
  tokens_used       INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_agent   ON public.conversation_history (agent_profile_id);
CREATE INDEX IF NOT EXISTS idx_conv_session ON public.conversation_history (session_id);
CREATE INDEX IF NOT EXISTS idx_conv_created ON public.conversation_history (created_at DESC);

-- ================================================================
-- 5. AGENT LEARNING LOGS  ← the feedback / continuous-learning loop
--
-- Every correction, rating, or note the manager gives is stored here.
-- The chat Edge Function queries the 5 most recent "correction" entries
-- and injects them as few-shot examples into the system prompt so the
-- agent never repeats the same mistake.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.agent_learning_logs (
  id                      UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_profile_id        UUID      NOT NULL
                                    REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
  manager_id              UUID      NOT NULL
                                    REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The specific assistant message that received feedback
  conversation_message_id UUID      REFERENCES public.conversation_history(id)
                                    ON DELETE SET NULL,
  original_response       TEXT      NOT NULL,
  -- Manager's corrected version (populated only for feedback_type = 'correction')
  correction              TEXT,
  -- 1–5 star rating (populated only for feedback_type = 'rating')
  rating                  SMALLINT  CHECK (rating BETWEEN 1 AND 5),
  feedback_type           TEXT      NOT NULL
                                    CHECK (feedback_type IN ('correction', 'rating', 'note')),
  -- Tracks whether this correction was already injected into a conversation
  is_injected             BOOLEAN   NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_agent    ON public.agent_learning_logs (agent_profile_id);
CREATE INDEX IF NOT EXISTS idx_learning_type     ON public.agent_learning_logs (feedback_type);
CREATE INDEX IF NOT EXISTS idx_learning_created  ON public.agent_learning_logs (created_at DESC);

-- ================================================================
-- 6. OPERATIONAL TABLES (replace mock data in App.js)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.employees (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL,
  department  TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  phone       TEXT,
  status      TEXT        NOT NULL DEFAULT 'פעיל'
                          CHECK (status IN ('פעיל', 'לא פעיל')),
  created_by  UUID        REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shifts (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id    UUID        REFERENCES public.employees(id) ON DELETE SET NULL,
  employee_name  TEXT        NOT NULL,
  department     TEXT        NOT NULL,
  date           DATE        NOT NULL,
  start_time     TIME        NOT NULL,
  end_time       TIME        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'עתידי'
                             CHECK (status IN ('פעיל', 'עתידי', 'הסתיים')),
  created_by     UUID        REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_date ON public.shifts (date DESC);

CREATE TABLE IF NOT EXISTS public.service_calls (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT        NOT NULL,
  description  TEXT,
  priority     TEXT        NOT NULL DEFAULT 'בינונית'
                           CHECK (priority IN ('דחופה', 'גבוהה', 'בינונית', 'נמוכה')),
  department   TEXT        NOT NULL,
  assigned_to  TEXT,
  status       TEXT        NOT NULL DEFAULT 'פתוח'
                           CHECK (status IN ('פתוח', 'בטיפול', 'טופל')),
  created_by   UUID        REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_status ON public.service_calls (status);

CREATE TABLE IF NOT EXISTS public.checklist_tasks (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  task          TEXT        NOT NULL,
  department    TEXT        NOT NULL,
  assigned_to   TEXT,
  done          BOOLEAN     NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  task_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_by    UUID        REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- 7. ROW LEVEL SECURITY
-- ================================================================

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questionnaire_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_learning_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_calls      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_tasks    ENABLE ROW LEVEL SECURITY;

-- Profiles: own row + admins see all
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  USING (auth.uid() = id OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Agent profiles: own row + admins
CREATE POLICY "agent_profiles_select" ON public.agent_profiles FOR SELECT
  USING (manager_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));
CREATE POLICY "agent_profiles_insert" ON public.agent_profiles FOR INSERT
  WITH CHECK (manager_id = auth.uid());
CREATE POLICY "agent_profiles_update" ON public.agent_profiles FOR UPDATE
  USING (manager_id = auth.uid());
CREATE POLICY "agent_profiles_delete" ON public.agent_profiles FOR DELETE
  USING (manager_id = auth.uid());

-- Questionnaire responses: own row + admins
CREATE POLICY "questionnaire_select" ON public.questionnaire_responses FOR SELECT
  USING (manager_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));
CREATE POLICY "questionnaire_insert" ON public.questionnaire_responses FOR INSERT
  WITH CHECK (manager_id = auth.uid());

-- Conversation history: own row + admins
CREATE POLICY "conversation_select" ON public.conversation_history FOR SELECT
  USING (manager_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));
CREATE POLICY "conversation_insert" ON public.conversation_history FOR INSERT
  WITH CHECK (manager_id = auth.uid());

-- Learning logs: own row + admins
CREATE POLICY "learning_logs_select" ON public.agent_learning_logs FOR SELECT
  USING (manager_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));
CREATE POLICY "learning_logs_insert" ON public.agent_learning_logs FOR INSERT
  WITH CHECK (manager_id = auth.uid());

-- Operational tables: any authenticated user
CREATE POLICY "employees_all"       ON public.employees       FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "shifts_all"          ON public.shifts          FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "service_calls_all"   ON public.service_calls   FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "checklist_all"       ON public.checklist_tasks FOR ALL USING (auth.uid() IS NOT NULL);

-- ================================================================
-- 8. FUNCTIONS & TRIGGERS
-- ================================================================

-- Auto-update updated_at column
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_profiles_updated
  BEFORE UPDATE ON public.agent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_service_calls_updated
  BEFORE UPDATE ON public.service_calls
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create a profile row when a new Supabase Auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, avatar_text)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'manager'),
    LEFT(UPPER(COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)), 2)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ================================================================
-- END OF SCHEMA
-- ================================================================

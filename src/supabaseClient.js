// src/supabaseClient.js
// Initialises the Supabase client.
// When env-vars are absent the app runs in demo/offline mode (localStorage only).
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ── Convenience helpers used by agent components ──────────────────────────────

const PROFILE_KEY = (uid) => `agent_profile_${uid}`;
const LOGS_KEY = (agentId) => `learning_logs_${agentId}`;

/** Load agent profile: Supabase → localStorage fallback */
export async function loadAgentProfile(userId) {
  if (isSupabaseConfigured) {
    const { data } = await supabase
      .from("agent_profiles")
      .select("*")
      .eq("manager_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    return data ?? null;
  }
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY(userId)) ?? "null");
  } catch {
    return null;
  }
}

/** Save agent profile to Supabase or localStorage */
export async function saveAgentProfile(profile) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("agent_profiles")
      .upsert(profile, { onConflict: "manager_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  localStorage.setItem(PROFILE_KEY(profile.manager_id), JSON.stringify(profile));
  return profile;
}

/** Return the last N corrections for this agent (used for few-shot injection) */
export function getLocalCorrections(agentProfileId, limit = 5) {
  try {
    const logs = JSON.parse(
      localStorage.getItem(LOGS_KEY(agentProfileId)) ?? "[]"
    );
    return logs
      .filter((l) => l.feedback_type === "correction" && l.correction)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

/** Append a learning log entry to localStorage */
export function appendLocalLearningLog(entry) {
  try {
    const key = LOGS_KEY(entry.agent_profile_id);
    const logs = JSON.parse(localStorage.getItem(key) ?? "[]");
    logs.push({ ...entry, id: `log_${Date.now()}`, created_at: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(logs.slice(-50))); // keep last 50
  } catch {}
}

/** Save a learning log: Supabase → localStorage fallback */
export async function saveLearningLog(log) {
  if (isSupabaseConfigured) {
    const { error } = await supabase.from("agent_learning_logs").insert(log);
    if (error) throw error;
    return;
  }
  appendLocalLearningLog(log);
}

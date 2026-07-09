/**
 * Mirrors supabase/functions/_shared/oritAgentMail.ts — keep in sync for UI/CI.
 */

export function computeSlaDeadline(receivedAtIso, slaHours) {
  const base = new Date(receivedAtIso);
  return new Date(base.getTime() + slaHours * 60 * 60 * 1000).toISOString();
}

export function isReadOnlyMailbox(mailbox) {
  return mailbox?.read_only_mode !== false;
}

// supabase/functions/_shared/guestBotSanitize.ts
// Guest-facing reply firewall — strips COT / thinking / prompt regurgitation
// before WhatsApp send. Shared by Meta (whatsapp-webhook) and Whapi (guestBotLlm).

const COT_CUE =
  /^\s*(?:the\s+(?:user|guest|customer|client|category|response|reply|answer|message|intent|assistant|tone|request)\b|according\s+to\b|category\b|intent\b|output\b|response\s+should\b|i\s|i'|let'?s\b|let\s+me\b|first[,:]|now[,:]|okay\b|ok[,:]|so[,:]|well[,:]|based\s+on\b|since\b|given\b|considering\b|because\b|here'?s\b|here\s+is\b|in\s+this\s+case\b|as\s+an?\s+ai\b|we\s+(?:should|need|will|are)\b|they\s+(?:are|want|asked|asking|need)\b|this\s+(?:is|seems|appears|looks)\b|looking\s+at\b|to\s+(?:respond|reply|answer|address)\b|should\s+be\b|note[:]|reasoning\b|analysis\b|my\s+(?:response|reply|task|goal)\b|step\s+\d)/i;

const PROMPT_LEAK_FRAGMENT =
  /לעולם אל תציג|רב-מגדרית|הבנת את התפקיד|Under no circumstances should you output|CRITICAL:\s*Under no|══\s*הנחיות|פלוט אך ורק|אסור לכלול חשיבה|TOOL_USAGE|log_guest_request|system_prompt|ענה 'כן' בלבד/i;

/** Hebrew letter present (concierge must reply in Hebrew). */
export function hasHebrew(s: string): boolean {
  return /[֐-׿]/.test(s);
}

/**
 * True when the model regurgitated system instructions / quiz-style rule
 * confirmation instead of a guest-facing reply (live leak 2026-07-11:
 * `"תמיד בצורה טבעית…". - Yes. * "לעולם אל תציג את`).
 */
export function looksLikePromptLeak(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (PROMPT_LEAK_FRAGMENT.test(t)) return true;
  // Quoted instruction fragment + Yes/כן confirmation
  if (/"[^"\n]{8,120}"\s*[-–—.]?\s*(?:Yes|כן)\b/i.test(t)) return true;
  // Two+ quoted chunks plus affirmation — model quizzing itself on rules
  const quotes = t.match(/"[^"\n]{8,}"/g) ?? [];
  if (quotes.length >= 2 && /\b(?:Yes|כן)\b/i.test(t)) return true;
  // Bullet + quote of an instruction verb ("לעולם" / "תמיד" / "Never")
  if (/[*•]\s*"?(?:לעולם|תמיד|Never|Always)\b/i.test(t) && quotes.length >= 1) {
    return true;
  }
  return false;
}

/**
 * Strip thinking / COT / internal tags. Returns "" when nothing usable remains
 * (caller must substitute a safe Hebrew fallback — never send empty or English).
 */
export function sanitizeGuestBotReply(text: string): string {
  let result = text;

  result = result.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/gi, "");
  result = result.replace(/<\/?think(?:ing)?>/gi, "");

  result = result.replace(
    /^(?:THOUGHT|Reasoning|Thinking|Analysis|COT|Plan|מחשבה|ניתוח|תכנון)\s*:[\s\S]*?(?=\n\n|$)/gim,
    "",
  );
  result = result.replace(
    /^\*\*(?:Thinking|Reasoning|Analysis|Thought|מחשבה)\*\*\s*:?[\s\S]*?(?=\n\n|$)/gim,
    "",
  );
  result = result.replace(/^(?:THOUGHT|Reasoning|Thinking|COT|מחשבה)\s*:.*$/gim, "");

  {
    const lines = result.split("\n");
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (ln.trim() === "") {
        i++;
        continue;
      }
      if (!hasHebrew(ln) && COT_CUE.test(ln)) {
        i++;
        continue;
      }
      break;
    }
    if (i > 0) result = lines.slice(i).join("\n").trim();
  }
  if (COT_CUE.test(result) && hasHebrew(result)) {
    const idx = result.search(/[֐-׿]/);
    if (idx > 0) result = result.slice(idx).trim();
  }

  result = result
    .replace(/\[תבנית[^\]]*\]/gi, "")
    .replace(/\[[֐-׿\w\-_:]{2,60}\]/g, "")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (looksLikePromptLeak(result)) return "";

  if (result.length > 12 && !hasHebrew(result)) return "";

  return result;
}

/** Hard drop — broken generation, do not send any fragment. */
export function shouldHardDropGuestReply(body: string): boolean {
  return /```/.test(body) || /\b(?:THOUGHT|REASONING)\b/i.test(body) || looksLikePromptLeak(body);
}

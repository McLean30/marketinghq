// Nexai's editorial voice: the business profile default for organic content, and the one exception.
// Shared by the browser (templates, Calibre, the job's tone label) and the server (provider prompts, mock), so every
// agent works to the same rule.

/** Kieran's editorial voice, seeded into business profiles as `writing.voice` (the owner can edit it). */
export const DEFAULT_VOICE = 'Write like we’re giving someone an honest update from inside Nexai. Use natural British English and first-person plural where it fits. Explain what we’re building, what prompted it, the everyday problem and the outcome we’re working towards. Give the reader something useful. Distinguish work in progress from products, results or client work we can genuinely point to. When a CTA fits, invite a comment or message in our own voice. Vary the wording. Some posts can end on the useful point.';

/** The voice to work to: the profile's own wording, or the default when it's blank. */
export const voiceOf = (data) => (typeof data?.writing?.voice === 'string' && data.writing.voice.trim()) || DEFAULT_VOICE;
export const hasVoiceField = (data) => typeof data?.writing?.voice === 'string';

// Only an explicit request switches tone: a hard sell, a direct-response advert or a promotional / booking CTA.
// "Write about our services" (or any ordinary brief) keeps the editorial default.
const PROMO = /\b(hard[- ]?sell|direct[- ]response|promo(?:tional)?\b(?! *(?:code|video of))|advert(?:isement|ising)?|ad copy|sales (?:pitch|ad|post)|(?:booking|clear|strong|promotional|sales|book(?:ing)?[- ]now)\s+(?:cta|call[- ]to[- ]action))/i;

export const ALWAYS_APPLIES = 'Audience, channel rules, approved claims, valid offers and your approval before anything is published still apply.';

/** The tone a job works to, decided from its brief once, when the job is created. */
export function toneFor(brief) {
  const m = PROMO.exec(brief || '');
  if (m) return { mode: 'promo', label: 'Direct-response promotion (this job only)', reason: `The brief explicitly asks for “${m[0].trim()}”, so this job uses a promotional tone with a clear call to action. Other jobs keep the editorial voice.` };
  return { mode: 'editorial', label: 'Nexai editorial voice (business profile default)', reason: 'Organic posts use the business profile’s editorial voice. Only a brief that explicitly asks for a hard sell, a direct-response advert or a promotional call to action changes the tone, for that job only.' };
}

/** Words that read as a hard sell; Calibre flags them in editorial jobs. */
export const HARD_SELL = /\b(book now|act now|don[’']?t miss(?: out)?|limited[- ]time|hurry|last chance|sign up today|buy now|call (?:us )?now|while (?:stocks|spaces) last|guaranteed results|book (?:your|a) (?:free )?(?:slot|call|review) today)\b|!{2,}/i;

/** The tone section for the configured provider's prompt (Quill, Vektor) and the mock. */
export function promptBlock(tone, voice, cta) {
  if (tone?.mode === 'promo') {
    return `Tone for this job: direct-response promotion. ${tone.reason} For this job only, lead with the service or offer, make the benefit concrete, and end with one clear call to action${cta ? ` using the profile's wording ("${cta}")` : ''}. Keep natural British English and the audience in mind. Use only approved claims and valid offers. ${ALWAYS_APPLIES}`;
  }
  return `Tone for this job: Nexai's editorial voice (the business profile default). Follow it closely:\n"""\n${voice || DEFAULT_VOICE}\n"""\nNo hard sell and no pushy call to action. ${ALWAYS_APPLIES}`;
}

/** A stable small number for varying wording per job (endings, hooks) without randomness. */
export function variant(seed, n) {
  let h = 2166136261;
  for (const ch of String(seed || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % n;
}

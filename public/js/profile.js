// Nexai business profile: helpers shared by the profile screen, the generators and the Reviewer.
// The profile itself is stored as numbered, identified versions (see store.js / server/workspace.js).

let SEED = null;
export async function loadSeed() {
  if (!SEED) {
    const r = await fetch('data/profile-seed.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`profile seed ${r.status}`);
    SEED = await r.json();
  }
  return JSON.parse(JSON.stringify(SEED));
}

export const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/** An offer counts as live on `date` only if it's marked active and the date is inside its window. */
export function offerState(o, date) {
  if (!o.active) return { live: false, why: 'it is marked inactive in the business profile' };
  if (o.start && date < o.start) return { live: false, why: `it doesn’t start until ${fmt(o.start)}` };
  if (o.end && date > o.end) return { live: false, why: `it ended on ${fmt(o.end)}` };
  return { live: true, why: o.end ? `runs until ${fmt(o.end)}` : 'has no end date' };
}
export const activeOffers = (data, date) => (data?.offers || []).filter((o) => o.wording && offerState(o, date).live);
export const fmt = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** Owner-facing names for profile fields. */
export const FIELD_LABEL = {
  services: 'Services', audience: 'Audience', proof: 'Proof', cta: 'Website call to action', 'brand.language': 'Language',
  'brand.linkedinHashtags': 'LinkedIn hashtags', 'brand.imagery': 'Imagery', 'brand.logoRule': 'Logo rule', offers: 'Offers', writing: 'Writing guidance',
};

export function changedFields(a, b) {
  const out = [];
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  for (const k of ['services', 'audience', 'proof', 'cta', 'offers', 'writing']) if (!same(a?.[k], b?.[k])) out.push(k);
  for (const k of ['language', 'linkedinHashtags', 'imagery', 'logoRule']) if (!same(a?.brand?.[k], b?.brand?.[k])) out.push(`brand.${k}`);
  return out;
}

/**
 * Which of this post's content is affected by profile changes made after `refData` (the version its latest output or
 * review used)? Only changes that touch something the post actually contains count, so an unrelated edit doesn't
 * send every post back through review. Returns [{ field, text }].
 */
export function profileImpact({ caption, platform, refData, curData, refId, curId, date }) {
  if (!refData || refId === curId) return [];
  const text = norm(caption);
  const out = [];
  const fields = changedFields(refData, curData);
  if (fields.includes('offers')) {
    for (const o of [...(curData.offers || []), ...(refData.offers || [])]) {
      if (!o.wording || !text.includes(norm(o.wording)) || out.some((x) => x.offerId === o.id)) continue;
      const before = (refData.offers || []).find((x) => x.id === o.id);
      const after = (curData.offers || []).find((x) => x.id === o.id);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const st = after ? offerState(after, date) : { live: false, why: 'it was removed from the profile' };
      out.push({ field: 'Offers', offerId: o.id, text: `The offer “${o.wording}” changed in ${curId}${st.live ? '' : `: ${st.why}`}. This post quotes it.` });
    }
  }
  if (fields.includes('brand.linkedinHashtags') && platform === 'LinkedIn') out.push({ field: 'LinkedIn hashtags', text: `The LinkedIn hashtag rule changed in ${curId}.` });
  if (fields.includes('brand.language')) out.push({ field: 'Language', text: `The language rule changed in ${curId}.` });
  if (fields.includes('cta') && refData.cta?.main !== curData.cta?.main && text.includes(norm(refData.cta?.main))) out.push({ field: 'Website call to action', text: `The call to action changed from “${refData.cta.main}” to “${curData.cta.main}” in ${curId}. This post uses the old wording.` });
  if (fields.includes('proof')) {
    for (const p of curData.proof || []) {
      const old = (refData.proof || []).find((x) => x.id === p.id);
      if (text.includes(norm(p.name)) && JSON.stringify(old) !== JSON.stringify(p)) out.push({ field: 'Proof', text: `${p.name}’s approved claims or link changed in ${curId}. This post mentions ${p.name}.` });
    }
  }
  if (fields.includes('services')) {
    for (const s of refData.services || []) {
      const now = (curData.services || []).find((x) => x.id === s.id);
      if (text.includes(norm(s.name)) && (!now || now.name !== s.name)) out.push({ field: 'Services', text: `The service “${s.name}” was renamed or removed in ${curId}. This post mentions it.` });
    }
  }
  return out;
}

/** Fields the owner still needs to supply. */
export function missingWording(data) {
  const m = [];
  if (!data?.writing?.process?.trim()) m.push('Winner’s Writing Process');
  if (!data?.writing?.checklist?.trim()) m.push('Self-review checklist');
  return m;
}

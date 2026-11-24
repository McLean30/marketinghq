// Milestone 13: the service catalogue in the Business Profile.
//   A. Browser demo mode (no server settings): seeded records and defaults; editable on desktop and phone; the
//      acceptance brief to Vektor; Calibre's disclosure checks; changing the public wording; an approved post keeps
//      its wording and version; Vektor's template week plan creates drafts only.
//   B. Shared workspace with the mock AI provider: exactly what the model would be sent (no internal notes, internal
//      names, prices or other modules), for captions and Vektor's plan.
//   C. An existing, edited profile gains the catalogue as a new version with every edit kept (local server store).
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAT = await import('../public/js/catalogue.js');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const PRIVATE = /Revenue Recovery|Database Reactivation|Quote Recovery|Enquiry Capture|commission|upfront|running costs/i;
const BRIEF = 'LinkedIn post about what Nexai is building for businesses with past customers';
const NEW_WORDING = 'We’re working on a simple way for local businesses to get back in touch with customers they’ve served before, so a good job leads to the next one.';

function start(port, env = {}) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res) => { let o = ''; child.stdout.on('data', (d) => { o += d; if (/Shared workspace:/.test(o)) res(child); }); });
}
const servers = [];
const browser = await chromium.launch();
const errors = [];
const local = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('nexai-hq:v1') || '{}'));
async function newPost(page, base, brief) {
  await page.goto(`${base}#/`);
  await page.waitForSelector('#brief-form');
  await page.selectOption('#format', 'image');
  await page.fill('#brief', brief);
  await page.selectOption('#platform', 'LinkedIn');
  await page.click('#brief-form button[type=submit]');
  const id = await page.waitForFunction((b) => JSON.parse(localStorage.getItem('nexai-hq:v1') || '{"jobs":[]}').jobs.find((j) => j.brief === b && !j.seen)?.id, brief).then((h) => h.jsonValue());
  await page.evaluate((jid) => { const s = JSON.parse(localStorage.getItem('nexai-hq:v1')); s.jobs.find((j) => j.id === jid).seen = true; localStorage.setItem('nexai-hq:v1', JSON.stringify(s)); }, id);
  await page.goto(`${base}#/job/${id}`);
  await page.waitForSelector('[data-approve]:not([disabled])', { timeout: 30000 });
  return id;
}
const captionOf = (st, id) => { const j = st.jobs.find((x) => x.id === id); const t = st.tasks.find((x) => x.id === j.taskIds.copy); return t.versions.at(-1); };

try {
  console.log('\n== A. Browser demo mode ==');
  const demo = await start(4251);
  servers.push(demo);
  const D = 'http://127.0.0.1:4251/';
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dp = await desk.newPage();
  dp.on('pageerror', (e) => errors.push(`desktop: ${e.message}`));
  await dp.goto(D);
  await dp.waitForSelector('#brief-form');
  let st = await local(dp);
  const cur = () => st.profile.versions.at(-1).data;
  const items = cur().catalogue.items;
  const by = (id) => items.find((i) => i.id === id);
  assert(['svc_web', 'svc_software', 'svc_ai'].every((id) => by(id)?.status === 'available' && by(id).disclosure === 'name') && /building maintenance/.test(by('svc_web').audience) && /operations directors/.test(by('svc_web').audience), 'Three available services seeded, for UK commercial building maintenance and building services firms');
  assert(by('fam_revenue').kind === 'family' && by('fam_revenue').disclosure === 'internal', 'Nexai Revenue Recovery: product family, internal');
  assert(by('mod_reactivation').status === 'in_development' && by('mod_reactivation').disclosure === 'describe' && /SMEs across sectors/.test(by('mod_reactivation').audience), 'Database Reactivation: in development, described without naming, local SMEs across sectors');
  assert(['mod_quotes', 'mod_enquiries'].every((id) => by(id).status === 'planned' && by(id).disclosure === 'internal'), 'Quote Recovery and Enquiry Capture: planned, internal');
  assert(/no upfront development fee/.test(by('mod_reactivation').internalNotes) && /commission/.test(by('mod_reactivation').internalNotes) && !/commission|upfront/i.test(by('mod_reactivation').publicWording), 'The commercial model is an internal note only');
  assert(items.every((i) => ['audience', 'problem', 'outcome', 'status', 'publicWording', 'internalNotes', 'disclosure'].every((k) => k in i)), 'Every record has audience, problem, outcome, status, public wording, internal notes and public-use setting');

  await dp.goto(`${D}#/profile`);
  await dp.waitForSelector('[data-testid="catalogue"]');
  assert((await dp.locator('[data-testid="cat-item"]').count()) === 7 && /Client contact lists stay in your own systems/.test(await dp.textContent('[data-testid="catalogue"]')), 'Business Profile shows all seven records, and says client contact lists stay outside HQ');
  await dp.screenshot({ path: `${ROOT}/design/previews/m13-desktop-catalogue.png`, fullPage: false });

  const ordinary = CAT.contextFor(cur(), "LinkedIn post for maintenance directors about jobs the office can't invoice because a job sheet or photo is missing.");
  assert(!ordinary.items.length && !ordinary.left.length, 'An ordinary problem-led brief brings in no service or product information');

  // Acceptance: ask Vektor for the post.
  const A = await newPost(dp, D, BRIEF);
  st = await local(dp);
  const jobA = st.jobs.find((j) => j.id === A);
  const capA = captionOf(st, A);
  assert(jobA.catalogue.items.length === 1 && jobA.catalogue.items[0].id === 'mod_reactivation' && jobA.catalogue.items[0].name === null && jobA.catalogue.items[0].status === 'in_development', 'Vektor’s brief carries one item: the reactivation work, described without its name, in development');
  assert(!PRIVATE.test(JSON.stringify(jobA.catalogue)), 'The brief context holds no family name, module names, internal notes or pricing');
  assert(capA.content.text.includes(by('mod_reactivation').publicWording) && /still in development/.test(capA.content.text) && /building/.test(capA.content.text), 'Caption uses the approved wording and says it’s work in progress');
  assert(!PRIVATE.test(capA.content.text) && !/£|price|fee/i.test(capA.content.text), 'Caption keeps the family name and pricing private and leaves the other modules out');
  assert(/comments|message/i.test(capA.content.text), 'Founder-led voice with a soft invitation to comment or message');
  await dp.waitForSelector('[data-testid="job-catalogue"]');
  await dp.click('[data-testid="job-catalogue"] summary');
  assert(/Described without naming it/.test(await dp.textContent('[data-testid="job-catalogue"]')), 'The post shows the brief context Vektor passed on');
  const gA = st.tasks.find((t) => t.id === jobA.taskIds.graphic).versions[0].content;
  assert(gA.headline.join(' ') === 'Past customers, back in touch.' && gA.chip === 'In development' && !PRIVATE.test(JSON.stringify(gA)), 'Prism’s graphic uses the approved headline and an “In development” chip');

  const V = await import('../public/js/video.js');
  const sb = V.templateStoryboard({ brief: BRIEF, catalogue: jobA.catalogue }, { duration: 20 });
  assert(sb.scenes[1].title === 'What we’re building' && /reconnect with past customers/.test(sb.scenes[1].caption) && /Work in progress/.test(sb.scenes.at(-1).caption) && !PRIVATE.test(JSON.stringify(sb)), 'Cue’s script uses the approved wording, ends on work in progress, names nothing internal');

  // Calibre: clean draft passes; a draft that breaks the rules is flagged.
  await dp.click(`[data-run-review="${A}"]`);
  await dp.waitForFunction((id) => (JSON.parse(localStorage.getItem('nexai-hq:v1')).jobs.find((j) => j.id === id).reviews || []).length === 1, A);
  st = await local(dp);
  let rv = st.jobs.find((j) => j.id === A).reviews[0];
  assert(rv.checks.find((c) => c.id === 'catalogue')?.result === 'pass', 'Calibre: the acceptance caption passes the service and product rules');
  const copyB = st.jobs.find((j) => j.id === A).taskIds.copy;
  const B = await newPost(dp, D, 'LinkedIn post about how we help businesses with past customers');
  st = await local(dp);
  const copyTaskB = st.jobs.find((j) => j.id === B).taskIds.copy;
  await dp.click(`[data-toggle-edit="${copyTaskB}"]`);
  await dp.fill(`#ed-${copyTaskB}`, 'Nexai Revenue Recovery is here: Database Reactivation is now available.\n\nNo upfront development fee, just running costs plus commission on sales.\n\nOur clients have recovered £20k from old customer lists.\n\n#SmallBusiness #UKBusiness #NexaiDigital');
  await dp.click(`[data-edit-form="${copyTaskB}"] button[type=submit]`);
  await dp.waitForFunction((id) => JSON.parse(localStorage.getItem('nexai-hq:v1')).tasks.find((t) => t.id === id).versions.length === 2, copyTaskB);
  await dp.click(`[data-run-review="${B}"]`);
  await dp.waitForFunction((id) => (JSON.parse(localStorage.getItem('nexai-hq:v1')).jobs.find((j) => j.id === id).reviews || []).length === 1, B);
  st = await local(dp);
  rv = st.jobs.find((j) => j.id === B).reviews[0];
  const cat = rv.findings.filter((f) => f.check === 'catalogue').map((f) => f.title).join(' | ');
  assert(/Internal name in the draft: “Nexai Revenue Recovery”/.test(cat) && /Internal name in the draft: “Database Reactivation”/.test(cat), 'Calibre flags internal names (the family, and a module that may only be described)');
  assert(/Price or commercial terms/.test(cat), 'Calibre flags the price and commercial terms');
  assert(/unlaunched as available/.test(cat), 'Calibre flags the in-development work presented as available');
  assert(/Results claim/.test(cat) || rv.findings.some((f) => f.check === 'claims'), 'Calibre flags the unsupported results claim');
  void copyB;

  // Approve post A, then change the public wording.
  await dp.goto(`${D}#/job/${A}`);
  await dp.click('[data-approve]');
  await dp.waitForFunction((id) => !!JSON.parse(localStorage.getItem('nexai-hq:v1')).jobs.find((j) => j.id === id).approval, A);
  st = await local(dp);
  const approvedA = { caption: captionOf(st, A).content.text, n: captionOf(st, A).n, approval: st.jobs.find((j) => j.id === A).approval, profileVersion: st.jobs.find((j) => j.id === A).catalogue.profileVersion };
  await dp.goto(`${D}#/profile`);
  await dp.waitForSelector('[data-id="mod_reactivation"]');
  const idx = items.findIndex((i) => i.id === 'mod_reactivation');
  await dp.click('[data-id="mod_reactivation"] summary');
  await dp.fill(`#pf-catalogue-items-${idx}-publicWording`, NEW_WORDING);
  await dp.click('[data-testid="save-profile"]');
  await dp.waitForSelector('[data-testid="profile-saved"]');
  const saved = await dp.textContent('[data-testid="profile-saved"]');
  assert(/Services and products \(Database Reactivation\)/.test(saved), 'Saving records a new profile version naming the changed record');
  assert(/approved public wording/.test(await dp.textContent('[data-testid="affected-posts"]').catch(() => '')), 'The approved post is listed for review, noting it keeps the wording it was written with');
  const C = await newPost(dp, D, BRIEF);
  st = await local(dp);
  const capC = captionOf(st, C).content.text;
  assert(capC.includes(NEW_WORDING) && !capC.includes(by('mod_reactivation').publicWording) && st.jobs.find((j) => j.id === C).catalogue.items[0].wording === NEW_WORDING, 'A new draft uses the new public wording');
  const nowA = { caption: captionOf(st, A).content.text, n: captionOf(st, A).n, approval: st.jobs.find((j) => j.id === A).approval, profileVersion: st.jobs.find((j) => j.id === A).catalogue.profileVersion };
  assert(nowA.caption === approvedA.caption && nowA.n === approvedA.n && JSON.stringify(nowA.approval) === JSON.stringify(approvedA.approval) && nowA.profileVersion === approvedA.profileVersion && nowA.caption.includes(by('mod_reactivation').publicWording), `The approved post keeps its original wording, caption v${nowA.n} and approval (profile ${nowA.profileVersion})`);

  // Vektor's template week plan: approved public information only, drafts only.
  await dp.goto(`${D}#/week/new`);
  await dp.waitForSelector('#week-form');
  await dp.fill('#wk-brief', 'A week about what we’re building for businesses with past customers, plus our websites.');
  await dp.click('#week-form button[value="template"], #week-form button[type=submit]:not([value="ai"])');
  await dp.waitForFunction(() => location.hash.startsWith('#/week/plan_'));
  st = await local(dp);
  const plan = st.plans.at(-1);
  assert(/past customers|customers who were happy/i.test(plan.days[0].angle) && /website/i.test(plan.days[4].angle) && !PRIVATE.test(JSON.stringify(plan)), 'Vektor’s week plan covers both things the brief asked for, in its order (Monday: the reactivation work; Friday: websites), with no internal names or pricing');
  assert(!st.jobs.some((j) => j.planId === plan.id) && !st.jobs.some((j) => (j.publications || []).length), 'The week plan is a draft: nothing is created or queued until you confirm');

  // Phone: the catalogue is editable.
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await pp.goto(`${D}#/profile`);
  await pp.waitForSelector('[data-id="mod_quotes"]');
  await pp.click('[data-id="mod_quotes"] summary');
  const qi = items.findIndex((i) => i.id === 'mod_quotes');
  const sel = pp.locator(`#pf-catalogue-items-${qi}-disclosure`);
  const box = await sel.boundingBox();
  const over = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(box && box.width > 200 && box.height >= 40 && over <= 1, `Phone: a record opens, its public-use control is full width and easy to tap (${Math.round(box.width)}×${Math.round(box.height)}), no sideways scroll`);
  await pp.screenshot({ path: `${ROOT}/design/previews/m13-phone-catalogue.png` });
  await phone.close();
  await desk.close();

  console.log('\n== B. Shared workspace, mock AI provider: what the model is sent ==');
  const PW = `pw-${crypto.randomBytes(6).toString('hex')}`;
  const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-m13-'));
  const shared = await start(4252, { HQ_DATA_DIR: sharedDir, HQ_OWNER_PASSWORD_HASH: hashPassword(PW), QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '200', HQ_SCHEDULER_MS: '0' });
  servers.push(shared);
  const S = 'http://127.0.0.1:4252/';
  const sc = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const sp = await sc.newPage();
  sp.on('pageerror', (e) => errors.push(`shared: ${e.message}`));
  const sent = [];
  sp.on('request', (r) => { if (r.method() === 'POST' && /api\/(quill|vektor|video|review)\//.test(r.url())) sent.push({ url: r.url(), body: r.postData() || '' }); });
  await sp.goto(`${S}#/workspace`);
  await sp.fill('#ws-password', PW);
  await sp.click('#signin-form button[type=submit]');
  await sp.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace');
  await sp.goto(`${S}#/`);
  await sp.waitForSelector('#brief-form');
  await sp.selectOption('#format', 'image');
  await sp.fill('#brief', BRIEF);
  await sp.click('#brief-form button[type=submit]');
  let calls = [];
  for (let i = 0; i < 80 && !calls.length; i++) { calls = await sp.evaluate(async () => (await fetch('api/quill/mock-calls')).json()); if (!calls.length) await sp.waitForTimeout(250); }
  const call = calls.at(-1);
  assert(call.catalogue.items.length === 1 && call.catalogue.items[0].name === null && /reconnect with past customers/.test(call.prompt), 'The caption prompt carries the approved wording, described without naming it');
  assert(/do NOT name it/.test(call.prompt) && /work in progress/.test(call.prompt) && /Don’t mention any other Nexai product/.test(call.prompt), 'The prompt tells the model: don’t name it, present it as work in progress, mention nothing else');
  assert(!PRIVATE.test(call.prompt) && !call.profileHasCatalogue, 'The prompt and the profile sent hold no internal notes, internal names, other modules or pricing');
  await sp.goto(`${S}#/week/new`);
  await sp.waitForSelector('#week-form');
  await sp.fill('#wk-brief', 'A week about what we’re building for businesses with past customers.');
  await sp.click('[data-testid="ai-plan-btn"]');
  await sp.waitForFunction(() => location.hash.startsWith('#/week/plan_'), null, { timeout: 20000 });
  const planReq = sent.find((x) => /vektor\/plan/.test(x.url));
  assert(planReq && /reconnect with past customers/.test(planReq.body) && !PRIVATE.test(planReq.body), 'Vektor’s AI plan request carries only the approved public information');
  assert(sent.length >= 2 && sent.every((x) => !PRIVATE.test(x.body)), `None of the ${sent.length} generation requests contained internal information`);
  await sc.close();

  console.log('\n== C. An existing, edited profile gains the catalogue with every edit kept ==');
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-m13-old-'));
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/profile-seed.json'), 'utf8'));
  delete seed.catalogue;
  const edited = JSON.parse(JSON.stringify(seed));
  edited.services[0].name = 'Websites for Maintenance Firms';
  edited.services[0].description = 'Owner-edited website description.';
  edited.audience.size = 'Owner edit: 20–100 employees';
  edited.writing.voice = 'Owner-edited voice.';
  edited.brand.linkedinHashtags.required = ['#NexaiDigital'];
  fs.writeFileSync(path.join(oldDir, 'workspace.json'), JSON.stringify({ version: 1, rev: 2, jobs: {}, plans: {}, brand: { rev: 0, data: {} }, profile: { rev: 2, versions: [{ id: 'pv1-aaaaaa', n: 1, savedAt: 1, savedBy: 'seed', data: seed }, { id: 'pv2-bbbbbb', n: 2, savedAt: 2, savedBy: 'computer', data: edited }] } }));
  const up = await start(4253, { HQ_DATA_DIR: oldDir, HQ_OWNER_PASSWORD_HASH: hashPassword(PW), HQ_SCHEDULER_MS: '0' });
  servers.push(up);
  const login = await fetch('http://127.0.0.1:4253/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const snap = await (await fetch('http://127.0.0.1:4253/api/workspace', { headers: { cookie } })).json();
  const vs = snap.profile.versions;
  const latest = vs.at(-1).data;
  assert(vs.length === 3 && vs[1].id === 'pv2-bbbbbb' && vs.at(-1).savedBy === 'update: service catalogue added', 'Upgrade adds version 3; the owner’s version 2 is kept as it was');
  const { catalogue, ...rest } = latest;
  assert(JSON.stringify(rest) === JSON.stringify(edited), 'Every existing field is exactly as the owner left it');
  assert(catalogue.items.find((i) => i.id === 'svc_web').name === 'Websites for Maintenance Firms' && catalogue.items.find((i) => i.id === 'svc_web').publicWording === 'Owner-edited website description.', 'The owner’s renamed service and its wording carry into the catalogue');
  assert(catalogue.items.length === 7 && CAT.validateCatalogue(catalogue) === null, 'The family and its three modules are added alongside');
  const again = await (await fetch('http://127.0.0.1:4253/api/workspace', { headers: { cookie } })).json();
  assert(again.profile.versions.length === 3, 'Reading again doesn’t add another version');

  assert(!errors.length, `No page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  console.log('\nMilestone 13 service catalogue checks passed.');
} finally {
  await browser.close();
  for (const s of servers) s.kill();
}

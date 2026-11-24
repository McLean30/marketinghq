// How each part of HQ chooses its mode, decided in one place (Milestone 14).
//
//   sign-in      owner sign-in is on when HQ_OWNER_PASSWORD_HASH is valid and a durable store exists (auth.js).
//                On: the whole app is private (server.js gateRequest). Off: a public browser demo (previews).
//   storage      Supabase whenever SUPABASE_URL + SUPABASE_SECRET_KEY are set, else files (own machine, tests).
//                A signed-in owner always works in that store; the browser never swaps in its own demo data.
//   captions     OpenAI with OPENAI_API_KEY (owner signed in). Without a key the owner sees the real failure
//                ("live AI isn't set up"), never template text. QUILL_PROVIDER=mock is a test-only stand-in.
//   images       Prism generates only when the owner presses Generate (OpenAI, or the mock in tests). Until a real
//                photo or generated image exists a post shows "Graphic needed". No simulated artwork.
//   publishing   Nothing is sent until a destination is really connected and the hosted scheduler is set up. No
//                destination can be connected yet, so every destination reads "<Platform> isn't connected".
//   fixtures     HQ_TEST_FIXTURES=1 (refused on Vercel) brings back the simulated graphics, template captions,
//                demo publisher and test clock, for isolated automated tests only.
const auth = require('./auth');
const backend = require('./backend');
const quill = require('./quill');

const PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook', 'X', 'Google Business Profile'];
const NOT_CONNECTED = { LinkedIn: 'LinkedIn isn’t connected', Instagram: 'Instagram isn’t connected', Facebook: 'Facebook isn’t connected', X: 'X isn’t connected', 'Google Business Profile': 'Google Business Profile isn’t connected' };

/** Simulated outputs and the demo publisher: isolated automated tests only, never on Vercel. */
const fixtures = () => process.env.HQ_TEST_FIXTURES === '1' && !process.env.VERCEL;

/** Whether the owner's work can be sent for real: a connected destination and a configured hosted scheduler. */
function destinations() {
  const hosted = backend.useSupabase();
  return Object.fromEntries(PLATFORMS.map((p) => [p, fixtures()
    ? { connected: true, demo: true, label: `${p} (demo account, simulated)` }
    : { connected: false, demo: false, label: NOT_CONNECTED[p], schedulerReady: hosted }]));
}

/** What the signed-in owner (or a demo visitor) is running on, for the browser and the Workspace page. */
function describe(signedIn) {
  const priv = auth.configured();
  const provider = quill.providerInfo().provider; // 'openai' | 'mock' | 'demo'
  const storage = priv ? backend.store().kind : 'browser';
  return {
    private: priv,
    fixtures: fixtures(),
    destinations: destinations(),
    modes: {
      signIn: priv ? 'owner' : 'off',
      storage, // 'supabase' | 'file' | 'browser'
      captions: !priv ? 'templates' : provider === 'openai' ? 'openai' : provider === 'mock' ? 'mock' : fixtures() ? 'templates' : 'not-configured',
      images: !priv ? 'simulated' : provider === 'openai' ? 'openai' : provider === 'mock' ? 'mock' : 'not-configured',
      publishing: !priv ? 'browser-demo' : fixtures() ? 'demo-publisher' : 'not-connected',
      scheduler: !priv ? 'browser' : backend.useSupabase() ? 'hosted' : 'server',
      signedIn: !!signedIn,
    },
  };
}

module.exports = { fixtures, destinations, describe, PLATFORMS, NOT_CONNECTED };

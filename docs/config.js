/*
 * Where the planner stores events.
 *
 *  - Leave both values empty  → use the local Node server (npm start, data/events.json).
 *  - Fill in both values      → use your Supabase project (needed for the GitHub Pages version).
 *
 * Get them in Supabase: Project Settings → API (or "Connect"):
 *   supabaseUrl: "Project URL", e.g. https://abcdefghijkl.supabase.co
 *   supabaseKey: the "publishable" key (sb_publishable_...) or the legacy "anon" key.
 *
 * These two values are meant to be public (they end up in the browser anyway).
 * NEVER put the "secret" / "service_role" key here.
 */
window.PLANNER_CONFIG = {
  supabaseUrl: 'https://xjcemqvvarzfaunxxkwh.supabase.co',
  supabaseKey: 'sb_publishable_6ALsK-yT4xRGAKg5vwdgJA__j9_VFlj',
};

'use strict';
/**
 * One-time copy of your local events (data/events.json) into Supabase.
 *
 *   1. Fill in docs/config.js (supabaseUrl + supabaseKey).
 *   2. npm run import
 *
 * Safe to run more than once: events are upserted by id (no duplicates).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dataFile = path.join(root, 'data', 'events.json');
const configFile = path.join(root, 'docs', 'config.js');

// Read docs/config.js the same way the browser does (it sets window.PLANNER_CONFIG).
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(configFile, 'utf8'), sandbox);
const { supabaseUrl, supabaseKey } = sandbox.window.PLANNER_CONFIG || {};
if (!supabaseUrl || !supabaseKey) {
  console.error('! Fill in supabaseUrl and supabaseKey in docs/config.js first.');
  process.exit(1);
}

if (!fs.existsSync(dataFile)) {
  console.log(`Nothing to import: ${dataFile} does not exist.`);
  process.exit(0);
}
const events = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
if (!Array.isArray(events) || !events.length) {
  console.log('Nothing to import: no events in data/events.json.');
  process.exit(0);
}

const rows = events.map((e) => ({
  id: e.id,
  title: e.title,
  start_at: e.start,
  end_at: e.end,
  updated_at: e.updatedAt || new Date().toISOString(),
}));

(async () => {
  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/events?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`! Import failed (HTTP ${res.status}): ${await res.text()}`);
    console.error('  Did you run supabase/setup.sql in the Supabase SQL Editor?');
    process.exit(1);
  }
  console.log(`Imported ${rows.length} event(s) into Supabase.`);
})().catch((err) => {
  console.error('! Could not reach Supabase:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Rebuilds data/manifest.json from data/vehicles.json.
 *
 * - Computes the sha256 of the data file.
 * - Bumps `version` ONLY when the data actually changed (idempotent), so
 *   re-running on unchanged data is a no-op and produces no churn.
 * - The app reads manifest.json, compares `version` to what it has cached,
 *   and downloads the new data only when it's higher.
 *
 * Run locally:  node scripts/build-manifest.mjs
 * In CI:        invoked by .github/workflows/update-data.yml
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = join(ROOT, 'data', 'vehicles.json');
const MANIFEST_PATH = join(ROOT, 'data', 'manifest.json');

// Public Pages URL where the app fetches the data from.
const DATA_URL = 'https://support-teamam.github.io/carstory-data/data/vehicles.json';
// Bump this only if the JSON shape changes incompatibly. Older app builds
// ignore remote data whose schema is newer than they understand.
// v2: per-vehicle `scheduleSource` ('generic' for rule-derived schedules) — gates
// out app builds that would mislabel generic data as manufacturer data.
const SCHEMA_VERSION = 2;

const raw = readFileSync(DATA_PATH);
const sha256 = createHash('sha256').update(raw).digest('hex');

let parsed;
try {
  parsed = JSON.parse(raw.toString('utf8'));
} catch (e) {
  console.error('vehicles.json is not valid JSON:', e.message);
  process.exit(1);
}
const vehicleCount = Array.isArray(parsed.vehicles) ? parsed.vehicles.length : 0;
if (vehicleCount === 0) {
  console.error('Refusing to publish: vehicles array is empty.');
  process.exit(1);
}

let prev = null;
if (existsSync(MANIFEST_PATH)) {
  try { prev = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* ignore */ }
}

if (prev && prev.sha256 === sha256 && prev.schema === SCHEMA_VERSION) {
  console.log(`No change (sha256 matches, version ${prev.version}). Nothing to do.`);
  process.exit(0);
}

const manifest = {
  schema: SCHEMA_VERSION,
  version: (prev?.version || 0) + 1,
  url: DATA_URL,
  sha256,
  vehicleCount,
  generatedAt: new Date().toISOString(),
};

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote manifest version ${manifest.version} (${vehicleCount} vehicles, sha256 ${sha256.slice(0, 12)}…).`);

#!/usr/bin/env node
/**
 * Expands data/vehicles.json by adding vehicles that aren't covered yet, each
 * with a maintenance schedule DERIVED FROM GENERIC INTERVAL RULES (not OEM data).
 *
 * Honesty contract:
 *  - Every entry added here carries `scheduleSource: 'generic'`. The app reads
 *    that flag and shows "based on standard schedule" instead of "based on
 *    manufacturer schedule". These intervals are sensible defaults, NOT
 *    manufacturer-specific values.
 *  - Existing entries are NEVER modified. Curated/OEM schedules already in the
 *    file are left exactly as-is (an additive merge). A seed whose make+model+
 *    years already exists is skipped.
 *  - Rules are powertrain-aware: EVs get no oil/spark-plug/engine-air-filter/
 *    transmission items; putting an oil change on a Tesla would be obviously
 *    wrong and destroy trust.
 *
 * Requires schema 2 (see scripts/build-manifest.mjs and the app's
 * SUPPORTED_SCHEMA): app builds older than v2 ignore this data entirely rather
 * than mislabel it.
 *
 * Run:  node scripts/expand-vehicle-db.mjs            # write changes
 *       node scripts/expand-vehicle-db.mjs --dry-run  # report only
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = join(ROOT, 'data', 'vehicles.json');
const DRY_RUN = process.argv.includes('--dry-run');

// --- Generic interval rules, by powertrain --------------------------------
// Mirrors the app's in-code GENERIC_SCHEDULE so a rule-derived entry matches the
// fallback the app would have shown anyway. Conservative on purpose: no
// vehicle-specific high-stakes items (e.g. timing belt) — those vary too much to
// guess safely.
const ICE_GENERIC = [
  { service: 'Oil Change', mileInterval: 5000, monthInterval: 6, estimatedCost: [30, 75], category: 'engine', description: 'Oil and filter replacement' },
  { service: 'Tire Rotation', mileInterval: 7500, monthInterval: 6, estimatedCost: [20, 50], category: 'tires', description: 'Rotate tires for even wear' },
  { service: 'Multi-Point Inspection', mileInterval: 15000, monthInterval: 12, estimatedCost: [0, 50], category: 'inspection', description: 'Comprehensive vehicle inspection' },
  { service: 'Brake Inspection', mileInterval: 20000, monthInterval: 12, estimatedCost: [0, 50], category: 'brakes', description: 'Inspect brake pads, rotors, and lines' },
  { service: 'Air Filter', mileInterval: 20000, monthInterval: 12, estimatedCost: [15, 40], category: 'engine', description: 'Engine air filter replacement' },
  { service: 'Cabin Air Filter', mileInterval: 20000, monthInterval: 12, estimatedCost: [15, 40], category: 'cabin', description: 'Cabin air filter replacement' },
  { service: 'Battery Check', mileInterval: 30000, monthInterval: 24, estimatedCost: [0, 25], category: 'electrical', description: 'Test battery health and terminals' },
  { service: 'Brake Fluid', mileInterval: 30000, monthInterval: 24, estimatedCost: [70, 120], category: 'brakes', description: 'Brake fluid flush and replacement' },
  { service: 'Transmission Fluid', mileInterval: 60000, monthInterval: 48, estimatedCost: [80, 200], category: 'transmission', description: 'Transmission fluid change' },
  { service: 'Coolant', mileInterval: 60000, monthInterval: 48, estimatedCost: [50, 150], category: 'engine', description: 'Coolant flush and replacement' },
  { service: 'Spark Plugs', mileInterval: 60000, monthInterval: 48, estimatedCost: [60, 200], category: 'engine', description: 'Spark plug replacement' },
];

// Most hybrids/PHEVs still have a combustion engine + 12V system, so they use
// the ICE set. (Maintenance-relevant differences are minor at this granularity.)
const HYBRID_GENERIC = ICE_GENERIC;

// Battery-electric: no engine oil, spark plugs, engine air filter, or
// (multi-speed) transmission fluid. Keep what an EV actually needs.
const EV_GENERIC = [
  { service: 'Tire Rotation', mileInterval: 7500, monthInterval: 6, estimatedCost: [20, 50], category: 'tires', description: 'Rotate tires for even wear (EVs wear tires faster)' },
  { service: 'Multi-Point Inspection', mileInterval: 15000, monthInterval: 12, estimatedCost: [0, 50], category: 'inspection', description: 'Comprehensive vehicle inspection' },
  { service: 'Brake Inspection', mileInterval: 20000, monthInterval: 12, estimatedCost: [0, 50], category: 'brakes', description: 'Inspect brakes (regen braking extends pad life)' },
  { service: 'Cabin Air Filter', mileInterval: 20000, monthInterval: 12, estimatedCost: [15, 40], category: 'cabin', description: 'Cabin air filter replacement' },
  { service: 'Brake Fluid', mileInterval: 30000, monthInterval: 24, estimatedCost: [70, 120], category: 'brakes', description: 'Brake fluid flush and replacement' },
  { service: 'Battery/HV System Check', mileInterval: 30000, monthInterval: 24, estimatedCost: [0, 100], category: 'electrical', description: 'High-voltage system and 12V battery check' },
  { service: 'Coolant (Battery/Inverter)', mileInterval: 60000, monthInterval: 48, estimatedCost: [100, 200], category: 'electrical', description: 'Battery and power-electronics coolant service' },
];

const RULES = { ice: ICE_GENERIC, hybrid: HYBRID_GENERIC, ev: EV_GENERIC };

// --- Seed: vehicles to add (curated, US-market, currently missing makes) ----
// Schedules come from RULES[powertrain]; only identity is listed here. Keep
// year ranges/generations conservative. Extend this list to grow coverage.
const SEED = [
  // Volvo
  { make: 'Volvo', model: 'S60', years: '2019-2024', generation: '3rd Gen', powertrain: 'ice' },
  { make: 'Volvo', model: 'S90', years: '2017-2024', generation: '2nd Gen', powertrain: 'ice' },
  { make: 'Volvo', model: 'V60', years: '2019-2024', generation: '2nd Gen', powertrain: 'ice' },
  { make: 'Volvo', model: 'XC40', years: '2019-2024', generation: '1st Gen', powertrain: 'ice' },
  { make: 'Volvo', model: 'XC60', years: '2018-2024', generation: '2nd Gen', powertrain: 'ice' },
  { make: 'Volvo', model: 'XC90', years: '2016-2024', generation: '2nd Gen', powertrain: 'ice' },
  { make: 'Volvo', model: 'C40 Recharge', years: '2022-2024', generation: '1st Gen', powertrain: 'ev' },
  { make: 'Volvo', model: 'EX30', years: '2024-2025', generation: '1st Gen', powertrain: 'ev' },
  { make: 'Volvo', model: 'EX90', years: '2025-2025', generation: '1st Gen', powertrain: 'ev' },

  // MINI
  { make: 'MINI', model: 'Cooper Hardtop', years: '2014-2024', generation: '3rd Gen (F56)', powertrain: 'ice' },
  { make: 'MINI', model: 'Countryman', years: '2017-2024', generation: '2nd Gen (F60)', powertrain: 'ice' },
  { make: 'MINI', model: 'Clubman', years: '2016-2024', generation: '2nd Gen (F54)', powertrain: 'ice' },
  { make: 'MINI', model: 'Cooper SE', years: '2020-2024', generation: 'F56 (electric)', powertrain: 'ev' },

  // Fiat
  { make: 'Fiat', model: '500', years: '2012-2019', generation: '2nd Gen', powertrain: 'ice' },
  { make: 'Fiat', model: '500X', years: '2016-2023', generation: '1st Gen', powertrain: 'ice' },
  { make: 'Fiat', model: '500e', years: '2024-2025', generation: '3rd Gen (electric)', powertrain: 'ev' },

  // Alfa Romeo
  { make: 'Alfa Romeo', model: 'Giulia', years: '2017-2024', generation: '952', powertrain: 'ice' },
  { make: 'Alfa Romeo', model: 'Stelvio', years: '2018-2024', generation: '949', powertrain: 'ice' },

  // Lucid
  { make: 'Lucid', model: 'Air', years: '2021-2024', generation: '1st Gen', powertrain: 'ev' },
  { make: 'Lucid', model: 'Gravity', years: '2025-2025', generation: '1st Gen', powertrain: 'ev' },

  // Maserati
  { make: 'Maserati', model: 'Ghibli', years: '2014-2024', generation: 'M157', powertrain: 'ice' },
  { make: 'Maserati', model: 'Levante', years: '2017-2024', generation: '1st Gen', powertrain: 'ice' },
];

// --- Merge -----------------------------------------------------------------
const db = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
if (!Array.isArray(db.vehicles)) {
  console.error('vehicles.json missing a `vehicles` array.');
  process.exit(1);
}

const key = (v) => `${v.make}|${v.model}|${v.years}`.toLowerCase();
const existing = new Set(db.vehicles.map(key));

const added = [];
const skipped = [];
for (const seed of SEED) {
  const rule = RULES[seed.powertrain];
  if (!rule) { console.error(`Unknown powertrain "${seed.powertrain}" for ${seed.make} ${seed.model}`); process.exit(1); }
  if (existing.has(key(seed))) { skipped.push(seed); continue; }

  const entry = {
    make: seed.make,
    model: seed.model,
    years: seed.years,
    ...(seed.generation ? { generation: seed.generation } : {}),
    scheduleSource: 'generic',
    // Deep-copy the rule so entries never share mutable schedule arrays.
    schedule: rule.map((s) => ({ ...s, estimatedCost: [...s.estimatedCost] })),
  };
  db.vehicles.push(entry);
  existing.add(key(seed));
  added.push(entry);
}

// --- Validate added entries ------------------------------------------------
const REQUIRED_SVC = ['service', 'mileInterval', 'monthInterval', 'estimatedCost', 'category', 'description'];
for (const v of added) {
  if (!v.make || !v.model || !v.years) { console.error('Invalid entry (identity):', v); process.exit(1); }
  if (!Array.isArray(v.schedule) || v.schedule.length === 0) { console.error('Invalid entry (empty schedule):', v.make, v.model); process.exit(1); }
  for (const s of v.schedule) {
    for (const f of REQUIRED_SVC) if (s[f] === undefined) { console.error(`Missing "${f}" in ${v.make} ${v.model} / ${s.service}`); process.exit(1); }
    if (!Array.isArray(s.estimatedCost) || s.estimatedCost.length !== 2) { console.error(`Bad estimatedCost in ${v.make} ${v.model} / ${s.service}`); process.exit(1); }
  }
}

console.log(`Added ${added.length} vehicle(s); skipped ${skipped.length} already present.`);
if (added.length) console.log('  +', added.map((v) => `${v.make} ${v.model}`).join(', '));
if (skipped.length) console.log('  ~ skipped:', skipped.map((v) => `${v.make} ${v.model}`).join(', '));
console.log(`Total vehicles: ${db.vehicles.length}`);

if (DRY_RUN) {
  console.log('Dry run — no file written.');
} else if (added.length) {
  // Match the file's existing 2-space formatting so the diff is only the new
  // entries, not a whole-file reformat.
  writeFileSync(DATA_PATH, JSON.stringify(db, null, 2) + '\n');
  console.log('Wrote data/vehicles.json. Next: node scripts/build-manifest.mjs');
} else {
  console.log('Nothing to write.');
}

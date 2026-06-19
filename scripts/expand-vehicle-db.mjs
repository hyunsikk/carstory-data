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

  // ---- Gap-fill batch (generic schedules) — added 2026-06-19 ----
  // Acura
  { make: 'Acura', model: 'EL', years: '1997-2005', powertrain: 'ice' },
  { make: 'Acura', model: 'SLX', years: '1996-1999', powertrain: 'ice' },
  { make: 'Acura', model: 'ADX', years: '2025-2025', powertrain: 'ice' },

  // Audi
  { make: 'Audi', model: 'A4 allroad', years: '2013-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'A6 allroad', years: '2001-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'allroad', years: '2001-2005', powertrain: 'ice' },
  { make: 'Audi', model: '100', years: '1989-1994', powertrain: 'ice' },
  { make: 'Audi', model: '200', years: '1989-1991', powertrain: 'ice' },
  { make: 'Audi', model: '80', years: '1988-1992', powertrain: 'ice' },
  { make: 'Audi', model: '90', years: '1993-1995', powertrain: 'ice' },
  { make: 'Audi', model: 'Cabriolet', years: '1994-1998', powertrain: 'ice' },
  { make: 'Audi', model: 'S3', years: '2015-2020', powertrain: 'ice' },
  { make: 'Audi', model: 'S4', years: '2000-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'S5', years: '2008-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'S6', years: '2002-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'S7', years: '2013-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'S8', years: '2001-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'SQ5', years: '2014-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'SQ7', years: '2020-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'SQ8', years: '2020-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'Q4 e-tron', years: '2022-2025', powertrain: 'ev' },
  { make: 'Audi', model: 'Q8 e-tron', years: '2024-2025', powertrain: 'ev' },
  { make: 'Audi', model: 'RS3', years: '2017-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'RS5', years: '2013-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'RS6', years: '2003-2025', powertrain: 'ice' },
  { make: 'Audi', model: 'RS7', years: '2014-2025', powertrain: 'ice' },

  // BMW
  { make: 'BMW', model: '1 Series', years: '2008-2013', powertrain: 'ice' },
  { make: 'BMW', model: '2 Series', years: '2014-2025', powertrain: 'ice' },
  { make: 'BMW', model: '4 Series', years: '2014-2025', powertrain: 'ice' },
  { make: 'BMW', model: '6 Series', years: '2004-2019', powertrain: 'ice' },
  { make: 'BMW', model: '8 Series', years: '1991-1997', powertrain: 'ice' },
  { make: 'BMW', model: 'M2', years: '2016-2025', powertrain: 'ice' },
  { make: 'BMW', model: 'M4', years: '2015-2025', powertrain: 'ice' },
  { make: 'BMW', model: 'M6', years: '2006-2018', powertrain: 'ice' },
  { make: 'BMW', model: 'M8', years: '2020-2025', powertrain: 'ice' },
  { make: 'BMW', model: 'X2', years: '2018-2025', powertrain: 'ice' },
  { make: 'BMW', model: 'X4', years: '2015-2025', powertrain: 'ice' },
  { make: 'BMW', model: 'X6', years: '2008-2025', powertrain: 'ice' },
  { make: 'BMW', model: 'i5', years: '2024-2025', powertrain: 'ev' },
  { make: 'BMW', model: 'i7', years: '2023-2025', powertrain: 'ev' },
  { make: 'BMW', model: 'i8', years: '2014-2020', powertrain: 'hybrid' },
  { make: 'BMW', model: 'iX1', years: '2024-2025', powertrain: 'ev' },
  { make: 'BMW', model: 'Z8', years: '2000-2003', powertrain: 'ice' },

  // Buick
  { make: 'Buick', model: 'Cascada', years: '2016-2019', powertrain: 'ice' },
  { make: 'Buick', model: 'Envista', years: '2024-2025', powertrain: 'ice' },
  { make: 'Buick', model: 'Roadmaster', years: '1991-1996', powertrain: 'ice' },
  { make: 'Buick', model: 'Terraza', years: '2005-2007', powertrain: 'ice' },

  // Cadillac
  { make: 'Cadillac', model: 'BLS', years: '2006-2009', powertrain: 'ice' },
  { make: 'Cadillac', model: 'ELR', years: '2014-2016', powertrain: 'hybrid' },
  { make: 'Cadillac', model: 'Optiq', years: '2025-2025', powertrain: 'ev' },
  { make: 'Cadillac', model: 'Vistiq', years: '2026-2026', powertrain: 'ev' },
  { make: 'Cadillac', model: 'Brougham', years: '1987-1992', powertrain: 'ice' },

  // Chevrolet
  { make: 'Chevrolet', model: 'Astro', years: '1985-2005', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Avalanche', years: '2002-2013', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Aveo', years: '2004-2011', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Beretta', years: '1988-1996', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Blazer', years: '1995-2005', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Blazer EV', years: '2024-2025', powertrain: 'ev' },
  { make: 'Chevrolet', model: 'Captiva', years: '2012-2015', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Cavalier', years: '1995-2005', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Cobalt', years: '2005-2010', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Corsica', years: '1988-1996', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Equinox EV', years: '2024-2025', powertrain: 'ev' },
  { make: 'Chevrolet', model: 'Express', years: '1996-2025', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'HHR', years: '2006-2011', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Lumina', years: '1990-2001', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Metro', years: '1998-2001', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Monte Carlo', years: '1995-2007', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Prizm', years: '1998-2002', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'S-10', years: '1994-2004', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'SS', years: '2014-2017', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'SSR', years: '2003-2006', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Silverado EV', years: '2024-2025', powertrain: 'ev' },
  { make: 'Chevrolet', model: 'Tracker', years: '1998-2004', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'TrailBlazer', years: '2002-2025', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Trax', years: '2015-2025', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Uplander', years: '2005-2008', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Venture', years: '1997-2005', powertrain: 'ice' },
  { make: 'Chevrolet', model: 'Volt', years: '2011-2019', powertrain: 'hybrid' },

  // Chrysler
  { make: 'Chrysler', model: 'Aspen', years: '2007-2009', powertrain: 'ice' },
  { make: 'Chrysler', model: 'Cirrus', years: '1995-2000', powertrain: 'ice' },
  { make: 'Chrysler', model: 'Imperial', years: '1990-1993', powertrain: 'ice' },
  { make: 'Chrysler', model: 'LHS', years: '1994-2001', powertrain: 'ice' },
  { make: 'Chrysler', model: 'New Yorker', years: '1988-1996', powertrain: 'ice' },
  { make: 'Chrysler', model: 'Voyager', years: '2000-2025', powertrain: 'ice' },

  // Dodge
  { make: 'Dodge', model: 'Hornet', years: '2023-2025', powertrain: 'ice' },
  { make: 'Dodge', model: 'Intrepid', years: '1993-2004', powertrain: 'ice' },
  { make: 'Dodge', model: 'Magnum', years: '2005-2008', powertrain: 'ice' },
  { make: 'Dodge', model: 'Ram 1500', years: '1994-2009', powertrain: 'ice' },
  { make: 'Dodge', model: 'Ram 2500', years: '1994-2009', powertrain: 'ice' },
  { make: 'Dodge', model: 'Spirit', years: '1989-1995', powertrain: 'ice' },
  { make: 'Dodge', model: 'Stealth', years: '1991-1996', powertrain: 'ice' },
  { make: 'Dodge', model: 'Stratus', years: '1995-2006', powertrain: 'ice' },

  // Ford
  { make: 'Ford', model: 'Aerostar', years: '1986-1997', powertrain: 'ice' },
  { make: 'Ford', model: 'Aspire', years: '1994-1997', powertrain: 'ice' },
  { make: 'Ford', model: 'Contour', years: '1995-2000', powertrain: 'ice' },
  { make: 'Ford', model: 'E-Transit', years: '2022-2025', powertrain: 'ev' },
  { make: 'Ford', model: 'EcoSport', years: '2018-2022', powertrain: 'ice' },
  { make: 'Ford', model: 'Escort', years: '1991-2003', powertrain: 'ice' },
  { make: 'Ford', model: 'Excursion', years: '2000-2005', powertrain: 'ice' },
  { make: 'Ford', model: 'Five Hundred', years: '2005-2007', powertrain: 'ice' },
  { make: 'Ford', model: 'Flex', years: '2009-2019', powertrain: 'ice' },
  { make: 'Ford', model: 'Freestar', years: '2004-2007', powertrain: 'ice' },
  { make: 'Ford', model: 'Freestyle', years: '2005-2007', powertrain: 'ice' },
  { make: 'Ford', model: 'Probe', years: '1989-1997', powertrain: 'ice' },
  { make: 'Ford', model: 'Tempo', years: '1984-1994', powertrain: 'ice' },
  { make: 'Ford', model: 'Transit Connect', years: '2010-2023', powertrain: 'ice' },
  { make: 'Ford', model: 'Windstar', years: '1995-2003', powertrain: 'ice' },

  // GMC
  { make: 'GMC', model: 'Hummer EV SUV', years: '2024-2025', powertrain: 'ev' },

  // Honda
  { make: 'Honda', model: 'Crosstour', years: '2010-2015', powertrain: 'ice' },

  // Hyundai
  { make: 'Hyundai', model: 'Equus', years: '2011-2016', powertrain: 'ice' },
  { make: 'Hyundai', model: 'Ioniq', years: '2017-2022', powertrain: 'hybrid' },

  // Infiniti
  { make: 'Infiniti', model: 'G20', years: '1991-2002', powertrain: 'ice' },
  { make: 'Infiniti', model: 'M30', years: '1990-1992', powertrain: 'ice' },
  { make: 'Infiniti', model: 'M37', years: '2011-2013', powertrain: 'ice' },
  { make: 'Infiniti', model: 'M56', years: '2011-2013', powertrain: 'ice' },
  { make: 'Infiniti', model: 'QX30', years: '2017-2019', powertrain: 'ice' },
  { make: 'Infiniti', model: 'QX56', years: '2004-2013', powertrain: 'ice' },
  { make: 'Infiniti', model: 'QX70', years: '2014-2017', powertrain: 'ice' },

  // Jaguar
  { make: 'Jaguar', model: 'I-PACE', years: '2019-2025', powertrain: 'ev' },
  { make: 'Jaguar', model: 'S-Type', years: '2000-2008', powertrain: 'ice' },
  { make: 'Jaguar', model: 'X-Type', years: '2002-2008', powertrain: 'ice' },
  { make: 'Jaguar', model: 'XK', years: '2007-2015', powertrain: 'ice' },

  // Jeep
  { make: 'Jeep', model: 'Comanche', years: '1986-1992', powertrain: 'ice' },
  { make: 'Jeep', model: 'Commander', years: '2006-2010', powertrain: 'ice' },
  { make: 'Jeep', model: 'Grand Wagoneer', years: '2022-2025', powertrain: 'ice' },
  { make: 'Jeep', model: 'Patriot', years: '2007-2017', powertrain: 'ice' },
  { make: 'Jeep', model: 'Wagoneer', years: '2022-2025', powertrain: 'ice' },
  { make: 'Jeep', model: 'Wrangler 4xe', years: '2021-2025', powertrain: 'hybrid' },

  // Kia
  { make: 'Kia', model: 'K900', years: '2015-2020', powertrain: 'ice' },

  // Land Rover
  { make: 'Land Rover', model: 'Defender', years: '2020-2025', powertrain: 'ice' },
  { make: 'Land Rover', model: 'Freelander', years: '2002-2005', powertrain: 'ice' },
  { make: 'Land Rover', model: 'LR2', years: '2008-2015', powertrain: 'ice' },
  { make: 'Land Rover', model: 'LR3', years: '2005-2009', powertrain: 'ice' },
  { make: 'Land Rover', model: 'LR4', years: '2010-2016', powertrain: 'ice' },

  // Lexus
  { make: 'Lexus', model: 'GS F', years: '2016-2020', powertrain: 'ice' },
  { make: 'Lexus', model: 'RC F', years: '2015-2025', powertrain: 'ice' },

  // Mazda
  { make: 'Mazda', model: '626', years: '1988-2002', powertrain: 'ice' },
  { make: 'Mazda', model: '929', years: '1988-1995', powertrain: 'ice' },
  { make: 'Mazda', model: 'B-Series', years: '1994-2009', powertrain: 'ice' },
  { make: 'Mazda', model: 'CX-3', years: '2016-2021', powertrain: 'ice' },
  { make: 'Mazda', model: 'CX-7', years: '2007-2012', powertrain: 'ice' },
  { make: 'Mazda', model: 'MPV', years: '1989-2006', powertrain: 'ice' },
  { make: 'Mazda', model: 'Millenia', years: '1995-2002', powertrain: 'ice' },
  { make: 'Mazda', model: 'Protege', years: '1990-2003', powertrain: 'ice' },
  { make: 'Mazda', model: 'Tribute', years: '2001-2011', powertrain: 'ice' },
  { make: 'Mazda', model: 'MX-30', years: '2022-2023', powertrain: 'ev' },

  // Mercedes-Benz
  { make: 'Mercedes-Benz', model: '190', years: '1984-1993', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'B-Class', years: '2014-2017', powertrain: 'ev' },
  { make: 'Mercedes-Benz', model: 'GLK', years: '2010-2015', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'GL-Class', years: '2007-2016', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'M-Class', years: '1998-2015', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'R-Class', years: '2006-2012', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'SLK', years: '1998-2016', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'SLC', years: '2017-2020', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'SLS AMG', years: '2011-2015', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'CLK', years: '1998-2009', powertrain: 'ice' },
  { make: 'Mercedes-Benz', model: 'EQE SUV', years: '2023-2025', powertrain: 'ev' },
  { make: 'Mercedes-Benz', model: 'EQS SUV', years: '2023-2025', powertrain: 'ev' },
  { make: 'Mercedes-Benz', model: 'Metris', years: '2016-2023', powertrain: 'ice' },

  // Mercury
  { make: 'Mercury', model: 'Marauder', years: '2003-2004', powertrain: 'ice' },
  { make: 'Mercury', model: 'Mystique', years: '1995-2000', powertrain: 'ice' },
  { make: 'Mercury', model: 'Monterey', years: '2004-2007', powertrain: 'ice' },
  { make: 'Mercury', model: 'Topaz', years: '1984-1994', powertrain: 'ice' },
  { make: 'Mercury', model: 'Tracer', years: '1991-1999', powertrain: 'ice' },
  { make: 'Mercury', model: 'Marquis', years: '1983-1986', powertrain: 'ice' },

  // Mitsubishi
  { make: 'Mitsubishi', model: 'Montero Sport', years: '1997-2004', powertrain: 'ice' },
  { make: 'Mitsubishi', model: 'Mighty Max', years: '1987-1996', powertrain: 'ice' },

  // Nissan
  { make: 'Nissan', model: '200SX', years: '1995-1998', powertrain: 'ice' },
  { make: 'Nissan', model: '240SX', years: '1989-1998', powertrain: 'ice' },
  { make: 'Nissan', model: 'Cube', years: '2009-2014', powertrain: 'ice' },
  { make: 'Nissan', model: 'Juke', years: '2011-2017', powertrain: 'ice' },
  { make: 'Nissan', model: 'NV200', years: '2013-2021', powertrain: 'ice' },
  { make: 'Nissan', model: 'Pulsar', years: '1987-1990', powertrain: 'ice' },
  { make: 'Nissan', model: 'Quest', years: '1993-2017', powertrain: 'ice' },
  { make: 'Nissan', model: 'Stanza', years: '1987-1992', powertrain: 'ice' },
  { make: 'Nissan', model: 'Xterra', years: '2000-2015', powertrain: 'ice' },
  { make: 'Nissan', model: 'NV', years: '2012-2021', powertrain: 'ice' },

  // Oldsmobile
  { make: 'Oldsmobile', model: '88', years: '1987-1999', powertrain: 'ice' },
  { make: 'Oldsmobile', model: '98', years: '1987-1996', powertrain: 'ice' },
  { make: 'Oldsmobile', model: 'Achieva', years: '1992-1998', powertrain: 'ice' },
  { make: 'Oldsmobile', model: 'Ciera', years: '1989-1996', powertrain: 'ice' },

  // Plymouth
  { make: 'Plymouth', model: 'Grand Voyager', years: '1990-2000', powertrain: 'ice' },

  // Pontiac
  { make: 'Pontiac', model: '6000', years: '1987-1991', powertrain: 'ice' },
  { make: 'Pontiac', model: 'Fiero', years: '1984-1988', powertrain: 'ice' },
  { make: 'Pontiac', model: 'G3', years: '2009-2010', powertrain: 'ice' },
  { make: 'Pontiac', model: 'G5', years: '2007-2010', powertrain: 'ice' },
  { make: 'Pontiac', model: 'Montana', years: '1999-2006', powertrain: 'ice' },
  { make: 'Pontiac', model: 'Sunbird', years: '1988-1994', powertrain: 'ice' },
  { make: 'Pontiac', model: 'Torrent', years: '2006-2009', powertrain: 'ice' },
  { make: 'Pontiac', model: 'Trans Sport', years: '1990-1998', powertrain: 'ice' },

  // Porsche
  { make: 'Porsche', model: 'Carrera GT', years: '2004-2006', powertrain: 'ice' },

  // Saturn
  { make: 'Saturn', model: 'Astra', years: '2008-2009', powertrain: 'ice' },
  { make: 'Saturn', model: 'Relay', years: '2005-2007', powertrain: 'ice' },

  // Subaru
  { make: 'Subaru', model: 'Baja', years: '2003-2006', powertrain: 'ice' },
  { make: 'Subaru', model: 'SVX', years: '1992-1997', powertrain: 'ice' },
  { make: 'Subaru', model: 'Tribeca', years: '2006-2014', powertrain: 'ice' },

  // Suzuki
  { make: 'Suzuki', model: 'Aerio', years: '2002-2007', powertrain: 'ice' },
  { make: 'Suzuki', model: 'Esteem', years: '1995-2002', powertrain: 'ice' },
  { make: 'Suzuki', model: 'Forenza', years: '2004-2008', powertrain: 'ice' },
  { make: 'Suzuki', model: 'Reno', years: '2005-2008', powertrain: 'ice' },
  { make: 'Suzuki', model: 'Verona', years: '2004-2006', powertrain: 'ice' },
  { make: 'Suzuki', model: 'Vitara', years: '1999-2004', powertrain: 'ice' },

  // Toyota
  { make: 'Toyota', model: 'Corolla Cross', years: '2022-2025', powertrain: 'ice' },
  { make: 'Toyota', model: 'Cressida', years: '1988-1992', powertrain: 'ice' },
  { make: 'Toyota', model: 'GR Supra', years: '2020-2025', powertrain: 'ice' },
  { make: 'Toyota', model: 'Grand Highlander', years: '2024-2025', powertrain: 'ice' },
  { make: 'Toyota', model: 'Mirai', years: '2016-2025', powertrain: 'ev' },
  { make: 'Toyota', model: 'Prius C', years: '2012-2019', powertrain: 'hybrid' },
  { make: 'Toyota', model: 'Prius V', years: '2012-2017', powertrain: 'hybrid' },
  { make: 'Toyota', model: 'Prius Prime', years: '2017-2025', powertrain: 'hybrid' },

  // Volkswagen
  { make: 'Volkswagen', model: 'Arteon', years: '2019-2023', powertrain: 'ice' },
  { make: 'Volkswagen', model: 'Atlas Cross Sport', years: '2020-2025', powertrain: 'ice' },
  { make: 'Volkswagen', model: 'CC', years: '2009-2017', powertrain: 'ice' },
  { make: 'Volkswagen', model: 'Cabrio', years: '1995-2002', powertrain: 'ice' },
  { make: 'Volkswagen', model: 'Eos', years: '2007-2016', powertrain: 'ice' },
  { make: 'Volkswagen', model: 'Golf R', years: '2012-2025', powertrain: 'ice' },
  { make: 'Volkswagen', model: 'ID.Buzz', years: '2025-2025', powertrain: 'ev' },
  { make: 'Volkswagen', model: 'Phaeton', years: '2004-2006', powertrain: 'ice' },
  { make: 'Volkswagen', model: 'Rabbit', years: '2006-2009', powertrain: 'ice' },
  { make: 'Volkswagen', model: 'Routan', years: '2009-2014', powertrain: 'ice' },

  // Volvo
  { make: 'Volvo', model: 'C30', years: '2008-2013', powertrain: 'ice' },
  { make: 'Volvo', model: 'C70', years: '1998-2013', powertrain: 'ice' },
  { make: 'Volvo', model: 'S60 Recharge', years: '2020-2025', powertrain: 'hybrid' },
  { make: 'Volvo', model: 'V90', years: '2017-2025', powertrain: 'ice' },

  // Saab
  { make: 'Saab', model: '9-3', years: '1999-2011', powertrain: 'ice' },
  { make: 'Saab', model: '9-5', years: '1999-2011', powertrain: 'ice' },
  { make: 'Saab', model: '9-7X', years: '2005-2009', powertrain: 'ice' },
  { make: 'Saab', model: '900', years: '1986-1998', powertrain: 'ice' },
  { make: 'Saab', model: '9000', years: '1986-1998', powertrain: 'ice' },

  // Isuzu
  { make: 'Isuzu', model: 'Amigo', years: '1989-2000', powertrain: 'ice' },
  { make: 'Isuzu', model: 'Ascender', years: '2003-2008', powertrain: 'ice' },
  { make: 'Isuzu', model: 'Axiom', years: '2002-2004', powertrain: 'ice' },
  { make: 'Isuzu', model: 'Hombre', years: '1996-2000', powertrain: 'ice' },
  { make: 'Isuzu', model: 'Rodeo', years: '1991-2004', powertrain: 'ice' },
  { make: 'Isuzu', model: 'Trooper', years: '1986-2002', powertrain: 'ice' },
  { make: 'Isuzu', model: 'VehiCROSS', years: '1999-2001', powertrain: 'ice' },
  { make: 'Isuzu', model: 'i-Series', years: '2006-2008', powertrain: 'ice' },

  // Geo
  { make: 'Geo', model: 'Metro', years: '1989-1997', powertrain: 'ice' },
  { make: 'Geo', model: 'Prizm', years: '1990-1997', powertrain: 'ice' },
  { make: 'Geo', model: 'Storm', years: '1990-1993', powertrain: 'ice' },
  { make: 'Geo', model: 'Tracker', years: '1989-1997', powertrain: 'ice' },

  // Daewoo
  { make: 'Daewoo', model: 'Lanos', years: '1999-2002', powertrain: 'ice' },
  { make: 'Daewoo', model: 'Leganza', years: '1999-2002', powertrain: 'ice' },
  { make: 'Daewoo', model: 'Nubira', years: '1999-2002', powertrain: 'ice' },

  // smart
  { make: 'smart', model: 'fortwo', years: '2008-2019', powertrain: 'ice' },

  // Fisker
  { make: 'Fisker', model: 'Karma', years: '2012-2012', powertrain: 'hybrid' },
  { make: 'Fisker', model: 'Ocean', years: '2023-2024', powertrain: 'ev' },

  // VinFast
  { make: 'VinFast', model: 'VF 8', years: '2023-2025', powertrain: 'ev' },
  { make: 'VinFast', model: 'VF 9', years: '2024-2025', powertrain: 'ev' },

  // Lotus
  { make: 'Lotus', model: 'Elise', years: '2005-2011', powertrain: 'ice' },
  { make: 'Lotus', model: 'Evora', years: '2010-2021', powertrain: 'ice' },
  { make: 'Lotus', model: 'Exige', years: '2006-2011', powertrain: 'ice' },
  { make: 'Lotus', model: 'Emira', years: '2023-2025', powertrain: 'ice' },
  { make: 'Lotus', model: 'Eletre', years: '2024-2025', powertrain: 'ev' },

  // Bentley
  { make: 'Bentley', model: 'Continental GT', years: '2004-2025', powertrain: 'ice' },
  { make: 'Bentley', model: 'Flying Spur', years: '2006-2025', powertrain: 'ice' },
  { make: 'Bentley', model: 'Bentayga', years: '2017-2025', powertrain: 'ice' },

  // Lamborghini
  { make: 'Lamborghini', model: 'Gallardo', years: '2004-2014', powertrain: 'ice' },
  { make: 'Lamborghini', model: 'Huracan', years: '2015-2025', powertrain: 'ice' },
  { make: 'Lamborghini', model: 'Aventador', years: '2012-2022', powertrain: 'ice' },
  { make: 'Lamborghini', model: 'Urus', years: '2018-2025', powertrain: 'ice' },

  // Ferrari
  { make: 'Ferrari', model: '488', years: '2016-2020', powertrain: 'ice' },
  { make: 'Ferrari', model: 'F8 Tributo', years: '2020-2023', powertrain: 'ice' },
  { make: 'Ferrari', model: 'Roma', years: '2021-2025', powertrain: 'ice' },
  { make: 'Ferrari', model: 'Portofino', years: '2018-2023', powertrain: 'ice' },

  // Aston Martin
  { make: 'Aston Martin', model: 'Vantage', years: '2006-2025', powertrain: 'ice' },
  { make: 'Aston Martin', model: 'DB11', years: '2017-2023', powertrain: 'ice' },
  { make: 'Aston Martin', model: 'DBS', years: '2008-2025', powertrain: 'ice' },
  { make: 'Aston Martin', model: 'DBX', years: '2021-2025', powertrain: 'ice' },

  // McLaren
  { make: 'McLaren', model: '570S', years: '2016-2021', powertrain: 'ice' },
  { make: 'McLaren', model: '720S', years: '2018-2023', powertrain: 'ice' },
  { make: 'McLaren', model: 'Artura', years: '2022-2025', powertrain: 'hybrid' },

  // Maserati
  { make: 'Maserati', model: 'GranTurismo', years: '2008-2025', powertrain: 'ice' },
  { make: 'Maserati', model: 'Quattroporte', years: '2005-2025', powertrain: 'ice' },
  { make: 'Maserati', model: 'Grecale', years: '2023-2025', powertrain: 'ice' },
  { make: 'Maserati', model: 'MC20', years: '2022-2025', powertrain: 'ice' },

  // Alfa Romeo
  { make: 'Alfa Romeo', model: '4C', years: '2015-2020', powertrain: 'ice' },
  { make: 'Alfa Romeo', model: 'Tonale', years: '2024-2025', powertrain: 'hybrid' },

  // Scion
  { make: 'Scion', model: 'xA', years: '2004-2006', powertrain: 'ice' },
  { make: 'Scion', model: 'iQ', years: '2012-2015', powertrain: 'ice' },

  // Hummer
  { make: 'Hummer', model: 'H3T', years: '2009-2010', powertrain: 'ice' },
];

// --- Merge -----------------------------------------------------------------
const db = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
if (!Array.isArray(db.vehicles)) {
  console.error('vehicles.json missing a `vehicles` array.');
  process.exit(1);
}

// Dedup at make+model (NOT make+model+years): if any year range of a model is
// already covered, don't add a generic duplicate of it — the app matches a
// schedule by make+model and would shadow our generic entry with the existing
// one anyway, leaving dead, search-polluting rows.
const key = (v) => `${v.make}|${v.model}`.toLowerCase();
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

---
name: expand-vehicle-db
description: Expand the Car Story vehicle database (data/vehicles.json) by adding vehicles with generic-rule-derived maintenance schedules, then validate and publish to GitHub Pages so the app picks them up. Use when asked to add cars/makes/models to the database, grow vehicle coverage, or "expand the vehicle DB / jsons".
---

# Expand the vehicle database

Adds vehicles to `data/vehicles.json` with maintenance schedules **derived from
generic interval rules (not OEM data)**, validates the result, and publishes it
via the `carstory-data` GitHub Pages site so the Car Story app fetches it without
an App Store release.

All work happens in the **`carstory-data` repo** (`github.com/support-teamam/carstory-data`),
which holds `scripts/expand-vehicle-db.mjs`, `scripts/build-manifest.mjs`, and
`data/vehicles.json`. If the current directory isn't that repo, locate it
(commonly `~/Desktop/TeamAM/carstory-data`) or clone it, and `cd` in before
running the steps below.

## Non-negotiable rules

- **Generic ≠ OEM.** Every vehicle this skill adds carries `scheduleSource: 'generic'`.
  Never present generic intervals as manufacturer data. Never invent
  vehicle-specific high-stakes intervals (e.g. timing belt) — the generic rule
  sets deliberately omit them.
- **Additive only.** Never modify or overwrite the existing curated/OEM entries.
  Dedup is at **make+model** (not make+model+years): if any year range of a model
  already exists, skip it — adding a generic duplicate creates dead, search-
  polluting rows the app shadows with the existing entry. (This is the bug that
  shipped once; the dedup guard prevents it.)
- **EV-aware.** BEVs must not get Oil Change / Spark Plugs / engine Air Filter /
  multi-speed Transmission Fluid. Set each seed's `powertrain` to `ice`,
  `hybrid`, or `ev` and the script picks the right rule set.
- **Schema 2.** This data is published under manifest `schema: 2`. App builds with
  `SUPPORTED_SCHEMA < 2` ignore it (so they never mislabel generic data). The
  expansion therefore only reaches users **after an app build with the
  `scheduleSource` support ships** — state this when reporting.
- **Confirm before publishing.** Pushing updates the public Pages site. Show the
  diff and the added list, and get explicit confirmation before `git push`.

## Steps

1. **Decide what to add.** If the user named specific vehicles, translate them into
   `SEED` entries in `scripts/expand-vehicle-db.mjs`:
   `{ make, model, years, generation (optional), powertrain: 'ice'|'hybrid'|'ev' }`.
   Only add vehicles genuinely missing — check `data/vehicles.json` first; don't
   assume a make is absent (e.g. Volvo *is* present). Keep year ranges/generations
   conservative; omit `generation` if unsure.

2. **Dry run** and review what would change:
   ```bash
   node scripts/expand-vehicle-db.mjs --dry-run
   ```
   Confirm the "Added" list is what you intend and "skipped" covers anything that
   already exists.

3. **Generate**:
   ```bash
   node scripts/expand-vehicle-db.mjs
   ```

4. **Validate** — this must print `OK` (it exits non-zero on a duplicate or an
   empty schedule):
   ```bash
   node -e "const d=JSON.parse(require('fs').readFileSync('data/vehicles.json','utf8')).vehicles; const oem=new Set(d.filter(v=>v.scheduleSource!=='generic').map(v=>(v.make+'|'+v.model).toLowerCase())); const gen=d.filter(v=>v.scheduleSource==='generic'); const dups=gen.filter(v=>oem.has((v.make+'|'+v.model).toLowerCase())); const empty=gen.filter(v=>!Array.isArray(v.schedule)||v.schedule.length===0); console.log('total',d.length,'| generic',gen.length,'| OEM-dups',dups.length,'| empty',empty.length); if(dups.length||empty.length)process.exit(1); console.log('OK');"
   ```
   Then spot-check by hand: an EV entry has **no** `Oil Change`/`Spark Plugs`; an
   ICE entry **does** have `Oil Change`.

5. **Rebuild the manifest** (bumps `version`, recomputes `sha256`; idempotent):
   ```bash
   node scripts/build-manifest.mjs
   ```

6. **Run the app's load test** if the sibling glovebox repo is checked out — this
   runs the real `vehicleDB` loading path against the new files:
   ```bash
   ( cd ../glovebox/autolog-app && npx jest __tests__/vehicleDB.integration.test.js )
   ```
   It skips cleanly if glovebox isn't present.

7. **Show the diff and confirm**, then publish:
   ```bash
   git add scripts/ data/vehicles.json data/manifest.json
   git commit -m "data: expand vehicle DB (+N generic entries)"
   git push origin main
   ```

8. **Report**: count delta, makes/models added, new manifest version, and the
   reminder that users only get the data after an app release with schema-2
   support.

## To grow coverage repeatedly

Edit the `SEED` array in `scripts/expand-vehicle-db.mjs` and re-run. To use real
OEM schedules instead of generic rules later, feed a source into the script and
drop the `scheduleSource: 'generic'` flag for those entries (and keep schema in
sync).

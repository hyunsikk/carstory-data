# carstory-data

Public reference data and marketing website for **Car Story — Maintenance Log**.

The app source lives in a separate private repo. This repo only holds
non-sensitive, read-only data the app fetches at runtime, plus the static
website. Both are served via GitHub Pages.

## Structure

```
/                     marketing + legal website (index/support/terms/privacy)
data/vehicles.json    OEM maintenance schedules + cost estimates (1004 vehicles)
data/manifest.json    { schema, version, url, sha256, vehicleCount, generatedAt }
scripts/build-manifest.mjs   regenerates manifest.json from vehicles.json
.github/workflows/update-data.yml   keeps the manifest fresh (push + quarterly cron)
```

## How updates reach users

The app ships with a bundled copy of `vehicles.json` as an offline baseline. On
launch (throttled) and via a "Update vehicle database" button it fetches
`data/manifest.json`; if `version` is higher than what it has cached, it
downloads the new `vehicles.json`, verifies the `sha256`, and uses it instead.
So data updates ship **without an App Store release**.

## Updating the data

1. Regenerate / expand `data/vehicles.json` (recalls and VIN are fetched live
   from NHTSA in-app, so they are **not** stored here — only maintenance
   schedules are).
2. Commit it. The workflow recomputes `manifest.json` (bumps `version`, updates
   `sha256`) and commits that too. GitHub Pages redeploys automatically.

`version` only bumps when the data actually changes — re-running is a no-op.

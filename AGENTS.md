# AGENTS.md

## Cursor Cloud specific instructions

This repository is an **Adobe Photoshop automation project** (UXP JavaScript + classic
ExtendScript). It ships one pipeline in three forms under `photoshop-clothes-import/`:

- `scripts/ImportAsRasterLayers.psjs` — modern UXP one-shot script (Photoshop 23.5+)
- `scripts/ImportAsRasterLayers.jsx` — classic ExtendScript drop-in
- `plugin/` — UXP panel scaffold (loaded via Adobe UXP Developer Tool)

See `README.md` and `photoshop-clothes-import/docs/` for the full workflow, rules, and
manual acceptance checklist.

### What this environment can and cannot do

- **There is no build / lint / test / dependency tooling.** No `package.json`, lockfile,
  `Makefile`, or CI config exists. Nothing needs to be installed; the update script is a
  no-op runtime check.
- **The product cannot run end-to-end in this headless Linux VM.** All code executes
  *inside* the Adobe Photoshop desktop app (a GUI Windows/macOS install with a master PSD
  open). There are no servers/dev commands to start here.
- Real usage is manual, inside Photoshop: `File → Scripts → Browse…` for the `.psjs`/`.jsx`
  scripts, or load `plugin/manifest.json` via the UXP Developer Tool. Camera Raw prefs must
  be set per `docs/CAMERA-RAW-SETUP.md` for stable JPEG/TIFF batches.

### How to validate changes without Photoshop

Node.js is preinstalled and is the only available way to sanity-check the source:

- JSON: `node -e "JSON.parse(require('fs').readFileSync('photoshop-clothes-import/plugin/manifest.json','utf8'))"`
- Syntax of the UXP JS (`.psjs` / `plugin/main.js`): copy to a `.js` file first, then
  `node --check` (Node's `--check` rejects the `.psjs` extension itself, not the code).
- **`ImportAsRasterLayers.jsx` is ExtendScript (ES3) and starts with the `#target photoshop`
  directive.** Standard JS parsers (`node --check`, ESLint) will reject `#target` — that is
  expected and not a bug; do not "fix" it.
- To exercise the panel/script pipeline logic headlessly, mock the `photoshop` and `uxp`
  modules (and the DOM for the panel) and run the file — the Photoshop APIs
  (`app.open`, `duplicateLayers`, `createLayerGroup`, `closeWithoutSaving`, etc.) are the
  only external dependencies.

# Research notes: Photoshop automation for clothes retouch import (2025–2026)

Sources checked before designing the MVP (July 2026):

## Official Adobe docs

| Topic | Finding | Source |
| --- | --- | --- |
| UXP Document DOM | `app.open(entry)`, `duplicateLayers(layers, targetDoc)`, `mergeVisibleLayers()`, `closeWithoutSaving()`, `createLayerGroup()`, `createPixelLayer()` are documented and available | [Document API](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/document/) |
| Layer transfer | Prefer DOM `document.duplicateLayers([...], targetDocument)` / `layer.duplicate(targetDocument)` over Place Embedded/Linked | same |
| Modal execution | Any state-changing call must run inside `core.executeAsModal(...)` | [executeAsModal](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal) |
| batchPlay | Evolution of ExtendScript `executeAction`; use only when DOM is missing | [batchPlay](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/batchplay) |
| UXP scripting (.psjs) | Available since Photoshop 23.5; File → Scripts → Browse; no panel UI; limited module permissions; code reusable in plugins | [UXP Scripting](https://developer.adobe.com/photoshop/uxp/scripting/) |
| ExtendScript | Still supported for automation; ES3; not deprecated for scripts; Adobe keeps UXP and ExtendScript separate (no supported “run JSX from UXP”) | Adobe forums Jul 2025; Mapsoft 2026 overview |
| File picker | `localFileSystem.getFileForOpening({ allowMultiple: true, types: [...] })`; pass File entry to `app.open` (Photoshop converts to session token) | [FileSystemProvider](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/modules/uxp/persistent-file-storage/file-system-provider) |
| Layer kinds | `LayerKind.SMARTOBJECT` exists; `layer.rasterize()` converts to flat pixels | [Layer](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer), [Constants](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants) |

## Practice / community

| Pattern | Finding |
| --- | --- |
| Classic JSX import | Open → merge visible → `layer.duplicate(targetDoc)` → `close(DONOTSAVECHANGES)` — used for years (e.g. Morris “Import Folder as Layers”) |
| Avoid Place | Place Embedded / Place Linked / `newPlacedLayer` create Smart Objects — forbidden for this workflow |
| Camera Raw prefs | JPEG/TIFF can open via ACR if File Handling prefs say so; RAW/DNG always go through ACR pipeline |
| ACR + Smart Object | ACR workflow option “Open in Photoshop as Smart Objects” can produce SO layers even without Place |
| Script open + ACR | Interactive ACR dialog can block batch scripts; Adobe’s own stack scripts temporarily tweak CamRaw JPEG preference flags — fragile / version-sensitive |

## Format risk matrix (for this tool)

| Format | Typical open path | Risk for “plain pixel layer” | Recommendation |
| --- | --- | --- | --- |
| JPEG / PNG | Direct document open (unless ACR JPEG support enabled) | Low–medium | Allow; prefer open→merge/duplicate, never Place |
| TIFF | May open in ACR if prefs / CRS metadata say so | Medium | Allow with warning; disable ACR JPEG/TIFF support in prefs for production machines |
| PSD / PSB | Native Photoshop document | Low for pixel result if we merge or pick a pixel layer | Allow; use merge or top pixel layer modes |
| RAW / DNG / NEF / CR2 / ARW | Always Camera Raw | High (dialog + possible Smart Object open) | **Exclude from MVP** or require pre-export to JPEG/TIFF/PSD |

## Uncertainty (stated explicitly)

1. There is **no documented, stable public UXP API** to permanently change Camera Raw “JPEG/TIFF Handling” prefs from a script the way old CS3 hacks did. Treat ACR prefs as an **operator/environment constraint**, not something the MVP silently rewrites.
2. Whether `app.open(entry)` on a JPEG with “Automatically open all supported JPEGs” shows an interactive ACR dialog in headless/modal UXP runs is **environment-dependent**. Production machines should set JPEG/TIFF Handling to **Disable … Support**.
3. UXP DOM coverage is still incomplete vs ExtendScript for niche features; for this import path the documented DOM methods are sufficient — batchPlay is a fallback, not the primary path.
4. Adobe staff (Jul 2025) stated there is **no supported method** to invoke `.jsx` from a UXP plugin; keep stacks separate or rewrite logic in UXP.

## Conclusion used for architecture

Safe production path for clothes retouch:

1. Open source file as a **document** (`app.open` / JSX `open`).
2. Build a **normal pixel ArtLayer** inside that document (merge visible, or select existing pixel layer; rasterize if needed).
3. **`duplicate` / `duplicateLayers` into the master PSD**.
4. Close source with **no save**.
5. Never call Place Embedded, Place Linked, or Convert to Smart Object.

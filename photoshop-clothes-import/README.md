# Clothes Retouch — Import as Raster Layers (Photoshop 2026)

Practical automation for apparel retouchers: pull many source photos into **one master PSD** as **ordinary pixel layers**, then auto-close the sources.

**Never** Place Embedded / Place Linked / Smart Object.

## Quick start (fastest for production)

1. Open the master PSD.
2. Run either:
   - `scripts/ImportAsRasterLayers.psjs` — modern UXP script (Photoshop 23.5+)
   - `scripts/ImportAsRasterLayers.jsx` — classic ExtendScript (drop-in, zero tooling)
3. Pick JPEG/PNG/TIFF/PSD/PSB sources.
4. Each file opens → content becomes a **normal layer** named after the file → source closes.
5. Only the master PSD remains.

Optional UXP panel scaffold: `plugin/` (load with UXP Developer Tool).

## Why this stack

| Goal | Recommendation |
| --- | --- |
| Ship to retoucher **today** | **JSX** or **`.psjs`** script |
| Scale to a studio tool (modes, log, progress UI) | **UXP plugin** reusing the same open→duplicate pipeline |
| Avoid Camera Raw / SO traps | Open as document + `duplicateLayers` / `ArtLayer.duplicate` — never Place |

Full research notes: [`docs/RESEARCH-2026.md`](docs/RESEARCH-2026.md)  
Architecture & modes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)  
Answer-style writeup: [`docs/SOLUTION.md`](docs/SOLUTION.md)

## Hard rules encoded in the MVP

1. Receiver = `app.activeDocument` at launch.
2. Sources opened with `app.open` / `open(File)` — **not** place descriptors.
3. Pixel guarantee: `mergeVisibleLayers` or top pixel layer + `rasterize` if a Smart Object somehow appears.
4. Transfer with `duplicateLayers(..., master)` / `layer.duplicate(master)`.
5. `closeWithoutSaving` / `DONOTSAVECHANGES` on every source.
6. Default picker excludes RAW/DNG (ACR pipeline).

## Machine setup (required for stable JPEG/TIFF batches)

Photoshop → Preferences → Camera Raw → File Handling:

- JPEG/HEIC Handling → **Disable JPEG/HEIC Support**
- TIFF Handling → **Disable TIFF Support**

Otherwise ACR may intercept opens (and “Open as Smart Objects” can break the pixel-layer contract).

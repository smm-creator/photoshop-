# Machine setup — Camera Raw (required for stable batches)

On every retoucher workstation that will run this importer:

1. Photoshop → **Preferences / Settings** → **Camera Raw** → **File Handling**
2. Set:
   - **JPEG/HEIC Handling** → `Disable JPEG/HEIC Support`
   - **TIFF Handling** → `Disable TIFF Support`
3. In Camera Raw **Workflow** options, do **not** enable “Open in Photoshop as Smart Objects” for this pipeline.
4. Prefer source plates as **JPEG / PNG / TIFF / PSD / PSB**. Convert RAW → one of those before import.

## Why

- JPEG/TIFF can be routed through Adobe Camera Raw when those prefs are enabled (or when CRS metadata is present).
- ACR + “Open as Smart Objects” breaks the “ordinary pixel layer” contract.
- This tool never uses Place Embedded/Linked, but it cannot fully override ACR open prefs via a documented stable UXP API (as of 2025–2026 research). Environment policy is the reliable fix.

## RAW

RAW/DNG/NEF/CR2/ARW are excluded from the default file picker. Pre-export them.

# Architecture — clothes import into master PSD

## Target workflow

```
Master PSD (active)
        │
        ▼
  Script / panel starts
        │
        ▼
  Multi-file picker (JPEG/PNG/TIFF/PSD/PSB)
        │
        ▼
  For each file:
    open as Document  ──►  prepare pixel ArtLayer
                              (merged OR top pixel)
                    ──►  duplicateLayers → Master
                    ──►  rename to filename
                    ──►  optional move into group IMPORT
                    ──►  close source without saving
        │
        ▼
  Activate master + last imported layer
```

## Why open + duplicate (not Place)

| Method | Result layer type | ACR / SO risk | Used? |
| --- | --- | --- | --- |
| Place Embedded / Linked | Smart Object | High | **No** |
| `newPlacedLayer` / Convert to SO | Smart Object | High | **No** |
| `app.open` + `duplicateLayers` | Ordinary layer copy | Low (if ACR prefs sane) | **Yes** |
| Clipboard copy merged + paste | Ordinary layer | Low | Fallback only |
| Imaging API getPixels/putPixels | Ordinary pixel layer | Low | Future heavy path |

Official UXP DOM documents `Document.duplicateLayers(layers, targetDocument)` specifically for cross-document layer copies without going through Place.

## Import modes

| Mode | Behavior | When to use |
| --- | --- | --- |
| **merged** (default) | `mergeVisibleLayers()` in source, then duplicate | Flat product shots, multi-layer PSD sources that should become one retouch plate |
| **topPixel** | Active / top pixel layer (rasterize SO if needed) | Source already has the plate as a single layer |
| **IMPORT group** | Ensure/create `IMPORT`, `move(..., PLACEINSIDE)` | Keep master stack tidy during long sessions |
| **Focus restore** | Re-select master by document id; select last layer | Retoucher continues immediately |

## API map (UXP)

| Step | API |
| --- | --- |
| Modal write access | `core.executeAsModal(fn, { commandName })` |
| Pick files | `uxp.storage.localFileSystem.getFileForOpening({ allowMultiple: true, types })` |
| Open | `app.open(fileEntry)` |
| Merge | `document.mergeVisibleLayers()` |
| Duplicate | `sourceDoc.duplicateLayers([layer], masterDoc)` |
| Rasterize SO | `layer.rasterize()` |
| Group | `createLayerGroup({ name: "IMPORT" })` + `layer.move(group, PLACEINSIDE)` |
| Close | `document.closeWithoutSaving()` |

## API map (ExtendScript)

| Step | API |
| --- | --- |
| Pick files | `File.openDialog(..., true)` |
| Open | `open(File)` with `displayDialogs = DialogModes.NO` |
| Merge | `artLayers.add()` + `mergeVisibleLayers()` |
| Duplicate | `artLayer.duplicate(masterDoc, ElementPlacement.PLACEATBEGINNING)` |
| Close | `close(SaveOptions.DONOTSAVECHANGES)` |

## Guaranteeing a normal pixel layer

1. Do not call Place / `newPlacedLayer`.
2. After prepare, if `layer.kind === SMARTOBJECT` → `rasterize()`.
3. After duplicate into master, re-check kind and rasterize again (belt and suspenders).
4. Prefer merged visible over “keep complex layer stack” when the retoucher only needs a plate.

## Error handling strategy

- Per-file try/catch so one bad TIFF does not abort the batch.
- On failure, close any non-master active document.
- Collect error messages; show summary alert / panel log.
- Do not save sources; do not save master automatically.

## Scaling to dozens of heavy PSDs

- Process sequentially (Photoshop is not safely parallel for document open).
- Report progress via `executionContext.reportProgress`.
- Optional later: history suspension per file (`suspendHistory`) to keep Undo usable.
- Optional later: skip files larger than N MB with a confirm dialog.
- Optional later: folder watch / Bridge-driven queue — still same open→duplicate core.

# Solution write-up — Photoshop 2026 clothes retouch import

Research-backed plan + MVP for importing many clothing sources into one master PSD as **ordinary raster layers** (no Smart Objects / Place).

---

## 1. Brief conclusion

**Recommended production mode (Variant A):**

1. Active document = master PSD  
2. All **other already-open Photoshop tabs** = sources (any type PS opened: ARW, JPG, PNG, TIFF, PSD, PSB, …)  
3. Script merges/duplicates each source into the master as a **normal pixel layer**  
4. Closes source tabs — **no file picker, no format filter**

**Delivery:**

1. **Ship now:** ExtendScript `.jsx` or UXP `.psjs` with Variant A  
2. **Scale later:** UXP panel with the same core  

**Why this wins**

- ARW/RAW already opened through Camera Raw become normal documents — script just transfers them  
- No Explorer dialog, no extension whitelist blocking PSD/ARW  
- Cross-document `duplicate` / `duplicateLayers` keeps ordinary pixel layers (no Place / Smart Object)

**Do not use:** Place Embedded/Linked; `newPlacedLayer`; ACR “Open as Smart Objects” as the import path.

---

## 2. Approach comparison

### Variant A — UXP plugin

| | |
| --- | --- |
| **Pros** | Modern ES6+, panel UI, progress bar, reusable DOM API, marketplace-ready later |
| **Cons** | Needs UDT / manifest / permissions; more moving parts for a one-button import |
| **PS 2026 reality** | Recommended for **new panels**; DOM + `batchPlay` fallback; `executeAsModal` mandatory for edits |
| **Maintainability** | Best long-term if the studio wants options and logging |
| **Limits** | File access via picker/tokens; incomplete DOM vs JSX for niche features; no supported JSX bridge |

### Variant B — JSX / ExtendScript

| | |
| --- | --- |
| **Pros** | Zero tooling; `File.openDialog` multi-select; battle-tested `layer.duplicate(otherDoc)`; works on locked-down studio PCs |
| **Cons** | ES3; ScriptUI is dated; Adobe’s strategic UI future is UXP |
| **PS 2026 reality** | **Still supported** for Scripts menu automation (not deprecated for this use) |
| **When better than UXP** | “Give the retoucher a file tomorrow” with no plugin install |

### Variant C — Action + Script / Batch

| | |
| --- | --- |
| **Pros** | Can bind a script to an Action / shortcut |
| **Cons** | Actions that Place files create Smart Objects; Image Processor / Batch don’t target “active master PSD + multi-pick” cleanly |
| **Verdict** | Useful only as a **launcher** for the JSX/PSJS — not as the import mechanism itself |

---

## 3. Research findings (Block 1)

### Official docs

- Prefer DOM before `batchPlay`; `batchPlay` ≈ modern `executeAction`.
- `Document.duplicateLayers(layers, targetDocument)` is the documented cross-doc copy.
- State changes require `executeAsModal`.
- `.psjs` UXP scripting exists since 23.5 for one-shot scripts without a panel.
- UXP DOM is still incomplete vs classic scripting; gaps → `batchPlay`.

### Developer practice

- Classic pattern (Morris / ES-Collection “Import Folder as Layers”): open → merge → `duplicate` → close without save.
- Forums: opening files in UXP needs picker entry + modal scope; pass File entry to `app.open`.
- Adobe staff (2025): UXP must not rely on invoking `.jsx`.

### Format / Camera Raw risks

| Format | Risk | Mitigation |
| --- | --- | --- |
| JPEG/PNG | ACR if JPEG support enabled | Disable ACR JPEG/HEIC support on prod machines |
| TIFF | ACR if TIFF support / CRS metadata | Disable ACR TIFF support; warn on failures |
| PSD/PSB | Multi-layer complexity | Default **merged** mode |
| RAW/DNG | Always ACR; SO option possible | **Excluded** from MVP picker |

**Uncertainty (explicit):** no stable documented UXP API to rewrite ACR File Handling prefs in 2025–2026. Treat prefs as environment policy. Whether modal `app.open` suppresses interactive ACR UI is machine-dependent.

---

## 4. Final recommendation (Block 2)

| Need | Stack |
| --- | --- |
| **Fastest into retoucher hands** | `ImportAsRasterLayers.jsx` **or** `.psjs` |
| **Best PS 2026-native script** | `.psjs` (same APIs as plugins) |
| **Scale to full studio tool** | `plugin/` UXP panel + shared pipeline |
| **Not recommended as core** | Place-based Actions, Smart Object workflows |

**Production rule:** open document → pixel layer → duplicate into master → close. Never Place.

---

## 5. Technical plan (Block 3) — Variant A

1. Capture `master = app.activeDocument` (+ store id/name).
2. Collect `app.documents` except master (snapshot list first).
3. Enter modal scope (UXP).
4. Optional: ensure group `IMPORT`.
5. Per open source document:
   - Activate source
   - Mode merged: `mergeVisibleLayers` (JSX often adds empty layer first)
   - Mode topPixel: use active/top art layer
   - If `SMARTOBJECT` → `rasterize`
   - `duplicateLayers([layer], master)` / `ArtLayer.duplicate(master)`
   - Rename; move into `IMPORT` if enabled
   - `closeWithoutSaving` / `DONOTSAVECHANGES`
6. Re-activate master; select last imported layer.
7. Summary alert / log.

**Pixel guarantee:** no Place descriptors; post-duplicate kind check + rasterize.  
**Formats:** whatever Photoshop already opened — including ARW after ACR.

---

## 6. MVP code (Block 4)

| File | Role |
| --- | --- |
| [`scripts/ImportAsRasterLayers.psjs`](../scripts/ImportAsRasterLayers.psjs) | UXP script MVP |
| [`scripts/ImportAsRasterLayers.jsx`](../scripts/ImportAsRasterLayers.jsx) | ExtendScript MVP |
| [`plugin/`](../plugin/) | Panel scaffold (modes + log) |

### Core UXP sequence (conceptual)

```javascript
const master = app.activeDocument;
const sources = [...app.documents].filter((d) => d.id !== master.id);

await core.executeAsModal(async () => {
  for (const src of sources) {
    app.activeDocument = src;
    await src.mergeVisibleLayers();
    const layer = src.activeLayers[0];
    if (isSmartObject(layer)) await layer.rasterize();
    layer.name = src.name.replace(/\.[^.]+$/, "");
    await src.duplicateLayers([layer], master);
    src.closeWithoutSaving();
  }
  app.activeDocument = master;
});
```

### Core JSX sequence (conceptual)

```javascript
var master = app.activeDocument;
var sources = [];
for (var i = 0; i < app.documents.length; i++) {
  if (app.documents[i] !== master) sources.push(app.documents[i]);
}
for (var j = 0; j < sources.length; j++) {
  var src = sources[j];
  app.activeDocument = src;
  src.artLayers.add();
  src.mergeVisibleLayers();
  var layer = src.activeLayer;
  layer.name = src.name.replace(/\.[^.]+$/i, "");
  layer.duplicate(master, ElementPlacement.PLACEATBEGINNING);
  src.close(SaveOptions.DONOTSAVECHANGES);
}
app.activeDocument = master;
```

---

## 7. Improvements (Block 5)

| Enhancement | Notes |
| --- | --- |
| IMPORT group | Implemented as option (default on) |
| Import modes | `merged` / `topPixel` in CONFIG + panel |
| Format filter | Whitelist; reject RAW |
| Error isolation | Per-file try/catch + close stray docs |
| Logging | Panel `<pre>` log; script alert summary |
| Heavy PSD | Sequential processing; progress API; later `suspendHistory` |
| Dozens of files | Same loop; consider confirm if count > 40 |
| Clipboard fallback | `layer.copy(true)` + `master.paste()` if duplicate fails across color modes |
| Imaging API | `getPixels`/`putPixels` for exotic cases (slower, more control) |
| Prefs checklist | Ship a one-page ACR setup note for IT |

---

## 8. Acceptance checklist for the retoucher

- [ ] Master PSD open and active before run  
- [ ] ACR JPEG/TIFF support disabled  
- [ ] Imported layers are **Normal** (not Smart Object) in Layers panel  
- [ ] Layer names match filenames  
- [ ] Source documents closed; only master left  
- [ ] No Place Linked badges / cloud links on layers  

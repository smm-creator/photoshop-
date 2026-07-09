# Solution write-up — Photoshop 2026 clothes retouch import

Research-backed plan + MVP for importing many clothing sources into one master PSD as **ordinary raster layers** (no Smart Objects / Place).

---

## 1. Brief conclusion

**Recommended for Photoshop 2026:** hybrid delivery of the **same pipeline**:

1. **Ship now:** UXP script (`.psjs`) *or* ExtendScript (`.jsx`) — open → prepare pixel layer → `duplicate` into master → close.
2. **Scale later:** thin **UXP panel** with the identical core (modes, progress, log).

**Why this wins for apparel retouch production**

- Official UXP DOM already exposes `app.open`, `duplicateLayers(layers, targetDocument)`, `mergeVisibleLayers`, `closeWithoutSaving` — enough for this job without Place.
- Cross-document **duplicate** copies an ArtLayer as a normal layer; Place Embedded/Linked creates Smart Objects (forbidden here).
- ExtendScript is still alive in 2026 for faceless automation and is the fastest drop-in for retouchers who already use `File → Scripts`.
- UXP is the forward path for panels; Adobe keeps UXP and JSX separate (no supported “run JSX from UXP”).

**Do not use:** Actions that record Place; scripts that call `newPlacedLayer` / Place Linked; ACR “Open as Smart Objects”.

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

## 5. Technical plan (Block 3)

1. Capture `master = app.activeDocument` (+ store `id`).
2. Multi-select files (extensions whitelist; no RAW).
3. Enter modal scope (UXP).
4. Optional: ensure group `IMPORT`.
5. Per file:
   - `open` as document
   - Mode merged: `mergeVisibleLayers` (JSX often adds empty layer first)
   - Mode topPixel: use active/top art layer
   - If `SMARTOBJECT` → `rasterize`
   - `duplicateLayers([layer], master)` / `duplicate(master)`
   - Rename; move into `IMPORT` if enabled
   - `closeWithoutSaving`
6. Re-activate master by id; select last imported layer.
7. Summary alert / log.

**Pixel guarantee:** no Place descriptors; post-duplicate kind check + rasterize.

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
const files = await fs.getFileForOpening({ allowMultiple: true, types: [...] });

await core.executeAsModal(async () => {
  for (const entry of files) {
    const src = await app.open(entry);          // document, not Place
    await src.mergeVisibleLayers();
    const layer = src.activeLayers[0];
    if (layer.kind === constants.LayerKind.SMARTOBJECT) await layer.rasterize();
    layer.name = entry.name.replace(/\.[^.]+$/, "");
    const [imported] = await src.duplicateLayers([layer], master);
    src.closeWithoutSaving();
  }
  app.activeDocument = master;
});
```

### Core JSX sequence (conceptual)

```javascript
var master = app.activeDocument;
var files = File.openDialog("Sources", "*.jpg;*.png;*.tif;*.psd", true);
for (var i = 0; i < files.length; i++) {
  var src = open(files[i]);
  src.artLayers.add();
  src.mergeVisibleLayers();
  var layer = src.activeLayer;
  layer.name = files[i].name.replace(/\.[^.]+$/i, "");
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

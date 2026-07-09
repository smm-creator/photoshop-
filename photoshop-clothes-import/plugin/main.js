/**
 * UXP panel scaffold — same core pipeline as ImportAsRasterLayers.psjs
 * Load via UXP Developer Tool for day-to-day retouch UI.
 */
const photoshop = require("photoshop");
const uxp = require("uxp");
const { app, core, constants } = photoshop;
const fs = uxp.storage.localFileSystem;

function log(msg) {
  const el = document.getElementById("log");
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.textContent = `${line}\n${el.textContent || ""}`;
}

function stripExtension(name) {
  return String(name).replace(/\.[^.]+$/i, "");
}

function readOptions() {
  return {
    importMode: document.getElementById("importMode").value,
    putIntoImportGroup: document.getElementById("putIntoImportGroup").checked,
    stripExtension: document.getElementById("stripExtension").checked,
    importGroupName: "IMPORT",
    allowedExtensions: ["jpg", "jpeg", "png", "tif", "tiff", "psd", "psb", "webp"],
  };
}

function kindStr(layer) {
  return layer && layer.kind != null ? String(layer.kind).toLowerCase() : "";
}

function isSmartObject(layer) {
  const k = kindStr(layer);
  return layer && (layer.kind === constants.LayerKind.SMARTOBJECT || k === "smartobject");
}

function isGroupLayer(layer) {
  const k = kindStr(layer);
  return layer && (layer.kind === constants.LayerKind.GROUP || k === "group");
}

async function ensureImportGroup(masterDoc, name) {
  for (let i = 0; i < masterDoc.layers.length; i++) {
    const l = masterDoc.layers[i];
    if (isGroupLayer(l) && l.name === name) return l;
  }
  return masterDoc.createLayerGroup({ name });
}

async function prepareSourcePixelLayer(sourceDoc, desiredName, importMode) {
  if (importMode === "merged") {
    if (sourceDoc.layers.length > 1 || sourceDoc.backgroundLayer) {
      await sourceDoc.mergeVisibleLayers();
    }
  }
  let layer = sourceDoc.activeLayers[0] || sourceDoc.layers[0];
  if (!layer) throw new Error(`No layer in ${sourceDoc.name}`);
  if (isSmartObject(layer)) {
    await layer.rasterize();
  } else if (typeof layer.rasterize === "function" && kindStr(layer) !== "normal" && kindStr(layer) !== "pixel") {
    await layer.rasterize();
  }
  layer.name = desiredName;
  return layer;
}

async function importOneFile(entry, masterDoc, opts, importGroup) {
  const desiredName = opts.stripExtension ? stripExtension(entry.name) : entry.name;
  let sourceDoc = null;
  try {
    sourceDoc = await app.open(entry);
    const sourceLayer = await prepareSourcePixelLayer(
      sourceDoc,
      desiredName,
      opts.importMode
    );
    const copies = await sourceDoc.duplicateLayers([sourceLayer], masterDoc);
    let imported = copies && copies[0];
    if (imported && isSmartObject(imported)) {
      await imported.rasterize();
    }
    if (imported) {
      imported.name = desiredName;
      if (opts.putIntoImportGroup && importGroup) {
        await imported.move(importGroup, constants.ElementPlacement.PLACEINSIDE);
      }
    }
    return imported;
  } finally {
    if (sourceDoc) {
      try {
        sourceDoc.closeWithoutSaving();
      } catch (_) {
        /* ignore */
      }
    }
  }
}

async function runImport() {
  const opts = readOptions();
  const masterDoc = app.activeDocument;
  if (!masterDoc) {
    await app.showAlert("Open the master PSD first.");
    return;
  }
  const masterId = masterDoc.id;

  const picked = await fs.getFileForOpening({
    allowMultiple: true,
    types: opts.allowedExtensions,
  });
  const files = !picked ? [] : Array.isArray(picked) ? picked : [picked];
  if (!files.length) {
    log("Cancelled — no files selected.");
    return;
  }

  await core.executeAsModal(
    async (executionContext) => {
      const importGroup = opts.putIntoImportGroup
        ? await ensureImportGroup(masterDoc, opts.importGroupName)
        : null;

      let ok = 0;
      let last = null;
      const errors = [];

      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        if (executionContext.reportProgress) {
          executionContext.reportProgress({
            value: i / files.length,
            commandName: `Import ${entry.name}`,
          });
        }
        try {
          last = await importOneFile(entry, masterDoc, opts, importGroup);
          ok += 1;
          log(`OK: ${entry.name}`);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          errors.push(`${entry.name}: ${msg}`);
          log(`ERR: ${entry.name} — ${msg}`);
          try {
            const active = app.activeDocument;
            if (active && active.id !== masterId) active.closeWithoutSaving();
          } catch (_) {
            /* ignore */
          }
        }
      }

      let still = null;
      for (let i = 0; i < app.documents.length; i++) {
        if (app.documents[i].id === masterId) {
          still = app.documents[i];
          break;
        }
      }
      if (still) {
        app.activeDocument = still;
        if (last) still.activeLayers = [last];
      }

      await app.showAlert(`Imported ${ok}/${files.length} as raster layers.`);
    },
    { commandName: "Import Raster Layers" }
  );
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnImport").addEventListener("click", () => {
    runImport().catch((err) => {
      log(`Fatal: ${err && err.message ? err.message : err}`);
    });
  });
});

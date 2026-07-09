/**
 * UXP panel — Variant A: import all OTHER open documents into active master.
 */
const photoshop = require("photoshop");
const { app, core, constants } = photoshop;

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
  } else if (
    typeof layer.rasterize === "function" &&
    kindStr(layer) !== "normal" &&
    kindStr(layer) !== "pixel"
  ) {
    await layer.rasterize();
  }
  layer.name = desiredName;
  return layer;
}

function collectSources(masterDoc) {
  const sources = [];
  for (let i = 0; i < app.documents.length; i++) {
    if (app.documents[i].id !== masterDoc.id) {
      sources.push(app.documents[i]);
    }
  }
  return sources;
}

async function importOneOpenDocument(sourceDoc, masterDoc, opts, importGroup) {
  const desiredName = opts.stripExtension
    ? stripExtension(sourceDoc.name)
    : sourceDoc.name;
  const sourceId = sourceDoc.id;

  try {
    app.activeDocument = sourceDoc;
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
    try {
      let still = null;
      for (let i = 0; i < app.documents.length; i++) {
        if (app.documents[i].id === sourceId) {
          still = app.documents[i];
          break;
        }
      }
      if (still) still.closeWithoutSaving();
    } catch (_) {
      /* ignore */
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
  if (app.documents.length < 2) {
    await app.showAlert(
      "Open other photos as tabs first, then click the master PSD and press Import."
    );
    return;
  }

  const masterId = masterDoc.id;
  const sources = collectSources(masterDoc);
  if (!sources.length) {
    log("No other open documents.");
    return;
  }

  await core.executeAsModal(
    async (executionContext) => {
      const importGroup = opts.putIntoImportGroup
        ? await ensureImportGroup(masterDoc, opts.importGroupName)
        : null;

      let ok = 0;
      let last = null;

      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (executionContext.reportProgress) {
          executionContext.reportProgress({
            value: i / sources.length,
            commandName: `Import ${src.name}`,
          });
        }
        try {
          app.activeDocument = masterDoc;
          last = await importOneOpenDocument(src, masterDoc, opts, importGroup);
          ok += 1;
          log(`OK: ${src.name}`);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          log(`ERR: ${src.name} — ${msg}`);
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

      await app.showAlert(`Imported ${ok}/${sources.length} open document(s).`);
    },
    { commandName: "Import Open Documents" }
  );
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnImport").addEventListener("click", () => {
    runImport().catch((err) => {
      log(`Fatal: ${err && err.message ? err.message : err}`);
    });
  });
});

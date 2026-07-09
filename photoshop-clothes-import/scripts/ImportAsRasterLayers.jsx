/*
 * Clothes Retouch — Import as Raster Layers (ExtendScript / JSX MVP)
 * File: ImportAsRasterLayers.jsx
 *
 * Target: Adobe Photoshop (legacy scripting engine; still supported in 2025–2026)
 *
 * Same production rules as the UXP .psjs MVP:
 *  - Active document = master PSD
 *  - Multi-file open dialog
 *  - Open each file as a document
 *  - Merge (or take top pixel layer) → duplicate into master as ArtLayer
 *  - Name by filename
 *  - Close source without saving
 *  - NO Place Embedded / Place Linked / Smart Object pipeline
 *
 * Run: File → Scripts → Browse… → ImportAsRasterLayers.jsx
 * Or copy into Presets/Scripts and restart Photoshop.
 *
 * Camera Raw: disable JPEG/TIFF ACR support on production machines.
 * RAW formats are filtered out of the default dialog.
 */

#target photoshop
app.bringToFront();

var CONFIG = {
  importMode: "merged", // "merged" | "topPixel"
  putIntoImportGroup: true,
  importGroupName: "IMPORT",
  stripExtensionFromLayerName: true,
  activateLastImportedLayer: true
};

function stripExtension(name) {
  return String(name).replace(/\.[^.]+$/i, "");
}

function layerNameFromFile(file) {
  var base = File.decode(file.name);
  return CONFIG.stripExtensionFromLayerName ? stripExtension(base) : base;
}

function isAllowedFile(file) {
  return /\.(jpg|jpeg|png|tif|tiff|psd|psb|webp)$/i.test(file.name);
}

function pickFiles() {
  // Multi-select open dialog (ExtendScript)
  var files = File.openDialog(
    "Select clothing source files to import as raster layers",
    "Images:*.jpg;*.jpeg;*.png;*.tif;*.tiff;*.psd;*.psb;*.webp",
    true
  );
  if (!files) return [];
  if (!(files instanceof Array)) files = [files];
  var out = [];
  for (var i = 0; i < files.length; i++) {
    if (files[i] instanceof File && isAllowedFile(files[i])) {
      out.push(files[i]);
    }
  }
  return out;
}

function findTopLevelGroup(doc, name) {
  for (var i = 0; i < doc.layerSets.length; i++) {
    if (doc.layerSets[i].name === name) return doc.layerSets[i];
  }
  return null;
}

function ensureImportGroup(doc) {
  var g = findTopLevelGroup(doc, CONFIG.importGroupName);
  if (g) return g;
  return doc.layerSets.add();
}

function unlockBackgroundIfNeeded(doc) {
  try {
    if (doc.backgroundLayer) {
      doc.backgroundLayer.isBackgroundLayer = false;
    }
  } catch (e) {
    // ignore
  }
}

function prepareMergedPixelLayer(doc, desiredName) {
  unlockBackgroundIfNeeded(doc);
  // Dummy layer trick helps mergeVisibleLayers leave a named ArtLayer
  // (classic production pattern from Import Folder as Layers scripts).
  doc.artLayers.add();
  doc.mergeVisibleLayers();
  var layer = doc.activeLayer;
  if (layer.kind === LayerKind.SMARTOBJECT) {
    // Rasterize smart object contents to pixels
    rasterizeActiveLayer();
    layer = doc.activeLayer;
  }
  layer.name = desiredName;
  return layer;
}

function prepareTopPixelLayer(doc, desiredName) {
  unlockBackgroundIfNeeded(doc);
  var layer = doc.activeLayer;
  if (layer.typename === "LayerSet") {
    if (layer.artLayers.length) {
      layer = layer.artLayers[0];
      doc.activeLayer = layer;
    }
  }
  if (layer.kind === LayerKind.SMARTOBJECT) {
    rasterizeActiveLayer();
    layer = doc.activeLayer;
  }
  // If still not a normal art layer, merge visible as fallback
  if (layer.kind !== LayerKind.NORMAL) {
    return prepareMergedPixelLayer(doc, desiredName);
  }
  layer.name = desiredName;
  return layer;
}

function rasterizeActiveLayer() {
  // Action Manager: Layer → Rasterize → Layer
  var idrasterizeLayer = stringIDToTypeID("rasterizeLayer");
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  desc.putReference(charIDToTypeID("null"), ref);
  executeAction(idrasterizeLayer, desc, DialogModes.NO);
}

function assertNotSmartObject(layer) {
  if (layer && layer.kind === LayerKind.SMARTOBJECT) {
    app.activeDocument.activeLayer = layer;
    rasterizeActiveLayer();
    return app.activeDocument.activeLayer;
  }
  return layer;
}

function importOneFile(file, masterDoc, importGroup) {
  var desiredName = layerNameFromFile(file);
  var sourceDoc = null;
  var prevDialogs = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;

  try {
    // CRITICAL: open as document — never place
    sourceDoc = open(file);
    if (!sourceDoc) {
      throw new Error("Failed to open " + file.fsName);
    }

    var sourceLayer =
      CONFIG.importMode === "topPixel"
        ? prepareTopPixelLayer(sourceDoc, desiredName)
        : prepareMergedPixelLayer(sourceDoc, desiredName);

    // Duplicate ArtLayer into master → ordinary pixel layer
    var dup = sourceLayer.duplicate(masterDoc, ElementPlacement.PLACEATBEGINNING);
    app.activeDocument = masterDoc;
    masterDoc.activeLayer = dup;
    dup = assertNotSmartObject(dup);
    dup.name = desiredName;

    if (CONFIG.putIntoImportGroup && importGroup) {
      dup.move(importGroup, ElementPlacement.INSIDE);
    }

    return dup;
  } finally {
    app.displayDialogs = prevDialogs;
    if (sourceDoc) {
      try {
        sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (e) {
        // ignore
      }
    }
  }
}

function main() {
  if (!app.documents.length) {
    alert("Open the master PSD first, then run this script.");
    return;
  }

  var masterDoc = app.activeDocument;
  var masterName = masterDoc.name;
  var files = pickFiles();
  if (!files.length) return;

  var originalUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;

  var importGroup = null;
  if (CONFIG.putIntoImportGroup) {
    importGroup = ensureImportGroup(masterDoc);
    importGroup.name = CONFIG.importGroupName;
  }

  var okCount = 0;
  var errors = [];
  var lastImported = null;

  for (var i = 0; i < files.length; i++) {
    try {
      // Re-resolve master in case focus drifted
      app.activeDocument = masterDoc;
      lastImported = importOneFile(files[i], masterDoc, importGroup);
      okCount++;
    } catch (err) {
      errors.push(File.decode(files[i].name) + ": " + err.message);
      // Close stray docs that are not the master
      try {
        if (app.activeDocument && app.activeDocument.name !== masterName) {
          app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
        }
      } catch (e2) {}
    }
  }

  app.activeDocument = masterDoc;
  if (CONFIG.activateLastImportedLayer && lastImported) {
    try {
      masterDoc.activeLayer = lastImported;
    } catch (e3) {}
  }

  app.preferences.rulerUnits = originalUnits;

  var summary =
    "Imported " +
    okCount +
    "/" +
    files.length +
    ' file(s) as raster layers into "' +
    masterName +
    '".';
  if (errors.length) {
    alert(summary + "\n\nErrors (" + errors.length + "):\n" + errors.slice(0, 8).join("\n"));
  } else {
    alert(summary);
  }
}

try {
  main();
} catch (e) {
  if (e.number !== 8007) {
    // 8007 = user cancel
    alert("Import failed: " + e.message + " (line " + e.line + ")");
  }
}

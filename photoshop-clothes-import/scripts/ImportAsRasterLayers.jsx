/*
 * Clothes Retouch — Import Open Documents as Raster Layers
 * File: ImportAsRasterLayers.jsx
 *
 * Variant A workflow:
 *  1. Open your master PSD and make it ACTIVE
 *  2. Open any other photos in Photoshop (ARW, JPG, PNG, TIFF, PSD, PSB, etc.)
 *  3. Click back on the master PSD tab
 *  4. Run this script
 *  5. Every OTHER open document is merged/copied into the master as a normal pixel layer
 *  6. Those source documents are closed without saving
 *
 * No file picker. No format filter. Whatever Photoshop already has open will be imported.
 *
 * Forbidden by design:
 *  - Place Embedded / Place Linked
 *  - Smart Object placement pipeline
 *
 * Install:
 *  Copy to Photoshop Presets/Scripts/ and restart Photoshop
 *  Then: File → Scripts → ImportAsRasterLayers
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

function layerNameFromDoc(doc) {
  var base = doc.name || "imported";
  // Photoshop document names are often already without path
  return CONFIG.stripExtensionFromLayerName ? stripExtension(base) : base;
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
  g = doc.layerSets.add();
  g.name = CONFIG.importGroupName;
  return g;
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

function rasterizeActiveLayer() {
  var idrasterizeLayer = stringIDToTypeID("rasterizeLayer");
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  desc.putReference(charIDToTypeID("null"), ref);
  executeAction(idrasterizeLayer, desc, DialogModes.NO);
}

function prepareMergedPixelLayer(doc, desiredName) {
  unlockBackgroundIfNeeded(doc);
  // Dummy layer helps mergeVisibleLayers leave a named ArtLayer
  doc.artLayers.add();
  doc.mergeVisibleLayers();
  var layer = doc.activeLayer;
  if (layer.kind === LayerKind.SMARTOBJECT) {
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
  if (layer.kind !== LayerKind.NORMAL) {
    return prepareMergedPixelLayer(doc, desiredName);
  }
  layer.name = desiredName;
  return layer;
}

function assertNotSmartObject(layer) {
  if (layer && layer.kind === LayerKind.SMARTOBJECT) {
    app.activeDocument.activeLayer = layer;
    rasterizeActiveLayer();
    return app.activeDocument.activeLayer;
  }
  return layer;
}

/**
 * Collect every open document except the master.
 * Snapshot references first — closing docs changes app.documents live.
 */
function collectSourceDocuments(masterDoc) {
  var sources = [];
  for (var i = 0; i < app.documents.length; i++) {
    var doc = app.documents[i];
    if (doc !== masterDoc) {
      sources.push(doc);
    }
  }
  return sources;
}

function importOneOpenDocument(sourceDoc, masterDoc, importGroup) {
  var desiredName = layerNameFromDoc(sourceDoc);
  var prevDialogs = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;

  try {
    app.activeDocument = sourceDoc;

    var sourceLayer =
      CONFIG.importMode === "topPixel"
        ? prepareTopPixelLayer(sourceDoc, desiredName)
        : prepareMergedPixelLayer(sourceDoc, desiredName);

    // Duplicate as ordinary ArtLayer into master — never Place
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
    try {
      // Close the source tab after transfer
      if (sourceDoc) {
        sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
      }
    } catch (e) {
      // ignore close errors
    }
  }
}

function main() {
  if (!app.documents.length) {
    alert("Open the master PSD first, then open the other photos as tabs.");
    return;
  }

  if (app.documents.length < 2) {
    alert(
      "Need at least 2 open documents.\n\n" +
        "1) Open your master PSD and keep it active\n" +
        "2) Open other photos as tabs (ARW, JPG, PSD, etc.)\n" +
        "3) Click back on the master PSD\n" +
        "4) Run this script again"
    );
    return;
  }

  var masterDoc = app.activeDocument;
  var masterName = masterDoc.name;
  var sources = collectSourceDocuments(masterDoc);

  if (!sources.length) {
    alert("No other open documents to import.\nMake sure the master PSD is the active tab.");
    return;
  }

  var originalUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;

  var importGroup = null;
  if (CONFIG.putIntoImportGroup) {
    importGroup = ensureImportGroup(masterDoc);
  }

  var okCount = 0;
  var errors = [];
  var lastImported = null;

  // Import from the end of the list so closing docs is safer
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    var srcName = src.name;
    try {
      app.activeDocument = masterDoc;
      lastImported = importOneOpenDocument(src, masterDoc, importGroup);
      okCount++;
    } catch (err) {
      errors.push(srcName + ": " + err.message);
      try {
        if (app.activeDocument && app.activeDocument.name !== masterName) {
          app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
        }
      } catch (e2) {}
    }
  }

  try {
    app.activeDocument = masterDoc;
  } catch (e3) {}

  if (CONFIG.activateLastImportedLayer && lastImported) {
    try {
      masterDoc.activeLayer = lastImported;
    } catch (e4) {}
  }

  app.preferences.rulerUnits = originalUnits;

  var summary =
    "Imported " +
    okCount +
    "/" +
    sources.length +
    ' open document(s) as raster layers into "' +
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
    alert("Import failed: " + e.message + " (line " + e.line + ")");
  }
}

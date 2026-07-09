// =============================================================================
//  ClothImporter_Advanced.jsx  —  расширенная версия для Photoshop 2025/2026
//
//  Дополнительно по сравнению с MVP:
//    • Режимы импорта: merged / toplayer / background
//    • Дополнительная защита от Smart Object (rasterize после duplicate)
//    • Опция добавления даты в имя слоя
//    • Детальный лог в консоль (ExtendScript ESTK / VS Code)
//    • Возможность работы без группы IMPORT
//    • Более надёжное восстановление после ошибок
//
//  Режимы импорта (переменная CFG.mode):
//    "merged"     — flatten всё → 1 пиксельный слой (рекомендуется)
//    "toplayer"   — только верхний слой (с растеризацией Smart Object если нужно)
//    "background" — только нижний / фоновый слой файла
// =============================================================================

#target photoshop
app.bringToFront();

// ═══════════════════════════════════════════════════════════════════════════
//  НАСТРОЙКИ — меняйте здесь
// ═══════════════════════════════════════════════════════════════════════════
var CFG = {
    // ── Режим импорта ───────────────────────────────────────────────────────
    // "merged"     — схлопнуть все слои файла в один и перенести как pixel layer
    // "toplayer"   — взять только верхний слой (будет растеризован если Smart Object)
    // "background" — взять только нижний/фоновый слой
    mode: "merged",

    // ── Группа IMPORT ───────────────────────────────────────────────────────
    useImportGroup: true,
    importGroupName: "IMPORT",

    // ── Имена слоёв ─────────────────────────────────────────────────────────
    stripExtensionFromName: true,       // убрать расширение из имени слоя
    addDatePrefix: false,               // добавить дату: "2026-07-09_filename"
    addIndexSuffix: false,              // добавить порядковый номер: "filename_001"

    // ── Поведение ───────────────────────────────────────────────────────────
    activateLastLayer: true,            // активировать последний добавленный слой
    showSummary: true,                  // показать итоговое сообщение
    logToConsole: true,                 // вывод в консоль ExtendScript
};
// ═══════════════════════════════════════════════════════════════════════════

(function () {
    if (app.documents.length === 0) {
        alert("Нет открытых документов.\nСначала откройте основной PSD.");
        return;
    }

    var mainDoc = app.activeDocument;
    var mainDocName = mainDoc.name;

    log("=== ClothImporter Advanced ===");
    log("Основной документ: " + mainDocName);
    log("Режим: " + CFG.mode);

    var files = File.openDialog(
        "Выберите файлы для импорта в «" + mainDocName + "»",
        "Все поддерживаемые:*.psd;*.psb;*.jpg;*.jpeg;*.png;*.tif;*.tiff;*.bmp;*.gif;*.webp,PSD:*.psd;*.psb,JPEG:*.jpg;*.jpeg,PNG:*.png,TIFF:*.tif;*.tiff,Other:*.bmp;*.gif;*.webp",
        true
    );

    if (!files || files.length === 0) {
        log("Файлы не выбраны. Выход.");
        return;
    }

    log("Выбрано файлов: " + files.length);

    var importGroup = null;
    if (CFG.useImportGroup) {
        importGroup = getOrCreateGroup(mainDoc, CFG.importGroupName);
        log("Группа: " + CFG.importGroupName);
    }

    var imported = 0;
    var errors = [];
    var lastLayer = null;
    var startTime = new Date().getTime();

    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        log("[" + (i + 1) + "/" + files.length + "] " + file.name);

        try {
            var layerName = buildLayerName(file.name, i + 1);
            var layer = importFile(file, layerName, mainDoc, importGroup);
            if (layer) {
                lastLayer = layer;
                imported++;
                log("  ✓ Добавлен слой: " + layer.name);
            }
        } catch (e) {
            var errMsg = (e && e.message) ? e.message : String(e);
            errors.push("• " + file.name + " → " + errMsg);
            log("  ✗ Ошибка: " + errMsg);
        }
    }

    // Вернуть фокус
    try {
        app.activeDocument = mainDoc;
    } catch (e) {
        try { app.activeDocument = app.documents.getByName(mainDocName); } catch (e2) {}
    }

    if (CFG.activateLastLayer && lastLayer) {
        try { mainDoc.activeLayer = lastLayer; } catch (e) {}
    }

    var elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);
    log("Завершено за " + elapsed + "с. Добавлено: " + imported + "/" + files.length);

    if (CFG.showSummary) {
        var msg = "Импорт завершён.\n\nДобавлено слоёв: " + imported + " из " + files.length
                + "\nВремя: " + elapsed + "с";
        if (errors.length > 0) {
            msg += "\n\nОшибки (" + errors.length + "):\n" + errors.join("\n");
        }
        alert(msg);
    }
})();

// ─────────────────────────────────────────────────────────────────────────────
//  importFile
// ─────────────────────────────────────────────────────────────────────────────
function importFile(file, layerName, mainDoc, importGroup) {
    var sourceDoc = openFileSafely(file);

    try {
        app.activeDocument = sourceDoc;

        var newLayer;

        if (CFG.mode === "merged") {
            newLayer = importMerged(sourceDoc, mainDoc);
        } else if (CFG.mode === "toplayer") {
            newLayer = importTopLayer(sourceDoc, mainDoc);
        } else {
            newLayer = importBottomLayer(sourceDoc, mainDoc);
        }

        newLayer.name = layerName;

        sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument = mainDoc;

        if (importGroup) {
            newLayer.move(importGroup, ElementPlacement.PLACEATBEGINNING);
        }

        return newLayer;

    } catch (e) {
        try {
            if (isDocOpen(sourceDoc)) {
                sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
            }
        } catch (e2) {}
        app.activeDocument = mainDoc;
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Режим 1: merged — flatten всё → один пиксельный слой
// ─────────────────────────────────────────────────────────────────────────────
function importMerged(sourceDoc, mainDoc) {
    // flatten() схлопывает ВСЕ видимые слои в один Background (пиксельный)
    // Скрытые слои отбрасываются, что нам и нужно для "merged visible"
    sourceDoc.flatten();

    var bg = sourceDoc.artLayers[0];
    // duplicate возвращает новый layer в mainDoc
    // При этом sourceDoc должен быть frontmost — он и есть
    var newLayer = bg.duplicate(mainDoc, ElementPlacement.PLACEATBEGINNING);

    return newLayer;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Режим 2: toplayer — верхний слой (с рас тростеризацией Smart Object)
// ─────────────────────────────────────────────────────────────────────────────
function importTopLayer(sourceDoc, mainDoc) {
    var topLayer = null;

    // Найти первый не-служебный слой
    for (var i = 0; i < sourceDoc.layers.length; i++) {
        if (sourceDoc.layers[i].typename === "ArtLayer") {
            topLayer = sourceDoc.layers[i];
            break;
        }
    }

    if (!topLayer) {
        // Fallback: если нет ArtLayer — берём merged
        return importMerged(sourceDoc, mainDoc);
    }

    sourceDoc.activeLayer = topLayer;

    // Растеризовать Smart Object если нужно
    if (topLayer.kind === LayerKind.SMARTOBJECT) {
        log("  [toplayer] Smart Object обнаружен — растеризуем");
        topLayer.rasterize(RasterizeType.ENTIRELAYER);
        topLayer = sourceDoc.activeLayer; // обновляем ссылку после растеризации
    }

    var newLayer = topLayer.duplicate(mainDoc, ElementPlacement.PLACEATBEGINNING);
    return newLayer;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Режим 3: background — нижний/фоновый слой
// ─────────────────────────────────────────────────────────────────────────────
function importBottomLayer(sourceDoc, mainDoc) {
    // Нижний слой — это последний в массиве layers
    var layers = sourceDoc.layers;
    var bottomLayer = null;

    for (var i = layers.length - 1; i >= 0; i--) {
        if (layers[i].typename === "ArtLayer") {
            bottomLayer = layers[i];
            break;
        }
    }

    if (!bottomLayer) {
        return importMerged(sourceDoc, mainDoc);
    }

    sourceDoc.activeLayer = bottomLayer;

    if (bottomLayer.kind === LayerKind.SMARTOBJECT) {
        log("  [bottomlayer] Smart Object обнаружен — растеризуем");
        bottomLayer.rasterize(RasterizeType.ENTIRELAYER);
        bottomLayer = sourceDoc.activeLayer;
    }

    var newLayer = bottomLayer.duplicate(mainDoc, ElementPlacement.PLACEATBEGINNING);
    return newLayer;
}

// ─────────────────────────────────────────────────────────────────────────────
//  openFileSafely  —  открыть файл, форсируя родной декодер
// ─────────────────────────────────────────────────────────────────────────────
function openFileSafely(file) {
    var ext = getExtension(file.name);

    switch (ext) {
        case "jpg":
        case "jpeg":
            // OpenDocumentType.JPEG форсирует JPEG декодер напрямую,
            // Camera Raw не вызывается даже при наличии CRS-метаданных в файле
            return app.open(file, OpenDocumentType.JPEG);

        case "png":
            return app.open(file, OpenDocumentType.PNG);

        case "tif":
        case "tiff":
            return app.open(file, OpenDocumentType.TIFF);

        case "bmp":
            return app.open(file, OpenDocumentType.BMP);

        case "gif":
            return app.open(file, OpenDocumentType.GIF);

        case "psd":
        case "psb":
            return app.open(file, OpenDocumentType.PHOTOSHOP);

        default:
            // RAW-форматы (CR2, NEF, ARW, DNG, ORF, RW2, RAF…)
            // Camera Raw запустится в фоне с сохранёнными настройками,
            // но DialogModes.NO гарантирует, что диалог не покажется.
            // Результат — обычный растровый документ (не Smart Object).
            return openViaDescriptor(file);
    }
}

function openViaDescriptor(file) {
    var desc = new ActionDescriptor();
    desc.putPath(charIDToTypeID("null"), new File(file.fsName));
    executeAction(charIDToTypeID("Opn "), desc, DialogModes.NO);
    return app.activeDocument;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Группы
// ─────────────────────────────────────────────────────────────────────────────
function getOrCreateGroup(doc, groupName) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].typename === "LayerSet" && doc.layers[i].name === groupName) {
            return doc.layers[i];
        }
    }

    var newGroup = doc.layerSets.add();
    newGroup.name = groupName;

    if (doc.layers.length > 1) {
        newGroup.move(doc.layers[0], ElementPlacement.PLACEBEFORE);
    }

    return newGroup;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────
function buildLayerName(filename, index) {
    var name = CFG.stripExtensionFromName ? filename.replace(/\.[^.]+$/, "") : filename;

    if (CFG.addDatePrefix) {
        var d = new Date();
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        var dateStr = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
        name = dateStr + "_" + name;
    }

    if (CFG.addIndexSuffix) {
        var idx = index < 10 ? "00" + index : (index < 100 ? "0" + index : String(index));
        name = name + "_" + idx;
    }

    return name;
}

function getExtension(filename) {
    var m = filename.match(/\.([^.]+)$/);
    return m ? m[1].toLowerCase() : "";
}

function isDocOpen(doc) {
    try {
        var _ = doc.name;
        return true;
    } catch (e) {
        return false;
    }
}

function log(msg) {
    if (CFG.logToConsole) {
        $.writeln("[ClothImporter] " + msg);
    }
}

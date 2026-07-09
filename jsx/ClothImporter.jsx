// =============================================================================
//  ClothImporter.jsx  —  MVP for Photoshop 2025 / 2026
//  Clothing retouching workflow: import files as plain pixel layers
//
//  HOW TO RUN:
//    File > Scripts > Browse… → выбрать этот файл
//    (или положить в папку Presets/Scripts и перезапустить PS)
//
//  ЧТО ДЕЛАЕТ:
//    1. Запоминает активный документ как основной PSD.
//    2. Показывает диалог выбора файлов (мультиселект).
//    3. Каждый файл:
//         • открывается БЕЗ Camera Raw (для JPEG/PNG/TIFF форсируется тип)
//         • flatten() → все слои схлопываются в один пиксельный Background
//         • Background дублируется в основной PSD как обычный слой
//         • слой называется по имени файла (без расширения)
//         • исходный файл закрывается без сохранения
//    4. Возвращает фокус на основной PSD, активирует последний добавленный слой.
//
//  ГАРАНТИИ:
//    • Никаких Smart Object — пиксельный слой гарантируется через flatten+duplicate
//    • Никаких Place Embedded / Place Linked
//    • Camera Raw не блокирует скрипт
//
//  СОВМЕСТИМОСТЬ:
//    Photoshop CC 2019+ / Photoshop 2022–2026  (ExtendScript DOM)
// =============================================================================

#target photoshop
app.bringToFront();

// ─── НАСТРОЙКИ ───────────────────────────────────────────────────────────────
var CFG = {
    // Сложить импортированные слои в группу (true) или добавлять напрямую (false)
    useImportGroup: true,
    importGroupName: "IMPORT",

    // Активировать последний импортированный слой после завершения
    activateLastLayer: true,

    // Показывать итоговое сообщение
    showSummary: true,
};
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    if (app.documents.length === 0) {
        alert("Нет открытых документов.\nСначала откройте основной PSD.");
        return;
    }

    var mainDoc = app.activeDocument;
    var mainDocName = mainDoc.name; // страховка — сохраняем имя

    // Диалог выбора файлов (multiselect)
    var files = File.openDialog(
        "Выберите файлы для импорта в «" + mainDocName + "»",
        "Все поддерживаемые:*.psd;*.psb;*.jpg;*.jpeg;*.png;*.tif;*.tiff;*.bmp;*.gif;*.webp,PSD:*.psd;*.psb,JPEG:*.jpg;*.jpeg,PNG:*.png,TIFF:*.tif;*.tiff,Other:*.bmp;*.gif;*.webp",
        true // multiple selection
    );

    if (!files || files.length === 0) return;

    // Создать или найти группу IMPORT
    var importGroup = null;
    if (CFG.useImportGroup) {
        importGroup = getOrCreateGroup(mainDoc, CFG.importGroupName);
    }

    var imported = 0;
    var errors = [];
    var lastLayer = null;

    for (var i = 0; i < files.length; i++) {
        try {
            var layer = importFile(files[i], mainDoc, importGroup);
            if (layer) {
                lastLayer = layer;
                imported++;
            }
        } catch (e) {
            errors.push("• " + files[i].name + " → " + e.message);
        }
    }

    // Вернуть фокус на основной документ
    try {
        app.activeDocument = mainDoc;
    } catch (e) {
        try { app.activeDocument = app.documents.getByName(mainDocName); } catch (e2) {}
    }

    // Активировать последний импортированный слой
    if (CFG.activateLastLayer && lastLayer) {
        try { mainDoc.activeLayer = lastLayer; } catch (e) {}
    }

    if (CFG.showSummary) {
        var msg = "Импорт завершён.\n\nДобавлено слоёв: " + imported + " из " + files.length;
        if (errors.length > 0) {
            msg += "\n\nОшибки (" + errors.length + "):\n" + errors.join("\n");
        }
        alert(msg);
    }
})();

// ─────────────────────────────────────────────────────────────────────────────
//  importFile  —  открыть один файл и добавить его как слой в mainDoc
// ─────────────────────────────────────────────────────────────────────────────
function importFile(file, mainDoc, importGroup) {
    var baseName = stripExtension(file.name);

    // 1. Открыть файл (без Camera Raw диалога)
    var sourceDoc = openFileSafely(file);

    try {
        // 2. Убедиться, что sourceDoc активен
        app.activeDocument = sourceDoc;

        // 3. Схлопнуть все слои в один Background (обычный пиксельный слой)
        //    Это гарантирует, что duplicate даст нам именно pixel layer,
        //    а не Smart Object, не группу, не adjustment layer.
        sourceDoc.flatten();

        // 4. Дублировать фоновый слой в основной PSD
        //    Важно: sourceDoc должен быть frontmost при вызове duplicate
        var bg = sourceDoc.artLayers[0];
        var newLayer = bg.duplicate(mainDoc, ElementPlacement.PLACEATBEGINNING);

        // 5. Переименовать
        newLayer.name = baseName;

        // 6. Закрыть источник без сохранения
        sourceDoc.close(SaveOptions.DONOTSAVECHANGES);

        // 7. Переключиться на основной документ
        app.activeDocument = mainDoc;

        // 8. Переместить в группу IMPORT (если нужно)
        if (importGroup) {
            newLayer.move(importGroup, ElementPlacement.PLACEATBEGINNING);
        }

        return newLayer;

    } catch (e) {
        // Аварийное закрытие источника
        try {
            if (sourceDoc && sourceDocIsOpen(sourceDoc)) {
                sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
            }
        } catch (e2) {}
        app.activeDocument = mainDoc;
        throw new Error(e.message || String(e));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  openFileSafely  —  открыть файл, форсируя родной декодер
//  (обход Camera Raw для JPEG / TIFF / PNG)
// ─────────────────────────────────────────────────────────────────────────────
function openFileSafely(file) {
    var ext = getExtension(file.name);

    switch (ext) {
        // Для JPEG: передаём OpenDocumentType.JPEG → PS использует JPEG декодер напрямую,
        // Camera Raw не вызывается даже если в файле есть CRS метаданные.
        case "jpg":
        case "jpeg":
            return app.open(file, OpenDocumentType.JPEG);

        case "png":
            return app.open(file, OpenDocumentType.PNG);

        // TIFFOpenOptions() — аналогичный форсированный TIFF декодер
        case "tif":
        case "tiff":
            return app.open(file, OpenDocumentType.TIFF);

        case "bmp":
            return app.open(file, OpenDocumentType.BMP);

        case "gif":
            return app.open(file, OpenDocumentType.GIF);

        // PSD/PSB — Camera Raw не применяется по определению
        case "psd":
        case "psb":
            return app.open(file, OpenDocumentType.PHOTOSHOP);

        default:
            // Для всех остальных форматов (RAW: CR2, NEF, ARW, DNG и т.д.)
            // используем Action Descriptor с DialogModes.NO —
            // Camera Raw запускается в фоне с сохранёнными настройками, диалог не показывается.
            return openViaDescriptor(file);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  openViaDescriptor  —  открыть через action descriptor, подавив все диалоги
// ─────────────────────────────────────────────────────────────────────────────
function openViaDescriptor(file) {
    var desc = new ActionDescriptor();
    desc.putPath(charIDToTypeID("null"), new File(file.fsName));
    executeAction(charIDToTypeID("Opn "), desc, DialogModes.NO);
    return app.activeDocument;
}

// ─────────────────────────────────────────────────────────────────────────────
//  getOrCreateGroup  —  найти группу по имени или создать новую
// ─────────────────────────────────────────────────────────────────────────────
function getOrCreateGroup(doc, groupName) {
    // Сначала ищем существующую группу
    var allLayers = doc.layers;
    for (var i = 0; i < allLayers.length; i++) {
        if (allLayers[i].typename === "LayerSet" && allLayers[i].name === groupName) {
            return allLayers[i];
        }
    }

    // Если не нашли — создаём новую группу в верхней части стека
    var newGroup = doc.layerSets.add();
    newGroup.name = groupName;

    // Переместить на самый верх (над всеми слоями)
    if (doc.layers.length > 1) {
        newGroup.move(doc.layers[0], ElementPlacement.PLACEBEFORE);
    }

    return newGroup;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────
function stripExtension(filename) {
    return filename.replace(/\.[^.]+$/, "");
}

function getExtension(filename) {
    var m = filename.match(/\.([^.]+)$/);
    return m ? m[1].toLowerCase() : "";
}

function sourceDocIsOpen(doc) {
    try {
        var _ = doc.name;
        return true;
    } catch (e) {
        return false;
    }
}

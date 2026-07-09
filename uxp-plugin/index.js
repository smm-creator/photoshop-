// =============================================================================
//  index.js  —  UXP Plugin «Cloth Importer»  (Photoshop 2025/2026)
//
//  Полноценный плагин-панель для переноса файлов как обычных пиксельных слоёв.
//  Устанавливается через UXP Developer Tool или как .ccx пакет.
// =============================================================================

/* global require */

const { app, core, action } = require("photoshop");
const { localFileSystem: fs } = require("uxp").storage;

// ─── UI ссылки ───────────────────────────────────────────────────────────────
const importBtn   = document.getElementById("importBtn");
const importMode  = document.getElementById("importMode");
const useGroup    = document.getElementById("useGroup");
const groupName   = document.getElementById("groupName");
const groupNameRow = document.getElementById("groupNameRow");
const progressBar  = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const statusEl    = document.getElementById("status");
const logArea     = document.getElementById("logArea");
const logBox      = document.getElementById("logBox");

// ─── Показывать лог в debug-режиме ──────────────────────────────────────────
const DEBUG = false;
if (DEBUG) { logArea.style.display = "block"; }

// ─── UI event handlers ───────────────────────────────────────────────────────
useGroup.addEventListener("change", () => {
    groupNameRow.style.opacity = useGroup.checked ? "1" : "0.4";
    groupName.disabled = !useGroup.checked;
});

importBtn.addEventListener("click", handleImport);

// ─────────────────────────────────────────────────────────────────────────────
//  handleImport  —  главный обработчик кнопки
// ─────────────────────────────────────────────────────────────────────────────
async function handleImport() {
    if (app.documents.length === 0) {
        setStatus("Нет открытых документов. Откройте основной PSD.", "error");
        return;
    }

    const mainDoc = app.activeDocument;
    const mainDocId = mainDoc.id;

    // Выбор файлов (ВНЕ executeAsModal — file picker это ОС-диалог)
    let entries;
    try {
        entries = await fs.getFileForOpening({
            allowMultiple: true,
            types: ["psd", "psb", "jpg", "jpeg", "png", "tif", "tiff", "bmp", "gif"],
        });
    } catch (e) {
        return;
    }

    if (!entries || entries.length === 0) return;

    const fileList = Array.isArray(entries) ? entries : [entries];

    // Собираем настройки из UI
    const cfg = {
        mode: importMode.value,
        useImportGroup: useGroup.checked,
        importGroupName: groupName.value.trim() || "IMPORT",
    };

    // Заблокировать UI
    setUIBusy(true, fileList.length);

    let imported = 0;
    const errors = [];
    let lastLayer = null;

    try {
        await core.executeAsModal(
            async (executionContext) => {
                let importGroup = null;
                if (cfg.useImportGroup) {
                    importGroup = await getOrCreateGroup(mainDoc, cfg.importGroupName);
                }

                for (let i = 0; i < fileList.length; i++) {
                    const entry = fileList[i];
                    const progress = Math.round(((i + 1) / fileList.length) * 100);

                    updateProgress(progress, `(${i + 1}/${fileList.length}) ${entry.name}`);

                    try {
                        const layer = await importSingleFile(entry, mainDoc, importGroup, cfg.mode);
                        if (layer) {
                            lastLayer = layer;
                            imported++;
                            log(`✓ ${entry.name}`);
                        }
                    } catch (e) {
                        errors.push(`${entry.name}: ${e.message}`);
                        log(`✗ ${entry.name}: ${e.message}`);
                    }
                }

                // Вернуть фокус
                const docRef = app.documents.find((d) => d.id === mainDocId);
                if (docRef) app.activeDocument = docRef;

                if (lastLayer) {
                    try { mainDoc.activeLayers = [lastLayer]; } catch (e) {}
                }
            },
            { commandName: "ClothImporter: Import Files as Pixel Layers" }
        );

        if (errors.length === 0) {
            setStatus(`✓ Готово: добавлено ${imported} слоёв`, "success");
        } else {
            setStatus(`Добавлено: ${imported} | Ошибки: ${errors.length}`, "error");
        }

    } catch (e) {
        setStatus(`Ошибка: ${e.message}`, "error");
        log(`Fatal: ${e.message}`);
    } finally {
        setUIBusy(false);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  importSingleFile
// ─────────────────────────────────────────────────────────────────────────────
async function importSingleFile(entry, mainDoc, importGroup, mode) {
    const baseName = entry.name.replace(/\.[^.]+$/, "");

    // Открыть файл без диалога Camera Raw
    let sourceDoc;
    try {
        sourceDoc = await openFileViaBatchPlay(entry);
    } catch (e) {
        // Fallback: прямой open
        sourceDoc = await app.open(entry);
    }

    try {
        let newLayer;

        if (mode === "merged") {
            newLayer = await importMerged(sourceDoc, mainDoc);
        } else if (mode === "toplayer") {
            newLayer = await importTopLayer(sourceDoc, mainDoc);
        } else {
            newLayer = await importBottomLayer(sourceDoc, mainDoc);
        }

        newLayer.name = baseName;

        await sourceDoc.closeWithoutSaving();
        app.activeDocument = mainDoc;

        if (importGroup) {
            await moveLayerIntoGroup(newLayer, importGroup);
        }

        return newLayer;

    } catch (e) {
        try { await sourceDoc.closeWithoutSaving(); } catch (e2) {}
        app.activeDocument = mainDoc;
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Режимы импорта
// ─────────────────────────────────────────────────────────────────────────────
async function importMerged(sourceDoc, mainDoc) {
    await sourceDoc.flatten();
    const flatLayer = sourceDoc.layers[0];
    return await flatLayer.duplicate(mainDoc);
}

async function importTopLayer(sourceDoc, mainDoc) {
    let topLayer = sourceDoc.layers[0];
    if (!topLayer) return importMerged(sourceDoc, mainDoc);

    if (topLayer.kind === "smartObject") {
        await topLayer.rasterize();
        topLayer = sourceDoc.activeLayers[0];
    }
    return await topLayer.duplicate(mainDoc);
}

async function importBottomLayer(sourceDoc, mainDoc) {
    const layers = sourceDoc.layers;
    let bottomLayer = null;

    for (let i = layers.length - 1; i >= 0; i--) {
        if (layers[i].kind !== "group") {
            bottomLayer = layers[i];
            break;
        }
    }

    if (!bottomLayer) return importMerged(sourceDoc, mainDoc);

    if (bottomLayer.kind === "smartObject") {
        sourceDoc.activeLayers = [bottomLayer];
        await bottomLayer.rasterize();
        bottomLayer = sourceDoc.activeLayers[0];
    }

    return await bottomLayer.duplicate(mainDoc);
}

// ─────────────────────────────────────────────────────────────────────────────
//  openFileViaBatchPlay  —  открыть без Camera Raw диалога
//
//  batchPlay по умолчанию подавляет все PS-диалоги (аналог DialogModes.NO в JSX).
//  Для JPEG/TIFF с CRS-метаданными Camera Raw применит сохранённые настройки
//  в фоне, но диалог не покажет. Результат — обычный растровый документ.
// ─────────────────────────────────────────────────────────────────────────────
async function openFileViaBatchPlay(entry) {
    const nativePath = entry.nativePath;

    await action.batchPlay(
        [
            {
                _obj: "open",
                null: { _path: nativePath, _kind: "local" },
                _options: { dialogOptions: "dontDisplay" },
            },
        ],
        { synchronousExecution: false }
    );

    return app.activeDocument;
}

// ─────────────────────────────────────────────────────────────────────────────
//  moveLayerIntoGroup  —  через batchPlay (нет прямого DOM API)
// ─────────────────────────────────────────────────────────────────────────────
async function moveLayerIntoGroup(layer, group) {
    await action.batchPlay(
        [
            {
                _obj: "move",
                _target: [{ _ref: "layer", _id: layer.id }],
                to: { _ref: "layerSection", _id: group.id },
                adjustment: { _enum: "ordinal", _value: "front" },
                _options: { dialogOptions: "dontDisplay" },
            },
        ],
        { synchronousExecution: false }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
//  getOrCreateGroup
// ─────────────────────────────────────────────────────────────────────────────
async function getOrCreateGroup(doc, gName) {
    for (const layer of doc.layers) {
        if (layer.kind === "group" && layer.name === gName) {
            return layer;
        }
    }
    return await doc.createLayerGroup({ name: gName });
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function setUIBusy(busy, total) {
    importBtn.disabled = busy;
    importMode.disabled = busy;
    useGroup.disabled = busy;
    groupName.disabled = busy;
    progressBar.style.display = busy ? "block" : "none";
    if (!busy) {
        progressFill.style.width = "0%";
    }
    if (busy) {
        setStatus(`Импорт 0 / ${total}...`, "");
    }
}

function updateProgress(percent, label) {
    progressFill.style.width = `${percent}%`;
    setStatus(label, "");
}

function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = type || "";
}

function log(msg) {
    if (!DEBUG) return;
    const line = document.createElement("div");
    line.textContent = msg;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
}

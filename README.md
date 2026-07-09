# Photoshop Cloth Importer — Автоматизация ретуши одежды

Инструмент для импорта файлов как обычных пиксельных слоёв в основной PSD.
**Без Smart Object. Без Place Embedded. Без Camera Raw.**

---

## Структура репозитория

```
jsx/
  ClothImporter.jsx             ← MVP: сразу работает, без установки
  ClothImporter_Advanced.jsx    ← Расширенная версия с режимами и логом

uxp-script/
  ClothImporter.psjs            ← Современный UXP-скрипт (ES2018+)

uxp-plugin/
  manifest.json                 ← UXP плагин-панель (устанавливается через UDT)
  index.html
  index.js
```

---

## Блок 1 — Ресёрч и выводы по актуальным источникам (Photoshop 2025/2026)

### Статус ExtendScript (JSX) в 2026

**Живой, не deprecated, полностью поддерживается.** Adobe официально заявила:
> *"There are currently no plans to remove ExtendScript support from Photoshop."*
— [Adobe UXP Legacy Extensibility docs](https://adobedocs.github.io/uxp-photoshop/guides/legacy-extensibility/)

Что изменилось: ESTK (ExtendScript Toolkit IDE) устарел. Работать со скриптами теперь через
[VS Code + ExtendScript Debugger extension](https://marketplace.visualstudio.com/items?itemName=Adobe.extendscript-debug).
Сами `.jsx`-файлы работают точно так же, как в Photoshop CS6.

Источники: [Mapsoft — ExtendScript in 2026: Is It Dead?](https://mapsoft.com/posts/extendscript.html),
[Mapsoft — Photoshop Extension Technologies](https://mapsoft.com/posts/photoshop-extension-technologies.html)

### Статус UXP в 2026

UXP — рекомендованная Adobe платформа для **новых** плагинов с панелями.
Использует V8 JS-движок (ES2018+), async/await, полноценный HTML/CSS UI.
Для любых изменений в документе требует `executeAsModal`.

**Ключевое ограничение UXP**: в `app.open()` нельзя передать тип формата
(нет аналога `OpenDocumentType.JPEG`). Решение — открывать через `batchPlay`,
который по умолчанию подавляет диалоги (аналог `DialogModes.NO` в JSX).

### UXP Scripting (.psjs)

Промежуточный вариант между JSX и UXP Plugin. Файл `.psjs` запускается через
`File > Scripts > Browse…`, не требует установки, но использует современный JS.
Доступен с Photoshop v23.5+.

### Camera Raw: риски и обходы

| Формат         | Когда Camera Raw вмешивается                                | Решение в скрипте                                    |
|----------------|-------------------------------------------------------------|------------------------------------------------------|
| JPEG           | Если в файле есть CRS-метаданные (Lightroom/ACR правки)     | `app.open(file, OpenDocumentType.JPEG)` — JSX        |
|                |                                                             | `batchPlay open` с `dontDisplay` — UXP               |
| TIFF           | Аналогично JPEG при наличии CRS                             | `app.open(file, OpenDocumentType.TIFF)` — JSX        |
| PNG            | Никогда (Camera Raw PNG не поддерживает)                    | Безопасно                                            |
| PSD/PSB        | Никогда                                                     | Безопасно                                            |
| RAW (CR2/NEF…) | Всегда — это их родной формат                               | `DialogModes.NO` (JSX) / `batchPlay dontDisplay` (UXP) — диалог подавляется, настройки применяются молча |

**Важно**: Camera Raw при открытии через скрипт не создаёт Smart Object.
Риск Smart Object возникает только при `Place Embedded / Place Linked` и drag-and-drop.
Camera Raw в режиме `DialogModes.NO` просто обрабатывает файл молча → результат
обычный растровый документ. Дальнейший `flatten() + duplicate()` гарантирует pixel layer.

### Как гарантировать plain pixel layer

Три надёжных метода:

| Метод                                   | Гарантия pixel layer | Clipboard | Скорость |
|-----------------------------------------|----------------------|-----------|----------|
| `flatten() → layer.duplicate(targetDoc)` | ✅ 100%               | Нет       | Быстро   |
| `selectAll() → selection.copy(true) → paste()` | ✅ 100%        | Да        | Медленнее на тяжёлых файлах |
| `Place Embedded / Place Linked`          | ❌ Smart Object       | —         | —        |
| `layer.duplicate()` без flatten (если в источнике SO) | ❌ Риск SO | — | — |

**Рекомендованный подход**: `flatten() → duplicate()`. Clipboard не задействован,
нет риска пересечения с другими операциями, быстро работает на больших файлах.

---

## Блок 2 — Финальная рекомендация

### Для немедленного внедрения в работу ретушера

**`jsx/ClothImporter.jsx`** — скинуть один файл, запустить через `File > Scripts > Browse…`.
Zero setup. Работает в Photoshop 2019 — 2026.

**Почему JSX, а не UXP для быстрого старта:**
- Нет установки и упаковки в `.ccx`
- Синхронное выполнение — проще контролировать порядок операций
- `OpenDocumentType.JPEG/TIFF/PNG` — надёжный обход Camera Raw прямо в API
- Многолетняя стабильность DOM: `flatten()`, `duplicate()`, `close()` работают идентично во всех версиях CC

### Для масштабирования в production-инструмент

**`uxp-plugin/`** — UXP плагин с постоянной панелью, прогресс-баром, настройками.
Устанавливается через [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/devtool/)
и распространяется как `.ccx` через Adobe Marketplace или напрямую.

---

## Блок 3 — Технический план

### Workflow

```
1. Ретушер открывает основной PSD.
2. Запускает ClothImporter.jsx (или плагин).
3. File.openDialog() → выбирает несколько файлов.
4. Для каждого файла:
   a. openFileSafely(file)
      → для JPEG/PNG/TIFF: app.open(file, OpenDocumentType.*)  [обход Camera Raw]
      → для RAW/других:    executeAction с DialogModes.NO
   b. sourceDoc.flatten()
      → все слои → один Background (всегда pixel layer)
   c. bg.duplicate(mainDoc, ElementPlacement.PLACEATBEGINNING)
      → переносим фоновый слой в основной PSD
      → duplicate Background → создаёт обычный ArtLayer (не Background, не Smart Object)
   d. newLayer.name = baseName (имя файла без расширения)
   e. newLayer.move(importGroup, PLACEATBEGINNING)  [если useImportGroup]
   f. sourceDoc.close(SaveOptions.DONOTSAVECHANGES)
5. app.activeDocument = mainDoc
6. mainDoc.activeLayer = lastLayer
```

### Ключевые API

| Операция                          | JSX (ExtendScript)                                | UXP                                        |
|-----------------------------------|---------------------------------------------------|--------------------------------------------|
| Открыть файл                      | `app.open(file, OpenDocumentType.JPEG)`           | `batchPlay([{_obj:"open",...}])`           |
| Подавить Camera Raw диалог        | `executeAction(Opn, desc, DialogModes.NO)`        | batchPlay подавляет диалоги по умолчанию   |
| Схлопнуть все слои                | `doc.flatten()`                                   | `await doc.flatten()`                      |
| Дублировать слой в другой документ | `layer.duplicate(targetDoc, placement)`          | `await layer.duplicate(targetDoc)`         |
| Закрыть без сохранения            | `doc.close(SaveOptions.DONOTSAVECHANGES)`         | `await doc.closeWithoutSaving()`           |
| Создать группу                    | `doc.layerSets.add()` + `.name = "..."`          | `await doc.createLayerGroup({name:...})`   |
| Переместить слой в группу         | `layer.move(group, ElementPlacement.PLACEATBEGINNING)` | batchPlay `move` с `_ref: layerSection` |
| Переименовать слой                | `layer.name = name`                              | `layer.name = name`                        |
| Вернуть фокус                     | `app.activeDocument = mainDoc`                   | `app.activeDocument = mainDoc`             |

### Почему `flatten() + duplicate()`, а не copy-paste

```
flatten() гарантирует:
  - Один Background layer (ArtLayer, kind = NORMAL, isBackground = true)
  - Все Smart Objects разрешены (слиты в пиксели)
  - Нет adjustment layers, text layers, shape layers

duplicate(targetDoc) гарантирует:
  - Перенос пиксельных данных напрямую (без clipboard)
  - Результат: ArtLayer в targetDoc (kind = NORMAL, не Background, не Smart Object)
  - Нет проблем с размером буфера обмена на больших файлах
```

---

## Блок 4 — MVP: ClothImporter.jsx

### Установка и запуск

**Вариант A — Разовый запуск:**
```
Photoshop → File > Scripts > Browse… → ClothImporter.jsx
```

**Вариант B — Постоянный доступ из меню:**
```
Скопировать ClothImporter.jsx в:
  Mac:     /Applications/Adobe Photoshop 2026/Presets/Scripts/
  Windows: C:\Program Files\Adobe\Adobe Photoshop 2026\Presets\Scripts\
Перезапустить Photoshop → скрипт появится в File > Scripts > ClothImporter
```

**Вариант C — Action (горячая клавиша):**
```
1. Actions панель → New Action → назначить F-клавишу
2. В действии: Insert > Menu Item → File > Scripts > ClothImporter
3. Теперь вызывается одной кнопкой
```

### Код

Смотри: [`jsx/ClothImporter.jsx`](jsx/ClothImporter.jsx)

Ключевой фрагмент:

```javascript
function importFile(file, mainDoc, importGroup) {
    var baseName = stripExtension(file.name);

    // 1. Открыть без Camera Raw (для JPEG/PNG/TIFF форсируем тип)
    var sourceDoc = openFileSafely(file);
    app.activeDocument = sourceDoc;

    // 2. Merge all visible → один пиксельный Background
    sourceDoc.flatten();

    // 3. Дублировать в основной PSD (ТОЛЬКО от frontmost документа!)
    var bg = sourceDoc.artLayers[0];
    var newLayer = bg.duplicate(mainDoc, ElementPlacement.PLACEATBEGINNING);
    newLayer.name = baseName;

    // 4. Закрыть источник
    sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = mainDoc;

    // 5. Переместить в группу IMPORT
    if (importGroup) {
        newLayer.move(importGroup, ElementPlacement.PLACEATBEGINNING);
    }

    return newLayer;
}

function openFileSafely(file) {
    var ext = getExtension(file.name);
    switch (ext) {
        case "jpg": case "jpeg": return app.open(file, OpenDocumentType.JPEG);
        case "png":              return app.open(file, OpenDocumentType.PNG);
        case "tif": case "tiff": return app.open(file, OpenDocumentType.TIFF);
        case "psd": case "psb":  return app.open(file, OpenDocumentType.PHOTOSHOP);
        default: // RAW и прочие
            var desc = new ActionDescriptor();
            desc.putPath(charIDToTypeID("null"), new File(file.fsName));
            executeAction(charIDToTypeID("Opn "), desc, DialogModes.NO);
            return app.activeDocument;
    }
}
```

---

## Блок 5 — Улучшения и расширения

### Уже реализовано в Advanced версии

- [x] Три режима импорта: `merged`, `toplayer`, `background`
- [x] Рас теризация Smart Object для режимов `toplayer` и `background`
- [x] Датный префикс в имени слоя: `2026-07-09_filename`
- [x] Порядковый суффикс: `filename_001`
- [x] Детальный лог в консоль ESTK / VS Code
- [x] Время выполнения в итоговом сообщении

### Идеи для дальнейшего развития

#### Фильтрация форматов
```javascript
// Перед File.openDialog — только нужные форматы
var ALLOWED_EXT = ["jpg", "jpeg", "png", "tif", "tiff", "psd", "psb"];
files = files.filter(function(f) {
    return ALLOWED_EXT.indexOf(getExtension(f.name)) !== -1;
});
```

#### Масштабирование слоя под canvas основного PSD
```javascript
// После duplicate — вписать слой в холст mainDoc без искажений
var mainW = mainDoc.width.as("px");
var mainH = mainDoc.height.as("px");
var layerBounds = newLayer.bounds;
var layerW = layerBounds[2].as("px") - layerBounds[0].as("px");
var layerH = layerBounds[3].as("px") - layerBounds[1].as("px");

if (layerW !== mainW || layerH !== mainH) {
    var scaleX = (mainW / layerW) * 100;
    var scaleY = (mainH / layerH) * 100;
    var scale = Math.min(scaleX, scaleY);
    newLayer.resize(scale, scale, AnchorPosition.MIDDLECENTER);
    newLayer.translate(
        (mainW - layerW * scale / 100) / 2 - layerBounds[0].as("px"),
        (mainH - layerH * scale / 100) / 2 - layerBounds[1].as("px")
    );
}
```

#### Обработка десятков файлов — History States батч
```javascript
// Отключить history states на время импорта (ускоряет работу с большими файлами)
var origHistoryStates = app.preferences.maxStates;
app.preferences.maxStates = 1;
// ... импорт ...
app.preferences.maxStates = origHistoryStates;
```

#### Защита: проверить что mainDoc не был закрыт
```javascript
function isDocOpen(doc) {
    try { var _ = doc.name; return true; }
    catch (e) { return false; }
}
// Перед каждым paste/duplicate проверяем mainDoc
if (!isDocOpen(mainDoc)) {
    throw new Error("Основной документ был закрыт во время импорта!");
}
```

#### Восстановление после частичного сбоя
```javascript
// Записать UndoHistory: если что-то пошло не так — откатиться
var historyState = mainDoc.activeHistoryState;
try {
    // ... импорт ...
} catch (e) {
    mainDoc.activeHistoryState = historyState;
    throw e;
}
```

#### Метаданные в имени слоя из файла
```javascript
// Получить EXIF/XMP данные для именования слоя
if (ExternalObject.AdobeXMPScript == undefined) {
    ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
}
var xmp = new XMPMeta(sourceDoc.xmpMetadata.rawData);
var captureDate = xmp.getProperty(XMPConst.NS_EXIF, "DateTimeOriginal");
// → слой называется "2026-07-09_IMG_4521"
```

---

## Сравнение подходов

### Вариант A — JSX / ExtendScript

| Критерий | Оценка |
|----------|--------|
| Установка | Drag & drop в /Scripts/ |
| Старт разработки | 5 минут |
| Версии Photoshop | CC 2015+ |
| Camera Raw bypass | `OpenDocumentType.*` — надёжно |
| Smart Object риск | 0% при flatten+duplicate |
| Поддержка в 2026 | Полная (нет планов убирать) |
| UI возможности | Только системные диалоги (alert, File.openDialog) |
| Async | Нет (синхронный ES3) |
| Масштабируемость | Ограничена (нет нормального UI) |

**Лучше всего для**: быстрого внедрения, одиночного ретушера, минимального оверхеда.

### Вариант B — UXP Scripting (.psjs)

| Критерий | Оценка |
|----------|--------|
| Установка | File > Scripts > Browse (нет установки) |
| Старт разработки | 30 минут |
| Версии Photoshop | 23.5+ (Photoshop 2022+) |
| Camera Raw bypass | `batchPlay open` с `dontDisplay` |
| Smart Object риск | 0% при flatten+duplicate |
| Поддержка в 2026 | Активно развивается |
| UI возможности | Только `app.showAlert()` |
| Async | Полный async/await |
| Масштабируемость | Средняя |

**Лучше всего для**: если нравится современный JS, нет нужды в постоянной панели.

### Вариант C — UXP Plugin

| Критерий | Оценка |
|----------|--------|
| Установка | UXP Developer Tool или .ccx пакет |
| Старт разработки | 2–4 часа |
| Версии Photошop | 23.0+ (Photoshop 2022+) |
| Camera Raw bypass | `batchPlay open` с `dontDisplay` |
| Smart Object риск | 0% при flatten+duplicate |
| Поддержка в 2026 | Официально рекомендован Adobe |
| UI возможности | Полноценный HTML/CSS/JS интерфейс |
| Async | Полный async/await |
| Масштабируемость | Максимальная |
| Распространение | Adobe Marketplace, .ccx |

**Лучше всего для**: production-инструмент, студия, несколько ретушёров, регулярные обновления.

### Вариант D — Action + Script

Не подходит для этой задачи: Action Recorder не умеет записывать `File.openDialog` с
multiselect и динамическим именованием слоёв. Использовать Actions только как shortcut-
launcher для JSX скрипта (Вариант C установки из Блока 4).

---

## Установка UXP плагина (для Блока uxp-plugin/)

1. Скачать [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/devtool/)
2. В UDT: Add Plugin → указать путь к папке `uxp-plugin/`
3. Load Plugin
4. В Photoshop: Plugins > Cloth Importer

Для распространения:
```bash
# Создать .ccx пакет (ZIP со сменой расширения)
zip -r ClothImporter.ccx manifest.json index.html index.js
# Или использовать UDT: Actions > Package Plugin
```

---

## Быстрый старт (TL;DR)

```
1. Открыть основной PSD в Photoshop
2. File > Scripts > Browse…
3. Выбрать jsx/ClothImporter.jsx
4. В диалоге выбрать файлы одежды
5. Готово — слои добавлены в группу IMPORT
```

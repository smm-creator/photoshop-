# Clothes Retouch — Import Open Documents as Raster Layers

## What it does now (Variant A)

1. You open the **master PSD** and keep it active  
2. You open any other photos in Photoshop as tabs (**ARW, JPG, PNG, TIFF, PSD, PSB**, etc.)  
3. You run the script  
4. Script copies every **other open document** into the master as a **normal pixel layer**  
5. Source tabs are closed  
6. Only the master stays open  

**No Explorer / file picker. No format filter.**  
Whatever Photoshop already opened — the script can import.

---

## Download this file

`photoshop-clothes-import/scripts/ImportAsRasterLayers.jsx`

---

## Install forever

1. Copy `ImportAsRasterLayers.jsx` into Photoshop Scripts folder:

**Windows**
```text
C:\Program Files\Adobe\Adobe Photoshop 2026\Presets\Scripts\
```

**Mac**
```text
/Applications/Adobe Photoshop 2026/Presets/Scripts/
```

2. Restart Photoshop  
3. Use: **File → Scripts → ImportAsRasterLayers**

---

## Daily use

1. Open master PSD  
2. Open all needed photos as tabs (including ARW)  
3. Click the **master PSD** tab again  
4. Run **ImportAsRasterLayers**  
5. Done  

---

## Notes

- Active tab must be the master before you run the script  
- Layers go into group `IMPORT` by default  
- Result layers are ordinary pixels, not Smart Objects  
- Also available: `ImportAsRasterLayers.psjs` and `plugin/` panel scaffold  

Docs: `docs/SOLUTION.md`, `docs/ARCHITECTURE.md`

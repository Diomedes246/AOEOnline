// ===== ITEM TILE PICKER =====
// Item tile sheets are loaded in draw.js; we support multiple sheets
window.selectedItemTile = { sheet: 0, tx: 0, ty: 0 }; // tile coordinates and sheet index
window.itemPlacementMode = false; // Track if we're in item placement mode

const itemTilePicker = document.getElementById("itemTilePicker");
const itemTileCanvas = document.getElementById("itemTileCanvas");
const itemPickerCloseBtn = document.getElementById("itemPickerCloseBtn");

if (itemPickerCloseBtn) {
  itemPickerCloseBtn.onclick = () => {
    if (itemTilePicker) itemTilePicker.style.display = "none";
    window.itemPlacementMode = false;
  };
}

// Load tile sheets from window.itemTileSheets (defined in draw.js)
const setupItemTilePicker = () => {
  const sheets = window.itemTileSheets;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    setTimeout(setupItemTilePicker, 100);
    return;
  }

  // Wait until all sheets have finished loading
  const allLoaded = sheets.every(img => img && img.complete);
  if (!allLoaded) {
    const onAnyLoad = () => setTimeout(setupItemTilePicker, 50);
    sheets.forEach(img => { if (img && !img._listenerAdded) { img.addEventListener('load', onAnyLoad, { once: true }); img._listenerAdded = true; }});
    return;
  }

  if (!itemTileCanvas) return;
  const ctx = itemTileCanvas.getContext("2d");
  const tileSize = 32;
  const sheetCols = 512 / tileSize; // 16 columns
  const sheetRowsPerSheet = 3200 / tileSize; // 100 rows per sheet
  const totalSheets = sheets.length;

  // Scale up for visibility
  const displayScale = 2;
  itemTileCanvas.width = 512 * displayScale;
  itemTileCanvas.height = 3200 * totalSheets * displayScale;
  
  ctx.clearRect(0, 0, itemTileCanvas.width, itemTileCanvas.height);
  ctx.imageSmoothingEnabled = false;

  sheets.forEach((img, idx) => {
    const destY = idx * 3200 * displayScale;
    ctx.drawImage(img, 0, 0, 512, 3200, 0, destY, itemTileCanvas.width, 3200 * displayScale);
  });
  
  // Draw grid
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  const totalRows = sheetRowsPerSheet * totalSheets;
  for (let r = 0; r <= totalRows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * tileSize * displayScale);
    ctx.lineTo(itemTileCanvas.width, r * tileSize * displayScale);
    ctx.stroke();
  }
  for (let c = 0; c <= sheetCols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * tileSize * displayScale, 0);
    ctx.lineTo(c * tileSize * displayScale, itemTileCanvas.height);
    ctx.stroke();
  }
};

// Initialize the picker
setupItemTilePicker();

if (itemTileCanvas) {
  itemTileCanvas.onclick = (e) => {
    const rect = itemTileCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const tileSize = 32;
    const displayScale = 2;
    const sheetCols = 512 / tileSize;
    
    const tileX = Math.floor(x / (tileSize * displayScale));
    const tileY = Math.floor(y / (tileSize * displayScale));
    const sheetRowsPerSheet = 3200 / tileSize; // 100 rows
    const sheetIndex = Math.floor(tileY / sheetRowsPerSheet);
    const localTy = tileY % sheetRowsPerSheet;
    window.selectedItemTile = { sheet: sheetIndex, tx: tileX, ty: localTy };
    
    // Redraw with selection highlight
    const ctx = itemTileCanvas.getContext("2d");
    ctx.clearRect(0, 0, itemTileCanvas.width, itemTileCanvas.height);
    ctx.imageSmoothingEnabled = false;
    // redraw stacked sheets
    const sheets = window.itemTileSheets || [];
    sheets.forEach((img, idx) => {
      const destY = idx * 3200 * displayScale;
      ctx.drawImage(img, 0, 0, 512, 3200, 0, destY, itemTileCanvas.width, 3200 * displayScale);
    });
    
    // Draw grid
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    const totalRows = sheetRowsPerSheet * (window.itemTileSheets ? window.itemTileSheets.length : 1);
    for (let r = 0; r <= totalRows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * tileSize * displayScale);
      ctx.lineTo(itemTileCanvas.width, r * tileSize * displayScale);
      ctx.stroke();
    }
    for (let c = 0; c <= sheetCols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * tileSize * displayScale, 0);
      ctx.lineTo(c * tileSize * displayScale, itemTileCanvas.height);
      ctx.stroke();
    }
    
    // Highlight selected tile
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      tileX * tileSize * displayScale,
      tileY * tileSize * displayScale,
      tileSize * displayScale,
      tileSize * displayScale
    );
    
    // Close picker
    if (itemTilePicker) itemTilePicker.style.display = "none";
    
    // Enable item placement mode
    window.itemPlacementMode = true;
  };
}

// Show picker when Create Item button is clicked
const createItemBtn = document.getElementById("createItemBtn");
if (createItemBtn) {
  createItemBtn.onclick = () => {
    if (itemTilePicker) {
      itemTilePicker.style.display = "block";
    }
  };
  
  // Update button appearance based on placement mode
  setInterval(() => {
    if (window.itemPlacementMode) {
      createItemBtn.style.background = "#4a6";
      createItemBtn.style.borderColor = "#6c8";
      createItemBtn.textContent = "Create Item (Active)";
    } else {
      createItemBtn.style.background = "#336";
      createItemBtn.style.borderColor = "#55a";
      createItemBtn.textContent = "Create Item";
    }
  }, 100);
}

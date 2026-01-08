// ===== ITEM TILE PICKER =====
// itemTileSheet is already loaded in draw.js, reference it from there
window.selectedItemTile = { tx: 0, ty: 0 }; // tile coordinates in the sheet
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

// Load tile sheet from window.itemTileSheet (defined in draw.js)
const setupItemTilePicker = () => {
  if (!window.itemTileSheet) {
    // Wait for itemTileSheet to be available
    setTimeout(setupItemTilePicker, 100);
    return;
  }
  
  window.itemTileSheet.onload = () => {
    if (!itemTileCanvas) return;
  const ctx = itemTileCanvas.getContext("2d");
  
  // Sheet is 512x3200 with 32x32 tiles
  const tileSize = 32;
  const sheetCols = 512 / tileSize; // 16 columns
  const sheetRows = 3200 / tileSize; // 100 rows
  
  // Scale up for visibility
  const displayScale = 2;
  itemTileCanvas.width = 512 * displayScale;
  itemTileCanvas.height = 3200 * displayScale;
  
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(window.itemTileSheet, 0, 0, 512, 3200, 0, 0, itemTileCanvas.width, itemTileCanvas.height);
  
  // Draw grid
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  for (let r = 0; r <= sheetRows; r++) {
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
    
    window.selectedItemTile = { tx: tileX, ty: tileY };
    
    // Redraw with selection highlight
    const ctx = itemTileCanvas.getContext("2d");
    ctx.clearRect(0, 0, itemTileCanvas.width, itemTileCanvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(window.itemTileSheet, 0, 0, 512, 3200, 0, 0, itemTileCanvas.width, itemTileCanvas.height);
    
    // Draw grid
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    const sheetRows = 3200 / tileSize;
    for (let r = 0; r <= sheetRows; r++) {
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

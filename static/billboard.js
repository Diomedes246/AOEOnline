// Billboard rendering system - CSS-based isometric billboards

function updateBillboards() {
  const container = document.getElementById('billboards-container');
  if (!container) return;

  // Clear existing billboards
  container.innerHTML = '';

  // Render all billboard map objects
  for (const obj of mapObjects || []) {
    if (obj.kind !== 'billboard') continue;

    // Build text from title and bio
    const title = obj.meta?.title || 'Billboard';
    const bio = obj.meta?.bio || '';
    const owner = obj.owner || (obj.meta && obj.meta.owner) || null;
    
    // Format: Title (bold) + Owner (if exists, in color) + Bio
    let titleHtml = `<div style="font-weight:bold; font-size:18px; margin-bottom:8px;">${title}</div>`;
    if (owner) {
      const ownerColor = (players && players[owner] && players[owner].color) ? players[owner].color : '#ccc';
      titleHtml += `<div style="font-size:12px; color:${ownerColor}; margin-bottom:12px; opacity:0.9;">Owner: ${owner}</div>`;
    }
    const bioHtml = bio ? `<div style="white-space:pre-wrap;">${bio}</div>` : '';
    const contentHtml = titleHtml + bioHtml;
    
    // Calculate screen position
    const sx = canvas.width / 2 + obj.x - camera.x;
    const sy = canvas.height / 2 + obj.y - camera.y;

    // Create billboard element
    const billboard = document.createElement('div');
    billboard.style.position = 'absolute';
    billboard.style.left = sx + 'px';
    billboard.style.top = sy + 'px';
    billboard.style.transform = 'translate(-50%, -100%) rotateX(-45deg) rotateY(45deg)';
    billboard.style.transformOrigin = 'center bottom';
    billboard.style.width = '300px';
    billboard.style.minHeight = '150px';
    billboard.style.padding = '20px';
    billboard.style.background = 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)';
    billboard.style.border = '4px solid #8B4513';
    billboard.style.borderRadius = '8px';
    billboard.style.boxShadow = '0 10px 30px rgba(0,0,0,0.8), inset 0 2px 4px rgba(255,255,255,0.1)';
    billboard.style.color = 'white';
    billboard.style.fontSize = '16px';
    billboard.style.fontFamily = 'monospace';
    billboard.style.whiteSpace = 'pre-wrap';
    billboard.style.wordWrap = 'break-word';
    billboard.style.lineHeight = '1.4';
    billboard.style.pointerEvents = 'none';
    billboard.style.userSelect = 'none';
    billboard.innerHTML = contentHtml;

    // Add editor selection highlight
    if (editorMode && window.selectedEditorEntity && obj.id === window.selectedEditorEntity.id) {
      billboard.style.border = '4px solid lime';
      billboard.style.boxShadow = '0 0 20px lime, 0 10px 30px rgba(0,0,0,0.8)';
    }

    container.appendChild(billboard);
  }
}

// Call this from the main draw loop
if (typeof window.billboardUpdateScheduled === 'undefined') {
  window.billboardUpdateScheduled = false;
}

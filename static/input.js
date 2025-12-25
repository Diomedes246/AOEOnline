// Input logic moved from index.html

/* ================= CAMERA ================= */
const camSpeed = 12;
const keys = {};
document.addEventListener("keydown", (e) => {
  keys[e.key] = true;

  // Toggle collision on/off while in editor
  if (!e.repeat && editorMode && (e.key === "c" || e.key === "C")) {
    editorCollisionEnabled = !editorCollisionEnabled;
  }
});

document.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});

canvas.addEventListener("mousemove", e=>{
  mouse.x = e.clientX;
  mouse.y = e.clientY;

  const wx = camera.x + mouse.x - canvas.width/2;
  const wy = camera.y + mouse.y - canvas.height/2;

  hoveredResource = null;
  hoveredPlayerSid = null;
  canvas.title = "";

    // Ground item hover (priority 0)
  hoveredGroundItem = null;
  for (const it of groundItems) {
    if (Math.hypot(it.x - wx, it.y - wy) < 18) {
      hoveredGroundItem = it;
      const statTxt = itemStatText ? itemStatText(it.name) : "";
      const label = it.name || "item";
      canvas.title = statTxt ? `${label} — ${statTxt}` : label;
      canvas.style.cursor = "grab";
      break;
    }
  }
 if (hoveredGroundItem && !draggingPickup) return;


  // Resource hover (priority 1)
  for(const r of resources){
    if(Math.hypot(r.x-wx, r.y-wy) < RESOURCE_RADIUS){
      hoveredResource = r;
      canvas.style.cursor = "pointer";
      return;
    }
  }

  // Player hover (priority 2)
  for(const sid in players){
    if(sid === mySid) continue;
    const p = players[sid];
    if(Math.hypot(p.x-wx, p.y-wy) < 20){
      hoveredPlayerSid = sid;
      canvas.style.cursor = "crosshair";
      return;
    }
  }

  // Entity hover (priority 3) - show attack hover for enemy entities
  hoveredAttackEntity = null;
  for (let i = (mapObjects || []).length - 1; i >= 0; i--) {
    const o = mapObjects[i];
    if (!o || !o.meta || !o.meta.entity) continue;
    // only consider enemy-owned entities
    if (o.owner === mySid) continue;
    // only buildings, town centers, or mines are attackable
    if (!(o.type === 'building' || o.kind === 'town_center' || o.kind === 'mine')) continue;

    // compute collision extents
    let w = BUILD_W, h = BUILD_H;
    if (o.type === 'building') { w = BUILD_W; h = BUILD_H; }
    else { const def = TILE_DEFS[o.kind] || { w: 256, h: 256 }; w = o.meta?.w ?? def.w; h = o.meta?.h ?? def.h; }

    if (Math.abs(wx - o.x) < w/2 && Math.abs(wy - o.y) < h/2) {
      hoveredAttackEntity = o;
      canvas.style.cursor = 'crosshair';
      return;
    }
  }

  canvas.style.cursor = "default";
});

function getFirstSelectedUnit() {
  return myUnits.find(u => u.selected) || null;
}

function findSlotElementAtScreen(x, y) {
  // Use bounding-rect hit testing for reliability across overlays
  try {
    // Prefer entity slots first (so dragging from ground targets chests/containers)
    const entityList = document.getElementById("entity-items-list");
    if (entityList) {
      const lis = entityList.querySelectorAll("li");
      // First pass: exact hit test
      for (const li of lis) {
        const r = li.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return li;
        }
      }
      // Second pass: with generous padding for compact slots
      const PAD = 15;
      for (const li of lis) {
        const r = li.getBoundingClientRect();
        if (x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD) {
          return li;
        }
      }
    }

    // Then check unit slots
    const unitList = document.getElementById("items-list");
    if (unitList) {
      const lis = unitList.querySelectorAll("li");
      for (const li of lis) {
        const r = li.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return li;
        }
      }
    }
  } catch (e) {
    // ignore and try DOM hit test below
  }

  // Fallback: use elementFromPoint to find closest li (covers cases where rect scanning missed)
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const entitySlot = el.closest && el.closest("#entity-items-list li");
  if (entitySlot) return entitySlot;
  const unitSlot = el.closest && el.closest("#items-list li");
  if (unitSlot) return unitSlot;

  return null;
}

function updateSelectedUnits() {
    // Build the lookup table from current live data
    allUnits[mySid] = myUnits;
    for (const sid in players) {
        allUnits[sid] = players[sid].units || [];
    }

    selectedUnits = myUnits.filter(u => u.selected).map(u => u.id);

    renderUnitPanel();

    // If nothing selected, clear items UI
    if (selectedUnits.length === 0) {
        document.getElementById("items-list").innerHTML = "";
        return;
    }

    // Auto-show items for first selected unit (local units have items)
    const unit = findUnitById(selectedUnits[0]);
    if (unit) renderUnitItems(unit);
}

function hitTestMapObject(wx, wy) {
  // pick topmost by render order: scan from end (mapObjects drawn in order)
  for (let i = mapObjects.length - 1; i >= 0; i--) {
    const o = mapObjects[i];
    if (!o.meta || !o.meta.entity) continue;

    if (o.type === "building") {
      // building uses BUILD_W/H
      if (Math.abs(wx - o.x) < BUILD_W / 2 && Math.abs(wy - o.y) < BUILD_H / 2) return o;
    } else if (o.type === "tile") {
      const def = TILE_DEFS[o.kind] || { w: 256, h: 256 };
      const w = o.meta?.w ?? def.w;
      const h = o.meta?.h ?? def.h;
      if (Math.abs(wx - o.x) < w / 2 && Math.abs(wy - o.y) < h / 2) return o;
    }
  }
  return null;
}

canvas.addEventListener("mousedown", e => {
  const wx = camera.x + mouse.x - canvas.width / 2;
  const wy = camera.y + mouse.y - canvas.height / 2;

  // ✅ Shift-delete in editor mode FIRST (highest priority)
  if (editorMode && e.button === 0 && e.shiftKey) {
    let nearest = null, best = 40, nearestType = null;
    for (const o of mapObjects) {
      const d = Math.hypot(o.x - wx, o.y - wy);
      if (d < best) { best = d; nearest = o; nearestType = 'map'; }
    }
    for (const g of groundItems || []) {
      const d = Math.hypot(g.x - wx, g.y - wy);
      if (d < best) { best = d; nearest = g; nearestType = 'ground'; }
    }
    if (nearest) {
      if (nearestType === 'map') socket.emit("delete_map_object", { id: nearest.id });
      else socket.emit("delete_ground_item", { id: nearest.id });
      e.preventDefault();
      return;
    }
  }

  // ✅ Check for ground item drag (before entity inspect or editor placement)
  if (e.button === 0 && !e.shiftKey) {
    const hit = groundItems.find(it => Math.hypot(it.x - wx, it.y - wy) < 18);
    if (hit) {
      const picker = getFirstSelectedUnit();
      const canPickupWithUnit = picker ? unitCanPickup(picker, hit) : false;
      draggingPickup = { groundItemId: hit.id, itemName: hit.name };
      if (picker && canPickupWithUnit) draggingPickup.unitId = picker.id;

      dragMouse.x = e.clientX;
      dragMouse.y = e.clientY;

      // Create drag ghost above DOM
      createDragGhost(hit.name || 'item');
      
      // CAPTURE events globally so UI can't "steal" the drag
      const dragMoveHandler = (ev) => {
        dragMouse.x = ev.clientX;
        dragMouse.y = ev.clientY;
        updateDragGhost(ev.clientX, ev.clientY);
        
        // Highlight slots when hovering during ground item drag
        if (draggingPickup && draggingPickup.groundItemId) {
          const slotEl = findSlotElementAtScreen(ev.clientX, ev.clientY);
          document.querySelectorAll("li[data-slot-index]").forEach(li => {
            li.style.outline = "";
            li.style.backgroundColor = "";
          });
          if (slotEl) {
            slotEl.style.outline = "3px solid #0ff";
            slotEl.style.backgroundColor = "rgba(0,255,255,0.2)";
          }
        }
        ev.preventDefault();
      };
      
      window.addEventListener("mousemove", dragMoveHandler, true);
      window.addEventListener("mouseup", onGlobalDragEnd, true);

      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }

  // ✅ Click entity to inspect
  if (e.button === 0) {
    const hitEntity = hitTestMapObject(wx, wy);
    if (hitEntity) {
      openEntityInspector(hitEntity);
      e.preventDefault();
      return;
    }
  }

  // ✅ Editor placement (non-shift click)
  if (editorMode && e.button === 0 && !e.shiftKey) {

const [type, kind] = brushSelect.value.split(":");

let meta = (type === "tile") ? {
  collides: editorCollisionEnabled,
  cw: editorCollisionW,
  ch: editorCollisionH,
  w: editorTileW,
  h: editorTileH
} : {};

if (entityMode) {
  meta = {
    ...meta,
    entity: true,
    title: (type === "tile") ? prettyName(kind) : "Building",
    bio: "",
    actions: []
  };
}

socket.emit("place_map_object", { type, kind, x: wx, y: wy, meta });

    return;
  }

  if (e.button === 0) { // left click

    // ===== Build placement =====
  if (buildMode && !localBuildingPlaced) {
    // require TOWN_CENTER_COST resources to place a town center
    if (((window.resourceCounts && window.resourceCounts.red) || 0) < (typeof TOWN_CENTER_COST === 'number' ? TOWN_CENTER_COST : 5)) {
      try { buildMode = false; localBuildingPlaced = false; buildBtn.disabled = false; } catch(e){}
      alert(`Not enough red resources to build Town Center (requires ${typeof TOWN_CENTER_COST === 'number' ? TOWN_CENTER_COST : 5})`);
      return;
    }
    // Spawn a persistent map object (tile) using the building tile image
    // Server will persist and broadcast via `map_objects`.
    localBuildingPlaced = true;
    buildMode = false;
    buildBtn.disabled = true;
    const meta = {
      entity: true,
      title: "Building",
      bio: "",
      actions: [],
      collides: true,
      cw: BUILD_W,
      ch: BUILD_H,
      w: BUILD_W,
      h: BUILD_H
    };
    socket.emit("place_map_object", { type: "tile", kind: "town_center", x: wx, y: wy, meta });
    return;
  }

    // ===== Mine placement =====
    if (mineMode && !localMinePlaced) {
      const mineCost = 3;
      try { console.log('MINE: attempting placement'); } catch(e){}
      if (((window.resourceCounts && window.resourceCounts.blue) || 0) < mineCost) {
        try { mineMode = false; localMinePlaced = false; mineBtn.disabled = false; } catch(e){}
        alert(`Not enough blue resources to build Mine (requires ${mineCost})`);
        return;
      }
      localMinePlaced = true;
      mineMode = false;
      try { mineBtn.disabled = true; } catch(e){}
      const meta = {
        entity: true,
        title: "Mine",
        bio: "",
        actions: [],
        collides: true,
        cw: MINE_W,
        ch: MINE_H,
        w: MINE_W,
        h: MINE_H
      };
      socket.emit("place_map_object", { type: "tile", kind: "mine", x: wx, y: wy, meta });
      return;
    }

    // ===== Blacksmith placement =====
    if (blacksmithMode && !localBlacksmithPlaced) {
      const smithCost = 3;
      try { console.log('SMITH: attempting placement'); } catch(e){}
      if (((window.resourceCounts && window.resourceCounts.red) || 0) < smithCost) {
        try { blacksmithMode = false; localBlacksmithPlaced = false; if (blacksmithBtn) blacksmithBtn.disabled = false; } catch(e){}
        alert(`Not enough red resources to build Blacksmith (requires ${smithCost})`);
        return;
      }
      localBlacksmithPlaced = true;
      blacksmithMode = false;
      try { if (blacksmithBtn) blacksmithBtn.disabled = true; } catch(e){}
      const meta = {
        entity: true,
        title: "Blacksmith",
        bio: "",
        actions: [],
        collides: true,
        cw: BLACKSMITH_W,
        ch: BLACKSMITH_H,
        w: BLACKSMITH_W,
        h: BLACKSMITH_H
      };
      socket.emit("place_map_object", { type: "tile", kind: "blacksmith", x: wx, y: wy, meta });
      return;
    }

    // ===== Check for building click =====
    let clickedBuilding = null;
    for (const b of buildings) {
      const bx = canvas.width / 2 + b.x - camera.x;
      const by = canvas.height / 2 + b.y - camera.y;
      const dx = Math.abs(mouse.x - bx);
      const dy = Math.abs(mouse.y - by);
      if (dx < BUILD_W / 2 && dy < BUILD_H / 2) {
        clickedBuilding = b;
        break;
      }
    }

    if (clickedBuilding && clickedBuilding.owner === mySid) {
      buildings.forEach(b => b.selected = false);
      clickedBuilding.selected = true;
      buildingPanel.style.display = "block";
      panel.style.display = "none";
      selecting = false;
      updateSelectedUnits(); // <-- sync panel
      return;
    }

    // ===== Check for unit click =====
    let clickedUnit = null;
    for (const u of myUnits) {
      const ux = canvas.width / 2 + u.x - camera.x;
      const uy = canvas.height / 2 + u.y - camera.y;
      if (Math.hypot(mouse.x - ux, mouse.y - uy) < 20) {
        clickedUnit = u;
        break;
      }
    }

    if (clickedUnit) {
      myUnits.forEach(u => u.selected = false);
      clickedUnit.selected = true;

        updateSelectedUnits(); // <-- sync panel
      selecting = false;
      return;
    }

    // ===== Clicked empty space =====
    buildings.forEach(b => b.selected = false);
    buildingPanel.style.display = "none";
    myUnits.forEach(u => u.selected = false);
    updateSelectedUnits(); // <-- sync panel
    // Start selection box
    selecting = true;
    selectStart.x = mouse.x;
    selectStart.y = mouse.y;
  }
});

function onGlobalDragMove(e) {
  dragMouse.x = e.clientX;
  dragMouse.y = e.clientY;

  // Update drag ghost position
  updateDragGhost(e.clientX, e.clientY);

  // Highlight slots when hovering during ground item drag
  if (draggingPickup && draggingPickup.groundItemId) {
    const slotEl = findSlotElementAtScreen(e.clientX, e.clientY);
    // Clear previous highlights
    document.querySelectorAll("li[data-slot-index]").forEach(li => {
      li.style.outline = "";
      li.style.backgroundColor = "";
    });
    // Highlight current slot
    if (slotEl) {
      slotEl.style.outline = "3px solid #0ff";
      slotEl.style.backgroundColor = "rgba(0,255,255,0.2)";
    }
  }

  e.preventDefault();
}

// Drag ghost visual (renders above DOM)
function createDragGhost(name) {
  removeDragGhost();
  const g = document.createElement('div');
  g.id = 'drag-ghost';
  g.style.position = 'fixed';
  g.style.pointerEvents = 'none';
  g.style.zIndex = '999999';
  g.style.width = '40px';
  g.style.height = '40px';
  g.style.background = 'rgba(100,150,255,0.8)';
  g.style.border = '2px solid #fff';
  g.style.borderRadius = '4px';
  g.style.display = 'flex';
  g.style.alignItems = 'center';
  g.style.justifyContent = 'center';
  g.style.color = '#fff';
  g.style.fontSize = '12px';
  g.style.fontWeight = 'bold';
  g.textContent = name.substring(0, 3).toUpperCase();
  document.body.appendChild(g);
}

function updateDragGhost(x, y) {
  const g = document.getElementById('drag-ghost');
  if (g) {
    g.style.left = (x - 20) + 'px';
    g.style.top = (y - 20) + 'px';
  }
}

function removeDragGhost() {
  const g = document.getElementById('drag-ghost');
  if (g && g.parentNode) g.parentNode.removeChild(g);
}

// Ensure cleanup also occurs on mouseup anywhere as a fallback
// BUT only if onGlobalDragEnd isn't handling it
let dragEndHandled = false;
document.addEventListener('mouseup', () => {
  setTimeout(() => {
    try { 
      if (!dragEndHandled && window.cleanupDragState) window.cleanupDragState(); 
    } catch (e) {}
  }, 100);
}, true);

function onGlobalDragEnd(e) {
  dragEndHandled = true;
  
  function finalizeDragCleanup() {
    try { window.removeEventListener("mousemove", onGlobalDragMove, true); } catch (ex) {}
    try { window.removeEventListener("mouseup", onGlobalDragEnd, true); } catch (ex) {}
    try { draggingPickup = null; } catch (ex) {}
    try { dragMouse.x = 0; dragMouse.y = 0; } catch (ex) {}
    try { canvas.style.cursor = "default"; } catch (ex) {}
    try { removeDragGhost(); } catch (ex) {}
    try { document.querySelectorAll("li[data-slot-index]").forEach(li => { li.style.outline = ""; li.style.backgroundColor = ""; }); } catch (ex) {}
    try { setTimeout(()=>{ if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); }, 0); } catch (ex) {}
    dragEndHandled = false;
  }

  // expose a global cleanup in case other modules need to force-remove the drag state
  try { window.cleanupDragState = function(){ try{ draggingPickup = null; }catch(e){} try{ removeDragGhost(); }catch(e){} try{ document.querySelectorAll("li[data-slot-index]").forEach(li => li.style.outline = ""); }catch(e){} }; } catch (ex) {}

  if (!draggingPickup) { 
    finalizeDragCleanup(); 
    return; 
  }

  const gi = groundItems.find(x => x.id === draggingPickup.groundItemId);
  const picker = myUnits.find(u => u.id === draggingPickup.unitId);
  const dragData = draggingPickup; // Save reference before cleanup
  draggingPickup = null;

  if (!gi) { finalizeDragCleanup(); return; }

  // NOTE: range check for pickup is only required when dropping into a unit slot.

  // must drop on a slot
  let slotEl = findSlotElementAtScreen(e.clientX, e.clientY);
  if (!slotEl) {
    // Fallback: try nearest entity slot if user released slightly off-target
    const entityList = document.getElementById("entity-items-list");
    if (entityList) {
      let best = null;
      let bestDist = Infinity;
      const lis = entityList.querySelectorAll('li');
      for (const li of lis) {
        const r = li.getBoundingClientRect();
        // center distance
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const d = Math.hypot(dx, dy);
        if (d < bestDist) { bestDist = d; best = li; }
        // immediate accept if inside expanded rect
        const PAD = 20;
        if (e.clientX >= r.left - PAD && e.clientX <= r.right + PAD && e.clientY >= r.top - PAD && e.clientY <= r.bottom + PAD) {
          best = li; bestDist = d; break;
        }
      }
      if (best && bestDist < 80) {
        slotEl = best;
      } else {
        finalizeDragCleanup();
        return;
      }
    } else {
      finalizeDragCleanup();
      return;
    }
  }

  const slotIndex = parseInt(slotEl.dataset.slotIndex, 10);
  
  // Check if this is an entity slot
  const entityId = slotEl.dataset.entityId;
  if (entityId) {
    // Ground -> Entity drop
    socket.emit("ground_give_to_entity", {
      entityId,
      entitySlotIndex: slotIndex,
      groundItemId: gi.id
    });
    // Optimistic local update: remove ground item and add to entity slot
    try {
      const giIndexLocal = groundItems.findIndex(g => g.id === gi.id);
      if (giIndexLocal !== -1) groundItems.splice(giIndexLocal, 1);
      const entLocal = mapObjects.find(m => m.id === entityId);
      if (entLocal) {
        entLocal.itemSlots = entLocal.itemSlots || [];
        entLocal.itemSlots[slotIndex] = { id: gi.id, name: gi.name };
        if (selectedEntityId === entityId) openEntityInspector(entLocal);
      }
    } catch (ex) { console.error("optimistic ground->entity update failed", ex); }
    finalizeDragCleanup();
    return;
  }

  // Check if this is a unit slot
  const unitId = slotEl.dataset.unitId;
  if (!unitId) { finalizeDragCleanup(); return; }
  
  const targetUnit = myUnits.find(u => u.id === unitId);
  if (!targetUnit) { finalizeDragCleanup(); return; }

  if (!targetUnit.itemSlots) targetUnit.itemSlots = [null, null];
  if (targetUnit.itemSlots[slotIndex]) return; // must be empty
  // Ensure we have a unit picker in range for unit-slot pickups
  if (!picker || !unitCanPickup(picker, gi)) {
    finalizeDragCleanup();
    return;
  }

  socket.emit("pickup_item", {
    unitId: targetUnit.id,
    slotIndex,
    groundItemId: gi.id
  });
  // Optimistic local update: remove ground item and add to unit slot immediately
  try {
    const giIndexLocal = groundItems.findIndex(g => g.id === gi.id);
    if (giIndexLocal !== -1) groundItems.splice(giIndexLocal, 1);
    targetUnit.itemSlots = targetUnit.itemSlots || [];
    targetUnit.itemSlots[slotIndex] = { id: ("local-" + (gi.id || Math.random())), name: gi.name || "item" };
    if (currentItemsUnitId === targetUnit.id) renderUnitItems(targetUnit);
  } catch (ex) { console.error("optimistic pickup_item failed", ex); }
  finalizeDragCleanup();
}

// OLD CANVAS MOUSEUP HANDLER REMOVED
// Ground item drag/drop now handled by onGlobalDragEnd which supports both unit slots AND entity slots

canvas.addEventListener("mouseup", e=>{
  if(e.button===0){
    selecting=false;

    const x1=Math.min(selectStart.x,mouse.x);
    const y1=Math.min(selectStart.y,mouse.y);
    const x2=Math.max(selectStart.x,mouse.x);
    const y2=Math.max(selectStart.y,mouse.y);
    for(const u of myUnits){
      const sx=canvas.width/2+u.x-camera.x;
      const sy=canvas.height/2+u.y-camera.y;
      u.selected=(sx>=x1&&sx<=x2 && sy>=y1&&sy<=y2);
    }
    updateSelectedUnits(); // <-- sync panel
  } 

      if(e.button === 2){ // right click
        const wx = camera.x + mouse.x - canvas.width/2;
        const wy = camera.y + mouse.y - canvas.height/2;

        let clickedResource = null;
        let clickedPlayerSid = null;

        for(const r of resources){
            if(Math.hypot(r.x-wx,r.y-wy) < RESOURCE_RADIUS){
                clickedResource = r;
                break;
            }
        }

        if(!clickedResource){
            for(const sid in players){
                if(sid === mySid) continue;
                const p = players[sid];
                if(Math.hypot(p.x-wx,p.y-wy) < 20){
                    clickedPlayerSid = sid;
                    break;
                }
            }
        }

        const selectedUnits = myUnits.filter(u => u.selected);

        // Helper: find a map entity at world coords (point-in-rect using meta collision or size)
        function findEntityAt(wx, wy) {
          for (const o of (mapObjects || [])) {
            if (!o.meta?.entity) continue;
            // Use collision box if present; otherwise tile size or sensible defaults
            if (o.type === "building") {
              var w = BUILD_W, h = BUILD_H;
            } else {
              const def = TILE_DEFS[o.kind] || { w: 256, h: 256 };
              var w = o.meta?.cw ?? o.meta?.w ?? def.w;
              var h = o.meta?.ch ?? o.meta?.h ?? def.h;
            }
            const left = o.x - w/2;
            const right = o.x + w/2;
            const top = o.y - h/2;
            const bottom = o.y + h/2;
            if (wx >= left && wx <= right && wy >= top && wy <= bottom) return o;
          }
          return null;
        }

        let clickedEntity = findEntityAt(wx, wy);
        // If hit-test fails but we have an attack-hovered entity, use it as the clicked entity.
        if (!clickedEntity && typeof hoveredAttackEntity !== 'undefined' && hoveredAttackEntity) {
          clickedEntity = hoveredAttackEntity;
        }

        // Assign a stable formation index and total so units keep their relative positions
        selectedUnits.forEach((u, idx) => {
          u._formationIndex = idx;
          u._formationTotal = selectedUnits.length;

          u.targetEnemy = null;
          u.harvesting = null;

          // If clicking an enemy entity, set unit to attack that entity instead of moving to its center
          if (clickedEntity && clickedEntity.owner !== mySid) {
            // compute an attack approach point on the entity perimeter so collision doesn't block engagement
            const cw = (clickedEntity.meta && clickedEntity.meta.cw) ? clickedEntity.meta.cw : (clickedEntity.meta && clickedEntity.meta.w ? clickedEntity.meta.w : BUILD_W);
            const ch = (clickedEntity.meta && clickedEntity.meta.ch) ? clickedEntity.meta.ch : (clickedEntity.meta && clickedEntity.meta.h ? clickedEntity.meta.h : BUILD_H);
            const entRadius = Math.max(cw, ch) / 2;
            const dxToEnt = clickedEntity.x - u.x;
            const dyToEnt = clickedEntity.y - u.y;
            const distToEnt = Math.hypot(dxToEnt, dyToEnt) || 1;
            const nx = dxToEnt / distToEnt;
            const ny = dyToEnt / distToEnt;
            // desired distance from center so effective distance <= UNIT_ATTACK_RANGE
            const desiredDist = entRadius + UNIT_ATTACK_RANGE - 4; // small buffer
            const attackX = clickedEntity.x - nx * desiredDist;
            const attackY = clickedEntity.y - ny * desiredDist;

            u.targetEnemy = {
              kind: 'entity',
              entityId: clickedEntity.id,
              x: clickedEntity.x,
              y: clickedEntity.y,
              attackPoint: { x: attackX, y: attackY },
              userIssued: true // keep attack order even when far away
            };
            u.manualMove = false;
          } else if (clickedResource) {
            // ✅ resource gather command
            u.targetResource = clickedResource.id;
            u.manualMove = false;            // ✅ IMPORTANT: don't get stuck in manualMove
            u.tx = clickedResource.x;        // move toward resource center
            u.ty = clickedResource.y;
          } else {
            // normal move command
            u.targetResource = null;
            u.tx = wx;
            u.ty = wy;
            u.manualMove = true;
          }
        });

        
    }
});

canvas.addEventListener("contextmenu", e=>e.preventDefault());

canvas.addEventListener("dragover", (e) => {
  e.preventDefault(); // allow drop
});

canvas.addEventListener("drop", (e) => {
  e.preventDefault();

  const payloadStr = e.dataTransfer.getData("application/json");
  if (!payloadStr) return;

  let payload;
  try { payload = JSON.parse(payloadStr); } catch { return; }

  // Convert screen -> world
  const wx = camera.x + e.clientX - canvas.width / 2;
  const wy = camera.y + e.clientY - canvas.height / 2;

  // Dropping equipment item onto world => SERVER creates ground item
  if (payload.type === "unit_item") {
    console.log("canvas drop unit_item -> ground", payload, { x: wx, y: wy });
    socket.emit("drop_item", {
      unitId: payload.unitId,
      slotIndex: payload.slotIndex,
      x: wx,
      y: wy
    });
    return;
  }
});

function setEntityInspectorEditable(canEdit) {
  const titleInput = document.getElementById("entityTitleInput");
  const bioInput = document.getElementById("entityBioInput");
  const addBtn = document.getElementById("entityAddActionBtn");
  const saveBtn = document.getElementById("entitySaveBtn");
  const deleteBtn = document.getElementById("entityDeleteBtn");

  titleInput.disabled = !canEdit;
  bioInput.disabled = !canEdit;
  addBtn.disabled = !canEdit;
  saveBtn.disabled = !canEdit;
  deleteBtn.disabled = !canEdit;

  // Optional visual cue
  titleInput.style.opacity = canEdit ? "1" : "0.7";
  bioInput.style.opacity   = canEdit ? "1" : "0.7";
}

function ensureEntityMeta(o) {
  if (!o.meta) o.meta = {};
  if (!o.meta.entity) o.meta.entity = true;
  if (typeof o.meta.title !== "string") o.meta.title = "";
  if (typeof o.meta.bio !== "string") o.meta.bio = "";
  if (!Array.isArray(o.meta.actions)) o.meta.actions = [];
}

function getDefaultEntityTitle(o) {
  if (o.type === "building") return "Building";
  if (o.type === "tile") return o.kind ? prettyName(o.kind) : "Tile";
  return "Entity";
}

function openEntityInspector(o) {
  ensureEntityMeta(o);
  selectedEntityId = o.id;

  entityIdLine.textContent =
    `id: ${o.id} | type: ${o.type}${o.kind ? " | kind: " + o.kind : ""}`;

  entityTitleInput.value = o.meta.title || getDefaultEntityTitle(o);
  entityBioInput.value = o.meta.bio || "";

  renderEntityActions(o);

  // ✅ Only allow editing TILE title/bio when editor mode is ON
  const isTile = (o.type === "tile");
  const canEdit = !(isTile && !editorMode);
  setEntityInspectorEditable(canEdit);

  // Optional: make it obvious why it's locked
  if (!canEdit) {
    entityIdLine.textContent += "  |  (read-only: enable Editor to edit tile text)";
  }

  entityPanelEl.style.display = "block";
}

function renderEntityActions(o) {
  const listEl = document.getElementById("entityActionsList");
  listEl.innerHTML = "";
  ensureEntityMeta(o);

  for (let i = 0; i < o.meta.actions.length; i++) {
    const a = o.meta.actions[i];

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "4px";
    wrap.style.alignItems = "center";

    const btn = document.createElement("button");
    btn.textContent = a.label || `Action ${i+1}`;
    btn.style.height = "26px";

    btn.onclick = () => {
      socket.emit("entity_action", { entityId: o.id, actionId: a.id, label: a.label });
    };

    const del = document.createElement("button");
    del.textContent = "✕";
    del.style.height = "26px";
    del.onclick = () => {
      o.meta.actions.splice(i, 1);
      renderEntityActions(o);
    };

    wrap.appendChild(btn);
    wrap.appendChild(del);
    listEl.appendChild(wrap);
  }
}

const createUnitBtn = document.getElementById("createUnitBtn");
createUnitBtn.onclick = () => {
    const selectedBuilding = buildings.find(b => b.selected && b.owner === mySid);
    if (!selectedBuilding) return;

    const radius = BUILD_W / 2 + 30; // spawn outside building
    const unitsToSpawn = 1; // you can increase this if creating multiple units at once

    // Count how many units are already around this building
    const existingUnits = myUnits.filter(u => Math.hypot(u.x - selectedBuilding.x, u.y - selectedBuilding.y) < radius + 20);
    const startIndex = existingUnits.length;

    for (let i = 0; i < unitsToSpawn; i++) {
        const idx = startIndex + i;
        const angle = (idx * 45) * Math.PI / 180; // spread units 45° apart
        const spawnX = selectedBuilding.x + Math.cos(angle) * radius;
        const spawnY = selectedBuilding.y + Math.sin(angle) * radius;

const newUnit = {
    id: crypto.randomUUID(), // or a simple incrementing counter
    x: spawnX,
    y: spawnY,
    tx: spawnX,
    ty: spawnY,
    selected: false,
    targetResource: null,
    targetEnemy: null,
    anim: "idle",
    frame: 0,
    attackFrame: 0,
    dir: "000",
    hp: UNIT_MAX_HEALTH,
    attackCooldown: 0,
    manualMove: false,
    lastX: spawnX,
    lastY: spawnY,
   itemSlots: [
  { id: crypto.randomUUID(), name: "sword" },
  { id: crypto.randomUUID(), name: "shield" }
]
};
myUnits.push(newUnit);
socket.emit("spawn_unit", { unit: newUnit });

    }
};

// Ensure build button works even if element wasn't present at script load
document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (!t) return;
  if (t.id === 'buildBtn' || (t.closest && t.closest('#buildBtn'))) {
    if (!localBuildingPlaced) buildMode = true;
    try { console.log('BUILD: buildMode ON'); } catch(e){}
  }
  if (t.id === 'mineBtn' || (t.closest && t.closest('#mineBtn'))) {
    if (!localMinePlaced) {
      mineMode = true;
      try { console.log('MINE: mineMode ON'); } catch(e){}
    }
  }
  if (t.id === 'blacksmithBtn' || (t.closest && t.closest('#blacksmithBtn'))) {
    if (!localBlacksmithPlaced) {
      blacksmithMode = true;
      try { console.log('SMITH: blacksmithMode ON'); } catch(e){}
    }
  }
});

// editor collision globals are declared in index.html to avoid duplicates

const editorBtn = document.getElementById("editorBtn");
editorBtn.onclick = () => {
  editorMode = !editorMode;
  editorBtn.textContent = editorMode ? "Editor: ON" : "Editor: OFF";
};

const entityBtn = document.getElementById("entityBtn");
if (entityBtn) {
  entityBtn.onclick = () => {
    entityMode = !entityMode;
    entityBtn.textContent = entityMode ? "Entity: ON" : "Entity: OFF";
  };
}
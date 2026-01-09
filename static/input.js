// Input logic moved from index.html

// Ensure collision debug flag exists even if scripts load out of order
if (typeof DEBUG_COLLISIONS === "undefined") {
  window.DEBUG_COLLISIONS = false;
}

function getCurrentZOrder() {
  const zInput = document.getElementById("zOrderInput");
  const v = parseInt(zInput && zInput.value, 10);
  return Number.isFinite(v) ? v : 0;
}

function resetCollisionOffset() {
  editorCollisionOffsetX = 0;
  editorCollisionOffsetY = 0;
}

// ===== Loose item cache (ground + map-placed items) =====
if (typeof window.looseItemCache === "undefined") window.looseItemCache = [];

function normalizeGroundLooseItem(gi) {
  if (!gi) return null;
  const stats = (gi.itemStats && typeof gi.itemStats === "object") ? gi.itemStats : gi;
  const name = stats?.name || gi.name || "Item";
  const statTxt = typeof itemStatText === "function" ? itemStatText(stats) : "";
  return {
    id: gi.id,
    source: "ground",
    groundId: gi.id,
    x: Number(gi.x) || 0,
    y: Number(gi.y) || 0,
    name,
    radius: 18,
    statText: statTxt,
    label: statTxt ? `${name} — ${statTxt}` : name
  };
}

function normalizeMapLooseItem(obj) {
  if (!obj) return null;
  const meta = obj.meta || {};
  const stats = meta.itemStats || {};
  // For items, use only itemStats.name; for other entities use meta.title
  const name = (obj.kind === 'item') ? (stats.name || 'Item') : (stats.name || meta.title || 'Item');
  const statTxt = typeof itemStatText === "function" ? itemStatText(stats) : "";
  return {
    id: obj.id,
    source: "map",
    mapObjectId: obj.id,
    x: Number(obj.x) || 0,
    y: Number(obj.y) || 0,
    name,
    radius: 32,
    statText: statTxt,
    label: statTxt ? `${name} — ${statTxt}` : name
  };
}

function rebuildLooseItemCache() {
  const merged = [];
  const seenIds = new Set();
  
  // Add ground items first
  for (const gi of groundItems || []) {
    const norm = normalizeGroundLooseItem(gi);
    if (norm && !seenIds.has(norm.id)) {
      seenIds.add(norm.id);
      merged.push(norm);
    }
  }
  
  // Add map items (avoid duplicates)
  for (const obj of mapObjects || []) {
    if (obj && obj.kind === "item" && obj.meta?.entity) {
      const norm = normalizeMapLooseItem(obj);
      if (norm && !seenIds.has(norm.id)) {
        seenIds.add(norm.id);
        merged.push(norm);
      }
    }
  }
  window.looseItemCache = merged;
  return merged;
}

function getLooseItems() {
  if (!Array.isArray(window.looseItemCache) || window.looseItemCache.length === 0) {
    return rebuildLooseItemCache();
  }
  return window.looseItemCache;
}

function findLooseItemNear(wx, wy, radius = 24) {
  let closest = null;
  let best = radius;
  for (const item of getLooseItems()) {
    const r = item.radius || radius;
    const dist = Math.hypot(item.x - wx, item.y - wy);
    if (dist < r && dist < best) {
      closest = item;
      best = dist;
    }
  }
  return closest;
}

const COLLISION_BUILD_W = (typeof BUILD_W === "number") ? BUILD_W : 256;
const COLLISION_BUILD_H = (typeof BUILD_H === "number") ? BUILD_H : 256;
const COLLISION_PADDING = (typeof BUILD_COLLISION_PADDING === "number") ? BUILD_COLLISION_PADDING : 0;
const GROUND_ITEM_COLLISION_PAD = 8;

function screenToWorld(clientX, clientY) {
  return {
    x: camera.x + clientX - canvas.width / 2,
    y: camera.y + clientY - canvas.height / 2
  };
}

function pointWithinCanvas(clientX, clientY) {
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function findWorldCollision(wx, wy, padding = 0) {
  const pad = Number(padding) || 0;
  if (Array.isArray(mapObjects)) {
    for (const obj of mapObjects) {
      const meta = obj?.meta || {};
      if (!meta.collides) continue;
      const cw = Number(meta.cw ?? meta.w ?? 0);
      const ch = Number(meta.ch ?? meta.h ?? 0);
      if (!(cw > 0 && ch > 0)) continue;
      const cx = Number(obj.x || 0) + Number(meta.cx || 0);
      const cy = Number(obj.y || 0) + Number(meta.cy || 0);
      const left = cx - cw / 2 - pad;
      const right = cx + cw / 2 + pad;
      const top = cy - ch / 2 - pad;
      const bottom = cy + ch / 2 + pad;
      if (wx >= left && wx <= right && wy >= top && wy <= bottom) {
        return { source: "map", object: obj };
      }
    }
  }

  if (Array.isArray(buildings)) {
    for (const b of buildings) {
      const bx = Number(b?.x || 0);
      const by = Number(b?.y || 0);
      const left = bx - COLLISION_BUILD_W / 2 - COLLISION_PADDING - pad;
      const right = bx + COLLISION_BUILD_W / 2 + COLLISION_PADDING + pad;
      const top = by - COLLISION_BUILD_H / 2 - COLLISION_PADDING - pad;
      const bottom = by + COLLISION_BUILD_H / 2 + COLLISION_PADDING + pad;
      if (wx >= left && wx <= right && wy >= top && wy <= bottom) {
        return { source: "building", object: b };
      }
    }
  }

  return null;
}

function describeWorldCollision(hit) {
  if (!hit) return "Blocked by collision";
  if (hit.object?.meta?.title) return `Blocked by ${hit.object.meta.title}`;
  if (hit.object?.kind) return `Blocked by ${hit.object.kind}`;
  if (hit.source === "building") return "Blocked by building";
  return "Blocked by collision";
}

let dropBlockTitleTimer = null;
function notifyWorldDropBlocked(message) {
  console.warn(message);
  if (!canvas) return;
  canvas.title = message;
  if (dropBlockTitleTimer) clearTimeout(dropBlockTitleTimer);
  dropBlockTitleTimer = setTimeout(() => {
    if (canvas && canvas.title === message) {
      canvas.title = "";
    }
  }, 1500);
}

function tryMoveGroundItemOnWorld(gi, clientX, clientY) {
  if (!gi) return false;
  if (!pointWithinCanvas(clientX, clientY)) return false;
  const worldPos = screenToWorld(clientX, clientY);
  const blocked = findWorldCollision(worldPos.x, worldPos.y, GROUND_ITEM_COLLISION_PAD);
  if (blocked) {
    notifyWorldDropBlocked(describeWorldCollision(blocked));
    return false;
  }
  
  const isMapObject = gi.kind === "item" && gi.meta;
  if (isMapObject) {
    socket.emit("update_map_object", {
      id: gi.id,
      x: worldPos.x,
      y: worldPos.y
    });
  } else {
    socket.emit("move_ground_item", {
      groundItemId: gi.id,
      x: worldPos.x,
      y: worldPos.y
    });
  }
  
  gi.x = worldPos.x;
  gi.y = worldPos.y;
  if (typeof rebuildLooseItemCache === "function") rebuildLooseItemCache();
  return true;
}

window.rebuildLooseItemCache = rebuildLooseItemCache;
// Defer initial cache build until mapObjects is defined (loaded from index.html)
if (typeof mapObjects !== "undefined" && typeof groundItems !== "undefined") {
  rebuildLooseItemCache();
} else {
  // Will be called later when state arrives or manually triggered
  setTimeout(() => {
    if (typeof mapObjects !== "undefined" && typeof groundItems !== "undefined") {
      rebuildLooseItemCache();
    }
  }, 100);
}

// ===== Slot highlight helpers =====
let slotHighlightCache = [];

function invalidateSlotHighlightables() {
  slotHighlightCache = [];
}

function getSlotHighlightables() {
  slotHighlightCache = slotHighlightCache.filter((el) => el && document.body.contains(el));
  if (slotHighlightCache.length === 0) {
    slotHighlightCache = Array.from(document.querySelectorAll("li[data-slot-index]"));
  }
  return slotHighlightCache;
}

function clearSlotHighlights() {
  for (const li of getSlotHighlightables()) {
    li.style.outline = "";
    li.style.backgroundColor = "";
  }
}

window.invalidateSlotHighlightables = invalidateSlotHighlightables;

// Track selected entity in editor mode for movement
if (typeof window.selectedEditorEntity === "undefined") window.selectedEditorEntity = null;
var selectedEditorEntity = window.selectedEditorEntity;

// Small helper to mirror formation offsets from update.js
function getUnitTargetOffsetClient(idx, total) {
  const angle = (idx / Math.max(1, total)) * Math.PI * 2;
  const radius = Math.max(8, total * 10);
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

/* ================= CAMERA ================= */
const camSpeed = 12;
if (typeof window.keys === "undefined") window.keys = {};
var keys = window.keys;
document.addEventListener("keydown", (e) => {
  keys[e.key] = true;

  // Escape: exit item placement mode (Create Item inactive)
  if (!e.repeat && e.key === "Escape" && window.itemPlacementMode) {
    window.itemPlacementMode = false;
    const itemTilePicker = document.getElementById('itemTilePicker');
    if (itemTilePicker) itemTilePicker.style.display = 'none';
    const brushSelect = document.getElementById('brushSelect');
    if (brushSelect) brushSelect.disabled = false;
    e.preventDefault();
  }

  // Toggle collision on/off while in editor
  if (!e.repeat && editorMode && (e.key === "c" || e.key === "C")) {
    editorCollisionEnabled = !editorCollisionEnabled;
  }

  // Escape key: deselect entity
  if (!e.repeat && e.key === "Escape" && window.selectedEditorEntity) {
    window.selectedEditorEntity = null;
    // Re-enable brush dropdown
    const brushSelect = document.getElementById('brushSelect');
    if (brushSelect) brushSelect.disabled = false;
    e.preventDefault();
  }

  // Arrow keys in editor: move selected entity (default) or collision offset (with Shift)
  if (editorMode && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) {
    if (e.shiftKey) {
      // Shift+Arrow: adjust collision offset
      const step = 1;
      if (e.key === "ArrowLeft") editorCollisionOffsetX -= step;
      if (e.key === "ArrowRight") editorCollisionOffsetX += step;
      if (e.key === "ArrowUp") editorCollisionOffsetY -= step;
      if (e.key === "ArrowDown") editorCollisionOffsetY += step;
    } else if (window.selectedEditorEntity) {
      // Arrow: move selected entity
      const step = 5;
      const ent = window.selectedEditorEntity;
      if (e.key === "ArrowLeft") ent.x -= step;
      if (e.key === "ArrowRight") ent.x += step;
      if (e.key === "ArrowUp") ent.y -= step;
      if (e.key === "ArrowDown") ent.y += step;
      
      // Update server with new position
      socket.emit("update_map_object", {
        id: ent.id,
        x: ent.x,
        y: ent.y
      });
    }
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});

// Collision debug toggle button
const collisionBtn = document.getElementById("collisionBtn");
if (collisionBtn) {
  const updateCollisionLabel = () => {
    collisionBtn.textContent = DEBUG_COLLISIONS ? "Collision Debug: ON" : "Collision Debug: OFF";
  };
  updateCollisionLabel();
  collisionBtn.onclick = () => {
    DEBUG_COLLISIONS = !DEBUG_COLLISIONS;
    updateCollisionLabel();
  };
}

// Guard against double-loading: keep selection state on window and use var to tolerate reinjection
if (typeof window.selectStart === "undefined") window.selectStart = { x: 0, y: 0 };
if (typeof window.selecting === "undefined") window.selecting = false;
var selectStart = window.selectStart;
var selecting = window.selecting;
const MIN_DRAG_DIST_SQ = 25; // tiny threshold so clicks don't trigger box selection

canvas.addEventListener("mousemove", e=>{
  mouse.x = e.clientX;
  mouse.y = e.clientY;

  const wx = camera.x + mouse.x - canvas.width/2;
  const wy = camera.y + mouse.y - canvas.height/2;

  hoveredResource = null;
  hoveredPlayerSid = null;
  hoveredObject = null;
  hoveredUnit = null;
  canvas.title = "";

    // Ground or map item hover (priority 0)
  hoveredGroundItem = null;
  for (const loose of getLooseItems()) {
    const threshold = loose.radius || 20;
    if (Math.hypot(loose.x - wx, loose.y - wy) < threshold) {
      hoveredGroundItem = loose;
      canvas.title = loose.label || loose.name || "Item";
      canvas.style.cursor = "grab";
      break;
    }
  }
  // Don't return early if in item placement mode (allow brush preview to show)
  if (hoveredGroundItem && !draggingPickup && !window.itemPlacementMode) return;


  // Resource hover (priority 1)
  for(const r of resources){
    if(Math.hypot(r.x-wx, r.y-wy) < RESOURCE_RADIUS){
      hoveredResource = r;
      canvas.style.cursor = "pointer";
      return;
    }
  }

  // Enemy unit hover (priority 2) for attack cursor
  hoveredAttackEntity = null;
  for (const sid in players) {
    if (sid === mySid) continue;
    const p = players[sid];
    if (p?.units) {
      for (let i = p.units.length - 1; i >= 0; i--) {
        const u = p.units[i];
        if (!u || (u.hp ?? 0) <= 0) continue;
        if (Math.hypot(u.x - wx, u.y - wy) < 20) {
          hoveredAttackEntity = { x: u.x, y: u.y, owner: sid, meta: { entity: true, cw: 40, ch: 40 }, kind: 'unit', type: 'unit', id: u.id };
          canvas.style.cursor = 'crosshair';
          hoveredPlayerSid = sid;
          return;
        }
      }
    }
  }

  // Player hover (priority 3) - fallback to player dot
  for(const sid in players){
    if(sid === mySid) continue;
    const p = players[sid];
    if(Math.hypot(p.x-wx, p.y-wy) < 20){
      hoveredPlayerSid = sid;
      canvas.style.cursor = "crosshair";
      return;
    }
  }

  // Enemy entity hover (priority 4) - buildings/town centers/mines/blacksmiths/spiders
  for (let i = (mapObjects || []).length - 1; i >= 0; i--) {
    const o = mapObjects[i];
    if (!o || !o.meta || !o.meta.entity) continue;
    if (o.owner === mySid) continue;
    if (!(o.type === 'building' || o.kind === 'town_center' || o.kind === 'mine' || o.kind === 'blacksmith' || o.kind === 'spider')) continue;

    // Clickable radius reduced to 50 pixels to match visual representation
    if (Math.hypot(o.x - wx, o.y - wy) < 50) {
      hoveredAttackEntity = o;
      canvas.style.cursor = 'crosshair';
      return;
    }
  }

  // Units hover (priority 5)
  for (const u of myUnits) {
    if (Math.hypot(u.x - wx, u.y - wy) < 30) {
      hoveredUnit = u;
      canvas.style.cursor = 'pointer';
      canvas.title = `Unit ${u.id.slice(0, 6)}`;
      return;
    }
  }

  // Buildings (mine) hover (priority 6)
  for (const b of buildings) {
    if (b.owner === mySid && Math.hypot(b.x - wx, b.y - wy) < 60) {
      hoveredObject = { ...b, type: 'building', w: BUILD_W, h: BUILD_H };
      canvas.style.cursor = 'pointer';
      return;
    }
  }

  // Field hover (priority 6.5) - non-entity field tiles
  for (let i = (mapObjects || []).length - 1; i >= 0; i--) {
    const o = mapObjects[i];
    if (!o || !o.meta || o.meta.entity) continue;  // Only non-entities
    if (o.kind === 'field') {  // No collides check needed
      const w = o.meta?.w || 256;
      const h = o.meta?.h || 256;
      if (Math.hypot(o.x - wx, o.y - wy) < Math.max(w, h) / 2 + 20) {
        hoveredObject = { ...o, w, h };
        canvas.style.cursor = 'pointer';
        canvas.title = o.meta?.title || 'Field';
        return;
      }
    }
  }

  // Any tile/entity hover (priority 7)
  for (let i = (mapObjects || []).length - 1; i >= 0; i--) {
    const o = mapObjects[i];
    if (!o || !o.meta || !o.meta.entity) continue;
    
    let w = BUILD_W, h = BUILD_H;
    if (o.type === 'building') { w = BUILD_W; h = BUILD_H; }
    else if (o.meta) { const def = TILE_DEFS[o.kind] || { w: 256, h: 256 }; w = o.meta?.w ?? def.w; h = o.meta?.h ?? def.h; }
    
    // Clickable radius reduced to 50 pixels to match visual representation
    if (Math.hypot(o.x - wx, o.y - wy) < 50) {
      hoveredObject = { ...o, w, h };
      canvas.style.cursor = 'pointer';
      if (o.meta?.title) canvas.title = o.meta.title;
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
  // Use small radius (50px) to match visual representation and hover detection
  for (let i = mapObjects.length - 1; i >= 0; i--) {
    const o = mapObjects[i];
    if (!o.meta || !o.meta.entity) continue;

    if (o.type === "building") {
      // Buildings: 60 pixel radius
      if (Math.hypot(o.x - wx, o.y - wy) < 60) return o;
    } else if (o.type === "tile") {
      // Entities: 50 pixel radius
      if (Math.hypot(o.x - wx, o.y - wy) < 50) return o;
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
    // Check trees
    for (const t of trees || []) {
      const d = Math.hypot(t.x - wx, t.y - wy);
      if (d < best) { best = d; nearest = t; nearestType = 'tree'; }
    }
    if (nearest) {
      if (nearestType === 'map') socket.emit("delete_map_object", { id: nearest.id });
      else if (nearestType === 'ground') socket.emit("delete_ground_item", { id: nearest.id });
      else if (nearestType === 'tree') socket.emit("delete_tree", { x: nearest.x, y: nearest.y });
      e.preventDefault();
      return;
    }
  }

  // ✅ Check for any loose item drag (before entity inspect or editor placement)
  if (e.button === 0 && !e.shiftKey) {
    const hit = findLooseItemNear(wx, wy, 26);
    if (hit) {
      // Allow dragging ground items anywhere; allow map items only outside editor mode
      if (hit.source === "map" && editorMode) {
        return;
      }

      const picker = getFirstSelectedUnit();
      const resolved = hit.source === "ground"
        ? (groundItems || []).find((gi) => gi.id === hit.groundId)
        : (mapObjects || []).find((obj) => obj.id === hit.mapObjectId);
      
      draggingPickup = { itemName: hit.name };
      if (hit.source === "ground") draggingPickup.groundItemId = hit.groundId;
      if (hit.source === "map") draggingPickup.mapObjectItemId = hit.mapObjectId;
      // Only set picker if we have a selected unit AND it can actually pickup this item
      if (picker && resolved && unitCanPickup(picker, resolved)) {
        draggingPickup.unitId = picker.id;
      }

      dragMouse.x = e.clientX;
      dragMouse.y = e.clientY;

      createDragGhost(buildDragGhostOptions(resolved || hit));

      const dragMoveHandler = (ev) => {
        dragMouse.x = ev.clientX;
        dragMouse.y = ev.clientY;
        updateDragGhost(ev.clientX, ev.clientY);

        if (draggingPickup && (draggingPickup.groundItemId || draggingPickup.mapObjectItemId)) {
          const slotEl = findSlotElementAtScreen(ev.clientX, ev.clientY);
          clearSlotHighlights();
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

  // ✅ Ctrl+click in editor mode to select entity for movement
  if (editorMode && e.button === 0 && e.ctrlKey) {
    const hitEntity = hitTestMapObject(wx, wy);
    if (hitEntity) {
      window.selectedEditorEntity = hitEntity;
      // Disable brush dropdown when entity selected
      const brushSelect = document.getElementById('brushSelect');
      if (brushSelect) brushSelect.disabled = true;
      e.preventDefault();
      return;
    } else {
      window.selectedEditorEntity = null;
      // Re-enable brush dropdown
      const brushSelect = document.getElementById('brushSelect');
      if (brushSelect) brushSelect.disabled = false;
    }
  }

  // ✅ NPC/Spider waypoint editing when NPC/Spider selected (Alt+click in editor mode)
  if (editorMode && e.button === 0 && e.altKey && window.selectedEditorEntity && 
      (window.selectedEditorEntity.kind === 'npc' || window.selectedEditorEntity.kind === 'spider')) {
    // Refresh NPC/Spider reference from mapObjects (in case it was updated)
    const npcId = window.selectedEditorEntity.id;
    const npc = mapObjects.find(o => o.id === npcId);
    if (!npc) return;
    
    if (!npc.meta) npc.meta = {};
    if (!npc.meta.waypoints) npc.meta.waypoints = [];
    
    // Shift+Alt+Click: Remove waypoint
    if (e.shiftKey) {
      // Find and remove waypoint within 40px
      for (let i = 0; i < npc.meta.waypoints.length; i++) {
        const wp = npc.meta.waypoints[i];
        const dist = Math.hypot(wx - wp.x, wy - wp.y);
        if (dist < 40) {
          // Allow down to a single waypoint (idle NPC), block removing the last one
          if (npc.meta.waypoints.length > 1) {
            npc.meta.waypoints.splice(i, 1);
            
            // Update server
            socket.emit("update_map_object", {
              id: npc.id,
              meta: npc.meta
            });
            
            window.selectedEditorEntity = npc;
          }
          break;
        }
      }
    } else {
      // Alt+Click (no shift): Move or add waypoint
      // Check if clicking near an existing waypoint (within 40px) to move it
      let movedWaypoint = false;
      for (let i = 0; i < npc.meta.waypoints.length; i++) {
        const wp = npc.meta.waypoints[i];
        const dist = Math.hypot(wx - wp.x, wy - wp.y);
        if (dist < 40) {
          wp.x = wx;
          wp.y = wy;
          movedWaypoint = true;
          break;
        }
      }
      
      // If not moving, add new waypoint (max 10)
      if (!movedWaypoint && npc.meta.waypoints.length < 10) {
        npc.meta.waypoints.push({ x: wx, y: wy });
      }
      
      // Update server and refresh selectedEditorEntity
      socket.emit("update_map_object", {
        id: npc.id,
        meta: npc.meta
      });
      
      // Update the selected entity reference
      window.selectedEditorEntity = npc;
    }
    
    e.preventDefault();
    return;
  }

  // ✅ Click entity to inspect
  if (e.button === 0 && !e.ctrlKey && !e.altKey) {
    const hitEntity = hitTestMapObject(wx, wy);
    if (hitEntity) {
      ensureEntityMeta(hitEntity);
      if (!editorMode && hitEntity.meta && hitEntity.meta.givesQuest && typeof window.showQuestDialog === "function") {
        window.showQuestDialog(hitEntity);
        e.preventDefault();
        return;
      }
      openEntityInspector(hitEntity);
      e.preventDefault();
      return;
    }
  }

  // ✅ Editor placement (non-shift click, no modifiers, no entity selected)
  if (editorMode && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.altKey) {

// Don't place if entity is selected
if (window.selectedEditorEntity) {
  return;
}

// Check if we're in item placement mode
if (window.itemPlacementMode) {
  // Place item with selected tile
  const itemTile = window.selectedItemTile || { sheet: 0, tx: 0, ty: 0 };
  const meta = {
    entity: true,
    title: 'Item',
    bio: 'An item that can be picked up',
    actions: [],
    collides: false,
    w: 64,
    h: 64,
    z: getCurrentZOrder(),
    itemType: 'weapon',
    itemTile: itemTile,
    itemStats: {
      name: 'Item',
      attack: 0,
      defense: 0,
      bonus: 0
    }
  };
  socket.emit("place_map_object", { type: "tile", kind: "item", x: wx, y: wy, meta });
  window.itemPlacementMode = false; // Reset after placing
  e.preventDefault();
  return;
}

const [type, kind] = brushSelect.value.split(":");

// Special handling for billboard - spawn near center
let placeX = wx;
let placeY = wy;
if (kind === 'billboard') {
  placeX = camera.x;
  placeY = camera.y;
}

let meta = (type === "tile") ? {
  collides: editorCollisionEnabled,
  cw: editorCollisionW,
  ch: editorCollisionH,
  cx: editorCollisionOffsetX,
  cy: editorCollisionOffsetY,
  w: editorTileW,
  h: editorTileH,
  z: getCurrentZOrder()
} : {};

// Add billboard text and force entity mode for billboards
if (kind === 'billboard') {
  meta.entity = true;
  meta.title = 'Welcome!';
  meta.bio = 'Edit this billboard by clicking it and changing the title and biography in the Entity Inspector.';
  meta.actions = [];
  meta.collides = true;
  meta.cw = 300;
  meta.ch = 200;
  meta.cx = meta.cx || 0;
  meta.cy = meta.cy || 0;
  meta.w = 300;
  meta.h = 200;
} else if (kind === 'npc') {
  // NPC setup with default 5 waypoints in a circle
  const radius = 200;
  const waypoints = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    waypoints.push({
      x: placeX + Math.cos(angle) * radius,
      y: placeY + Math.sin(angle) * radius
    });
  }
  // Start NPC at first waypoint
  placeX = waypoints[0].x;
  placeY = waypoints[0].y;
  
  meta.entity = true;
  meta.title = 'NPC';
  meta.bio = 'An NPC that walks between waypoints';
  meta.actions = [];
  meta.collides = false;  // NPCs don't collide
  meta.waypoints = waypoints;
  meta.currentWaypointIndex = 0;
  meta.dir = '000';
  meta.anim = 'walk';
  meta.w = 64;
  meta.h = 64;
} else if (kind === 'spider') {
  // Spider setup with default 5 waypoints in a circle
  const radius = 200;
  const waypoints = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    waypoints.push({
      x: placeX + Math.cos(angle) * radius,
      y: placeY + Math.sin(angle) * radius
    });
  }
  // Start spider at first waypoint
  placeX = waypoints[0].x;
  placeY = waypoints[0].y;
  
  meta.entity = true;
  meta.title = 'Spider';
  meta.bio = 'A hostile spider that patrols waypoints and attacks nearby players';
  meta.actions = [];
  meta.collides = false;  // Spiders don't have collision boxes
  meta.waypoints = waypoints;
  meta.currentWaypointIndex = 0;
  meta.dir = '000';
  meta.anim = 'walk';
  meta.w = 100;
  meta.h = 100;
  meta.hp = 50;
  meta.maxHp = 50;
} else if (entityMode) {
  meta = {
    ...meta,
    entity: true,
    title: (type === "tile") ? prettyName(kind) : "Building",
    bio: "",
    actions: [],
    z: getCurrentZOrder()
  };
}

// If placing a spider, include HP at top level for server
const extraData = {};
if (kind === 'spider') {
  extraData.hp = meta.hp;
  extraData.maxHp = meta.maxHp;
  extraData.owner = null;  // hostile entity
}
socket.emit("place_map_object", { type, kind, x: placeX, y: placeY, meta, ...extraData });
resetCollisionOffset();

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
      title: "Town Center",
      bio: "",
      actions: [],
      collides: true,
      cw: BUILD_W,
      ch: BUILD_H,
      cx: editorCollisionOffsetX,
      cy: editorCollisionOffsetY,
      w: BUILD_W,
      h: BUILD_H,
      z: getCurrentZOrder()
    };
    socket.emit("place_map_object", { type: "tile", kind: "town_center", x: wx, y: wy, meta });
    resetCollisionOffset();
    return;
  }

    // ===== Mine placement =====
    if (mineMode) {
      const mineCost = 3;
      try { console.log('MINE: attempting placement'); } catch(e){}
      if (((window.resourceCounts && window.resourceCounts.blue) || 0) < mineCost) {
        try { mineMode = false; mineBtn.disabled = false; } catch(e){}
        alert(`Not enough blue resources to build Mine (requires ${mineCost})`);
        return;
      }
      mineMode = false;
      try { mineBtn.disabled = false; } catch(e){}
      const meta = {
        entity: true,
        title: "Mine",
        bio: "",
        actions: [],
        collides: true,
        cw: MINE_W,
        ch: MINE_H,
        cx: editorCollisionOffsetX,
        cy: editorCollisionOffsetY,
        w: MINE_W,
        h: MINE_H,
        z: getCurrentZOrder()
      };
      socket.emit("place_map_object", { type: "tile", kind: "mine", x: wx, y: wy, meta });
      // Auto-place the adjacent field tile to the right of the mine (closer)
      try {
        const def = TILE_DEFS["field"] || { w: 256, h: 256 };
        const fx = wx + 140;  // Closer to the mine (overlapping slightly for better UX)
        const fy = wy;
        const fmeta = {
          entity: false,
          title: "Field",
          bio: "",
          actions: [],
          collides: false,
          cw: def.w,
          ch: def.h,
          cx: 0,
          cy: 0,
          w: def.w,
          h: def.h,
          z: getCurrentZOrder() - 1  // Render below the mine
        };
        socket.emit("place_map_object", { type: "tile", kind: "field", x: fx, y: fy, meta: fmeta });
      } catch (e) { console.warn("Failed to auto-place field tile:", e); }
      resetCollisionOffset();
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
        cx: editorCollisionOffsetX,
        cy: editorCollisionOffsetY,
        w: BLACKSMITH_W,
        h: BLACKSMITH_H,
        z: getCurrentZOrder()
      };
      socket.emit("place_map_object", { type: "tile", kind: "blacksmith", x: wx, y: wy, meta });
      resetCollisionOffset();
      return;
    }

    // ===== Check for unit click =====
    let clickedUnit = null;
    let bestDist = Infinity;
    // Screen-space pick first (larger radius)
    for (const u of myUnits) {
      const ux = canvas.width / 2 + u.x - camera.x;
      const uy = canvas.height / 2 + u.y - camera.y;
      const d = Math.hypot(mouse.x - ux, mouse.y - uy);
      if (d < 36 && d < bestDist) {
        bestDist = d;
        clickedUnit = u;
      }
    }
    // Fallback to world-space pick if nothing hit (camera misalign edge cases)
    if (!clickedUnit) {
      const wx = camera.x + mouse.x - canvas.width/2;
      const wy = camera.y + mouse.y - canvas.height/2;
      for (const u of myUnits) {
        const d = Math.hypot(u.x - wx, u.y - wy);
        if (d < 32 && d < bestDist) {
          bestDist = d;
          clickedUnit = u;
        }
      }
    }

    if (clickedUnit) {
      myUnits.forEach(u => u.selected = false);
      clickedUnit.selected = true;

        updateSelectedUnits(); // <-- sync panel
      selecting = window.selecting = false;
      return;
    }

    // ===== Clicked empty space =====
    buildings.forEach(b => b.selected = false);
    myUnits.forEach(u => u.selected = false);
    updateSelectedUnits(); // <-- sync panel
    // Start selection box only if dragging begins from empty space
    selectStart.x = mouse.x;
    selectStart.y = mouse.y;
    selecting = window.selecting = true;
  }
});

function onGlobalDragMove(e) {
  dragMouse.x = e.clientX;
  dragMouse.y = e.clientY;

  // Update drag ghost position
  updateDragGhost(e.clientX, e.clientY);

  // Highlight slots when hovering during ground item drag
  if (draggingPickup && (draggingPickup.groundItemId || draggingPickup.mapObjectItemId)) {
    const slotEl = findSlotElementAtScreen(e.clientX, e.clientY);
    clearSlotHighlights();
    // Highlight current slot
    if (slotEl) {
      slotEl.style.outline = "3px solid #0ff";
      slotEl.style.backgroundColor = "rgba(0,255,255,0.2)";
    }
  }

  e.preventDefault();
}

// Drag ghost visual (renders above DOM)
const DRAG_TILE_PREVIEW_SIZE = 32;
let dragPreviewCanvas = null;
let dragPreviewCtx = null;

function getDragPreviewCanvas() {
  if (!dragPreviewCanvas) {
    dragPreviewCanvas = document.createElement("canvas");
    dragPreviewCanvas.width = DRAG_TILE_PREVIEW_SIZE;
    dragPreviewCanvas.height = DRAG_TILE_PREVIEW_SIZE;
    dragPreviewCtx = dragPreviewCanvas.getContext("2d");
    dragPreviewCtx.imageSmoothingEnabled = false;
  }
  return dragPreviewCanvas;
}

function makeTilePreviewDataUrl(tile) {
  if (!tile || typeof tile.tx !== "number" || typeof tile.ty !== "number") return null;
  if (!window.itemTileSheet || !window.itemTileSheet.complete) return null;
  const canvas = getDragPreviewCanvas();
  const ctx = dragPreviewCtx || canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, DRAG_TILE_PREVIEW_SIZE, DRAG_TILE_PREVIEW_SIZE);
  const tileSize = 32;
  ctx.drawImage(
    window.itemTileSheet,
    tile.tx * tileSize,
    tile.ty * tileSize,
    tileSize,
    tileSize,
    0,
    0,
    DRAG_TILE_PREVIEW_SIZE,
    DRAG_TILE_PREVIEW_SIZE
  );
  try {
    return canvas.toDataURL("image/png");
  } catch (ex) {
    console.warn("Failed to build tile preview", ex);
    return null;
  }
}

function buildDragGhostOptions(pickupTarget) {
  const fallback = pickupTarget?.meta?.itemStats?.name || pickupTarget?.name || "item";
  let previewUrl = null;
  if (pickupTarget?.meta?.itemTile) {
    previewUrl = makeTilePreviewDataUrl(pickupTarget.meta.itemTile);
  }
  if (!previewUrl && pickupTarget?.name && typeof itemIcons !== "undefined") {
    const icon = itemIcons[pickupTarget.name];
    if (icon && icon.complete && icon.naturalWidth > 0) {
      previewUrl = icon.src;
    }
  }
  return { label: fallback, previewUrl };
}

function createDragGhost(options) {
  removeDragGhost();
  const opts = (typeof options === "string") ? { label: options } : (options || {});
  const label = (opts.label || "item").toString();
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
  if (opts.previewUrl) {
    g.style.backgroundImage = `url(${opts.previewUrl})`;
    g.style.backgroundSize = 'cover';
    g.style.backgroundPosition = 'center';
    g.style.border = '2px solid #6cf';
    g.textContent = '';
  } else {
    g.textContent = label.substring(0, 3).toUpperCase();
  }
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
    try { clearSlotHighlights(); } catch (ex) {}
    try { setTimeout(()=>{ if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); }, 0); } catch (ex) {}
    dragEndHandled = false;
  }

  // expose a global cleanup in case other modules need to force-remove the drag state
  try { window.cleanupDragState = function(){ try{ draggingPickup = null; }catch(e){} try{ removeDragGhost(); }catch(e){} try{ clearSlotHighlights(); }catch(e){} }; } catch (ex) {}

  if (!draggingPickup) { 
    finalizeDragCleanup(); 
    return; 
  }

  // Find the item being dragged (either ground item or map object item)
  const gi = draggingPickup.groundItemId 
    ? groundItems.find(x => x.id === draggingPickup.groundItemId)
    : mapObjects.find(x => x.id === draggingPickup.mapObjectItemId);
  const picker = myUnits.find(u => u.id === draggingPickup.unitId);
  const dragData = draggingPickup; // Save reference before cleanup
  const isMapObjectItem = !!draggingPickup.mapObjectItemId;
  draggingPickup = null;

  if (!gi) { finalizeDragCleanup(); return; }

  // NOTE: range check for pickup is only required when dropping into a unit slot.

  // must drop on a slot
  let slotEl = findSlotElementAtScreen(e.clientX, e.clientY);
  console.log("Drop detected - slotEl:", slotEl, "at position:", e.clientX, e.clientY);
  if (!slotEl) {
    // If we released over the canvas, allow relocating ground or map items in-world.
    if ((dragData?.groundItemId || dragData?.mapObjectItemId) && gi) {
      const dropped = tryMoveGroundItemOnWorld(gi, e.clientX, e.clientY);
      if (dropped) {
        finalizeDragCleanup();
        return;
      }
    }

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
    // Ground/MapObject -> Entity drop
    if (isMapObjectItem) {
      // For map object items, we need to send the item data to the server
      socket.emit("map_item_give_to_entity", {
        entityId,
        entitySlotIndex: slotIndex,
        mapObjectItemId: gi.id,
        itemData: {
          name: gi.meta?.itemStats?.name || 'Item',
          attack: gi.meta?.itemStats?.attack || 0,
          defense: gi.meta?.itemStats?.defense || 0,
          bonus: gi.meta?.itemStats?.bonus || 0
        }
      });
      // Optimistic local update: remove map object item and add to entity slot
      try {
        const itemIndex = mapObjects.findIndex(o => o.id === gi.id);
        if (itemIndex !== -1) {
          mapObjects.splice(itemIndex, 1);
          if (typeof rebuildLooseItemCache === "function") rebuildLooseItemCache();
        }
        const entLocal = mapObjects.find(m => m.id === entityId);
        if (entLocal) {
          entLocal.itemSlots = entLocal.itemSlots || [];
          entLocal.itemSlots[slotIndex] = { 
            id: gi.id, 
            name: gi.meta?.itemStats?.name || 'Item'
          };
          if (selectedEntityId === entityId) openEntityInspector(entLocal);
        }
      } catch (ex) { console.error("optimistic map item->entity update failed", ex); }
    } else {
      // Original ground item handling
      socket.emit("ground_give_to_entity", {
        entityId,
        entitySlotIndex: slotIndex,
        groundItemId: gi.id
      });
      // Optimistic local update: remove ground item and add to entity slot
      try {
        const giIndexLocal = groundItems.findIndex(g => g.id === gi.id);
        if (giIndexLocal !== -1) groundItems.splice(giIndexLocal, 1);
        if (typeof rebuildLooseItemCache === "function") rebuildLooseItemCache();
        const entLocal = mapObjects.find(m => m.id === entityId);
        if (entLocal) {
          entLocal.itemSlots = entLocal.itemSlots || [];
          entLocal.itemSlots[slotIndex] = { id: gi.id, name: gi.name };
          if (selectedEntityId === entityId) openEntityInspector(entLocal);
        }
      } catch (ex) { console.error("optimistic ground->entity update failed", ex); }
    }
    finalizeDragCleanup();
    return;
  }

  // Check if this is a unit slot
  const unitId = slotEl.dataset.unitId;
  if (!unitId) { finalizeDragCleanup(); return; }
  
  const targetUnit = myUnits.find(u => u.id === unitId);
  if (!targetUnit) { finalizeDragCleanup(); return; }

  if (!targetUnit.itemSlots) targetUnit.itemSlots = [null, null, null, null, null];
  if (targetUnit.itemSlots[slotIndex]) {
    console.log("Slot already occupied", slotIndex, targetUnit.itemSlots[slotIndex]);
    finalizeDragCleanup();
    return;
  }
  // Ensure we have a unit picker in range for unit-slot pickups
  if (!picker || !unitCanPickup(picker, gi)) {
    console.log("Unit cannot pickup - picker:", picker, "canPickup:", picker ? unitCanPickup(picker, gi) : false);
    finalizeDragCleanup();
    return;
  }

  if (isMapObjectItem) {
    // For map object items, send the item data
    socket.emit("pickup_map_item", {
      unitId: targetUnit.id,
      slotIndex,
      mapObjectItemId: gi.id,
      itemData: {
        name: gi.meta?.itemStats?.name || 'Item',
        attack: gi.meta?.itemStats?.attack || 0,
        defense: gi.meta?.itemStats?.defense || 0,
        bonus: gi.meta?.itemStats?.bonus || 0
      }
    });
    // Optimistic local update: remove map object item and add to unit slot
    try {
      const itemIndex = mapObjects.findIndex(o => o.id === gi.id);
      if (itemIndex !== -1) {
        console.log("Removing map object item from index:", itemIndex, gi);
        mapObjects.splice(itemIndex, 1);
        if (typeof rebuildLooseItemCache === "function") rebuildLooseItemCache();
      }
      targetUnit.itemSlots = targetUnit.itemSlots || [];
      targetUnit.itemSlots[slotIndex] = { 
        id: ("local-" + (gi.id || Math.random())), 
        name: gi.meta?.itemStats?.name || "item",
        itemTile: gi.meta?.itemTile, // Preserve tile info
        attack: gi.meta?.itemStats?.attack || 0,
        defense: gi.meta?.itemStats?.defense || 0,
        bonus: gi.meta?.itemStats?.bonus || 0
      };
      if (currentItemsUnitId === targetUnit.id) renderUnitItems(targetUnit);
    } catch (ex) { console.error("optimistic pickup_map_item failed", ex); }
  } else {
    // Original ground item handling
    socket.emit("pickup_item", {
      unitId: targetUnit.id,
      slotIndex,
      groundItemId: gi.id
    });
    // Optimistic local update: remove ground item and add to unit slot immediately
    try {
      const giIndexLocal = groundItems.findIndex(g => g.id === gi.id);
      if (giIndexLocal !== -1) groundItems.splice(giIndexLocal, 1);
      if (typeof rebuildLooseItemCache === "function") rebuildLooseItemCache();
      targetUnit.itemSlots = targetUnit.itemSlots || [];
      const stats = (gi.itemStats && typeof gi.itemStats === "object") ? gi.itemStats : gi;
      targetUnit.itemSlots[slotIndex] = {
        id: ("local-" + (gi.id || Math.random())),
        name: (stats && stats.name) || gi.name || "item",
        attack: Number(stats.attack) || 0,
        defense: Number(stats.defense) || 0,
        bonus: Number(stats.bonus) || 0
      };
      if (currentItemsUnitId === targetUnit.id) renderUnitItems(targetUnit);
    } catch (ex) { console.error("optimistic pickup_item failed", ex); }
  }
  finalizeDragCleanup();
}

// OLD CANVAS MOUSEUP HANDLER REMOVED
// Ground item drag/drop now handled by onGlobalDragEnd which supports both unit slots AND entity slots

canvas.addEventListener("mouseup", e=>{
  if(e.button===0){
    if (selecting) {
      const dx = mouse.x - selectStart.x;
      const dy = mouse.y - selectStart.y;
      if ((dx * dx + dy * dy) >= MIN_DRAG_DIST_SQ) {
        const x1 = Math.min(selectStart.x, mouse.x);
        const y1 = Math.min(selectStart.y, mouse.y);
        const x2 = Math.max(selectStart.x, mouse.x);
        const y2 = Math.max(selectStart.y, mouse.y);
        for (const u of myUnits) {
          const sx = canvas.width / 2 + u.x - camera.x;
          const sy = canvas.height / 2 + u.y - camera.y;
          u.selected = (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2);
        }
        updateSelectedUnits(); // <-- sync panel
      }
    }
    selecting = window.selecting = false;
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

        // If no selection yet, allow right-click to select a friendly unit under cursor
        const hadSelection = myUnits.some(u => u.selected);
        if (!hadSelection) {
          const clickedSelfUnit = myUnits.find(u => Math.hypot(u.x - wx, u.y - wy) < 20);
          if (clickedSelfUnit) {
            myUnits.forEach(u => u.selected = false);
            clickedSelfUnit.selected = true;
            updateSelectedUnits();
            return;
          }
        }

        const selectedUnits = myUnits.filter(u => u.selected);
        const moveMarkers = [];

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

        // Helper: check if position is inside a building and adjust to nearest edge
        function adjustPositionOutsideBuildings(wx, wy) {
          for (const b of buildings) {
            const left = b.x - BUILD_W / 2;
            const right = b.x + BUILD_W / 2;
            const top = b.y - BUILD_H / 2;
            const bottom = b.y + BUILD_H / 2;
            
            // Check if point is inside building
            if (wx >= left && wx <= right && wy >= top && wy <= bottom) {
              // Find nearest edge
              const distLeft = wx - left;
              const distRight = right - wx;
              const distTop = wy - top;
              const distBottom = bottom - wy;
              
              const minDist = Math.min(distLeft, distRight, distTop, distBottom);
              
              if (minDist === distLeft) return { x: left - 5, y: wy };
              if (minDist === distRight) return { x: right + 5, y: wy };
              if (minDist === distTop) return { x: wx, y: top - 5 };
              if (minDist === distBottom) return { x: wx, y: bottom + 5 };
            }
          }
          return { x: wx, y: wy };
        }

        let clickedEntity = findEntityAt(wx, wy);
        // If hit-test fails but we have an attack-hovered entity, use it as the clicked entity.
        if (!clickedEntity && typeof hoveredAttackEntity !== 'undefined' && hoveredAttackEntity) {
          clickedEntity = hoveredAttackEntity;
        }

        // Check if right-clicking on a field tile for mining animation
        let clickedField = null;
        console.log(`[RIGHT_CLICK] Checking for field at (${wx.toFixed(0)}, ${wy.toFixed(0)}). Total mapObjects: ${mapObjects?.length || 0}`);
        const fields = (mapObjects || []).filter(o => o.kind === 'field');
        console.log(`[RIGHT_CLICK] Fields in mapObjects:`, fields.map(o => ({ 
          id: o.id?.substring(0, 8), 
          x: o.x, 
          y: o.y, 
          owner: o.owner,
          entity: o.meta?.entity 
        })));
        
        if (!clickedEntity && !clickedResource) {
          for (const o of (mapObjects || [])) {
            if (o.kind === 'field' && !o.meta?.entity) {
              // Only allow mining on fields you own
              if (o.owner && o.owner !== mySid) {
                console.log(`[RIGHT_CLICK] Field at (${o.x}, ${o.y}) owned by ${o.owner}, skipping`);
                continue;
              }
              
              const w = o.meta?.w || 256;
              const h = o.meta?.h || 256;
              const dist = Math.hypot(o.x - wx, o.y - wy);
              const radius = Math.max(w, h) / 2 + 20;
              console.log(`[RIGHT_CLICK] Testing field at (${o.x}, ${o.y}): dist=${dist.toFixed(0)}, radius=${radius.toFixed(0)}, match=${dist < radius}`);
              if (dist < radius) {
                console.log(`[RIGHT_CLICK] ✓ FOUND field owned by ${o.owner}!`);
                clickedField = o;
                break;
              }
            }
          }
          if (!clickedField) {
            console.log(`[RIGHT_CLICK] ✗ No field found in range`);
          }
        }

        // Assign a stable formation index and total so units keep their relative positions
        selectedUnits.forEach((u, idx) => {
          u._formationIndex = idx;
          u._formationTotal = selectedUnits.length;

          u.targetEnemy = null;
          u.harvesting = null;
          u.targetField = null;  // Clear any existing field target
          u.targetResource = null;  // Clear any existing resource target

          // If right-clicking on a field, move to the field and play attack/mining animation
          if (clickedField) {
            console.log(`[RIGHT_CLICK_FIELD] Moving unit to field at (${clickedField.x}, ${clickedField.y})`);
            u.targetField = clickedField;  // Special field target
            u.anim = 'attack';  // Play attack animation (mining effect)
            u.manualMove = false;
          }
          // If clicking an enemy entity, set unit to attack that entity instead of moving to its center
          // Allow attacking entities with no owner (hostile entities like spiders)
          else if (clickedEntity && (!clickedEntity.owner || clickedEntity.owner !== mySid)) {
            // spread attackers around the entity so they do not stack
            const cw = (clickedEntity.meta && clickedEntity.meta.cw) ? clickedEntity.meta.cw : (clickedEntity.meta && clickedEntity.meta.w ? clickedEntity.meta.w : BUILD_W);
            const ch = (clickedEntity.meta && clickedEntity.meta.ch) ? clickedEntity.meta.ch : (clickedEntity.meta && clickedEntity.meta.h ? clickedEntity.meta.h : BUILD_H);
            const entRadius = Math.max(cw, ch) / 2;

            // place each unit on a ring around the target based on formation index
            const angle = (idx / Math.max(1, selectedUnits.length)) * Math.PI * 2;
            const ringRadius = entRadius + UNIT_ATTACK_RANGE - 6; // small buffer so they sit just inside range
            const attackX = clickedEntity.x + Math.cos(angle) * ringRadius;
            const attackY = clickedEntity.y + Math.sin(angle) * ringRadius;

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
            
            // Adjust position if inside a building
            const adjusted = adjustPositionOutsideBuildings(wx, wy);
            u.tx = adjusted.x;
            u.ty = adjusted.y;
            u.manualMove = true;

            // record a per-unit marker with formation offset for visual feedback
            const offset = getUnitTargetOffsetClient(idx, selectedUnits.length);
            moveMarkers.push({ x: adjusted.x + offset.dx, y: adjusted.y + offset.dy, ts: performance.now() });
          }
        });

        try {
          window.moveMarkers = moveMarkers;
        } catch (e) {}

        
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

  // Dropping equipment item from unit onto world => SERVER creates ground item
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

  // Dropping item from entity slot onto world => relocate or drop to ground
  if (payload.type === "entity_item") {
    console.log("canvas drop entity_item -> ground", payload, { x: wx, y: wy });
    const blocked = findWorldCollision(wx, wy, GROUND_ITEM_COLLISION_PAD);
    if (blocked) {
      notifyWorldDropBlocked(describeWorldCollision(blocked));
      return;
    }
    socket.emit("entity_drop_item", {
      entityId: payload.entityId,
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
  const zOrderInput = document.getElementById("entityZOrderInput");
  const addBtn = document.getElementById("entityAddActionBtn");
  const saveBtn = document.getElementById("entitySaveBtn");
  const deleteBtn = document.getElementById("entityDeleteBtn");

  titleInput.disabled = !canEdit;
  bioInput.disabled = !canEdit;
  if (zOrderInput) zOrderInput.disabled = !canEdit;
  addBtn.disabled = !canEdit;
  saveBtn.disabled = !canEdit;
  deleteBtn.disabled = !canEdit;

  // Optional visual cue
  titleInput.style.opacity = canEdit ? "1" : "0.7";
  bioInput.style.opacity   = canEdit ? "1" : "0.7";
  if (zOrderInput) zOrderInput.style.opacity = canEdit ? "1" : "0.7";
}

function ensureEntityMeta(o) {
  if (!o.meta) o.meta = {};
  if (!o.meta.entity) o.meta.entity = true;
  if (typeof o.meta.title !== "string") o.meta.title = "";
  if (typeof o.meta.bio !== "string") o.meta.bio = "";
  if (!Array.isArray(o.meta.actions)) o.meta.actions = [];
  if (o.kind === "item") {
    const stats = o.meta.itemStats && typeof o.meta.itemStats === "object" ? o.meta.itemStats : {};
    o.meta.itemStats = stats;
    if (typeof o.meta.itemType !== "string" || !o.meta.itemType.trim()) {
      o.meta.itemType = "weapon";
    }
    const fallbackTitle = (typeof o.meta.title === "string" && o.meta.title.trim()) ? o.meta.title : getDefaultEntityTitle(o);
    if (typeof stats.name !== "string" || !stats.name.trim()) {
      stats.name = fallbackTitle || "Item";
    }
    // Keep title and name in sync for items
    o.meta.title = stats.name;
    const atk = Number(stats.attack);
    const def = Number(stats.defense);
    const bonus = Number(stats.bonus);
    stats.attack = Number.isFinite(atk) ? atk : 0;
    stats.defense = Number.isFinite(def) ? def : 0;
    stats.bonus = Number.isFinite(bonus) ? bonus : 0;
  }
}

function getDefaultEntityTitle(o) {
  if (o.type === "building") {
    if (o.kind === "town_center") return "Town Center";
    return "Building";
  }
  if (o.type === "tile") return o.kind ? prettyName(o.kind) : "Tile";
  return "Entity";
}

function openEntityInspector(o) {
  ensureEntityMeta(o);
  selectedEntityId = o.id;

  const entityIdLine = document.getElementById("entityIdLine");
  const entityTitleInput = document.getElementById("entityTitleInput");
  const entityBioInput = document.getElementById("entityBioInput");
  const entityZOrderInput = document.getElementById("entityZOrderInput");
  const entityPanelEl = document.getElementById("entityPanel");

  if (entityIdLine) {
    entityIdLine.textContent =
      `id: ${o.id} | type: ${o.type}${o.kind ? " | kind: " + o.kind : ""}`;
  }

  if (entityTitleInput) entityTitleInput.value = o.meta.title || getDefaultEntityTitle(o);
  if (entityBioInput) entityBioInput.value = o.meta.bio || "";
  
  // Get z from meta.z or fall back to z property
  const zValue = (o.meta && typeof o.meta.z === "number") ? o.meta.z : (typeof o.z === "number" ? o.z : 0);
  if (entityZOrderInput) entityZOrderInput.value = zValue;

  renderEntityActions(o);

  // ✅ Only allow editing TILE title/bio when editor mode is ON
  // Exception: billboards can always be edited
  const isTile = (o.type === "tile");
  const isBillboard = (o.kind === 'billboard');
  const canEdit = isBillboard || !(isTile && !editorMode);
  setEntityInspectorEditable(canEdit);

  // Optional: make it obvious why it's locked
  if (!canEdit && entityIdLine) {
    entityIdLine.textContent += "  |  (read-only: enable Editor to edit tile text)";
  }

  // Render Abilities (spawn unit button for town centers, etc.)
  const abilitiesEl = document.getElementById("entity-abilities-list");
  if (abilitiesEl) {
    abilitiesEl.innerHTML = "";
    
    // Only town_center entities have spawn ability
    const isTownCenter = (o.kind === "town_center" || (o.meta && o.meta.kind === "town_center"));
    if (isTownCenter) {
      const btn = document.createElement("button");
      btn.textContent = "Spawn Unit (cost: 1 green)";
      btn.style.height = "30px";
      
      // disable for players who don't own this town center or lack green resources
      const owned = (o.owner && o.owner === mySid);
      const hasGreen = (window.resourceCounts && (window.resourceCounts.green || 0) >= 1);
      btn.disabled = !owned || !hasGreen;
      
      if (!owned) {
        btn.title = "You do not own this building";
        btn.style.opacity = "0.5";
      } else if (!hasGreen) {
        btn.title = "Requires 1 green resource to spawn";
        btn.style.opacity = "0.5";
      }
      
      btn.onclick = () => {
        if (!o || !o.id) return;
        if (!owned) return; // double-check on click
        socket.emit("spawn_unit_from_entity", { entityId: o.id });
      };
      
      abilitiesEl.appendChild(btn);
    }
  }

  if (entityPanelEl) entityPanelEl.style.display = "block";
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
    buildMode = true;
    try { console.log('BUILD: buildMode ON'); } catch(e){}
  }
  if (t.id === 'mineBtn' || (t.closest && t.closest('#mineBtn'))) {
    mineMode = true;
    try { console.log('MINE: mineMode ON'); } catch(e){}
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
  const ec = document.getElementById("editorControls");
  if (ec) ec.style.display = editorMode ? "block" : "none";
  const bs = document.getElementById("brushSelect");
  if (bs) bs.disabled = !editorMode;
};

// Initialize editor controls visibility on load
(() => {
  const ec = document.getElementById("editorControls");
  if (ec) ec.style.display = editorMode ? "block" : "none";
  const bs = document.getElementById("brushSelect");
  if (bs) bs.disabled = !editorMode;
  if (bs) bs.addEventListener('change', resetCollisionOffset);
})();

const entityBtn = document.getElementById("entityBtn");
if (entityBtn) {
  entityBtn.onclick = () => {
    entityMode = !entityMode;
    entityBtn.textContent = entityMode ? "Entity: ON" : "Entity: OFF";
  };
}
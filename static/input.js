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

    // Ground item hover (priority 0)
  hoveredGroundItem = null;
  for (const it of groundItems) {
    if (Math.hypot(it.x - wx, it.y - wy) < 18) {
      hoveredGroundItem = it;
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

  canvas.style.cursor = "default";
});

function getFirstSelectedUnit() {
  return myUnits.find(u => u.selected) || null;
}

function findSlotElementAtScreen(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  // climb up to the LI
  // allow detecting either player unit slots or entity slots
  const unitSlot = el.closest && el.closest("#items-list li");
  if (unitSlot) return unitSlot;
  const entitySlot = el.closest && el.closest("#entity-items-list li");
  if (entitySlot) return entitySlot;
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

  // ✅ Click entity to inspect (works even when editorMode is off)
if (e.button === 0) {
  const hitEntity = hitTestMapObject(wx, wy);
  if (hitEntity) {
    openEntityInspector(hitEntity);
    e.preventDefault();
    return;
  }
}

    if (editorMode && e.button === 0) {
    if (e.shiftKey) {
      // delete nearest within radius
      let nearest = null, best = 40;
      for (const o of mapObjects) {
        const d = Math.hypot(o.x - wx, o.y - wy);
        if (d < best) { best = d; nearest = o; }
      }
      if (nearest) socket.emit("delete_map_object", { id: nearest.id });
      return;
    }

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

if (e.button === 0) {
  const picker = getFirstSelectedUnit();
  if (picker) {
    const hit = groundItems.find(it => Math.hypot(it.x - wx, it.y - wy) < 18);
    if (hit && unitCanPickup(picker, hit)) {
      draggingPickup = { groundItemId: hit.id, unitId: picker.id };

      dragMouse.x = e.clientX;
      dragMouse.y = e.clientY;

      // CAPTURE events globally so UI can't "steal" the drag
      window.addEventListener("mousemove", onGlobalDragMove, true);
      window.addEventListener("mouseup", onGlobalDragEnd, true);

      e.preventDefault();
      return;
    }
  }
}

  if (e.button === 0) { // left click

    // ===== Build placement =====
  if (buildMode && !localBuildingPlaced) {
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
  // keep mouse updated even over UI
  dragMouse.x = e.clientX;
  dragMouse.y = e.clientY;

  // optional: block text selection while dragging
  e.preventDefault();
}

function onGlobalDragEnd(e) {
  // stop capturing
  window.removeEventListener("mousemove", onGlobalDragMove, true);
  window.removeEventListener("mouseup", onGlobalDragEnd, true);

  if (!draggingPickup) return;

  const gi = groundItems.find(x => x.id === draggingPickup.groundItemId);
  const picker = myUnits.find(u => u.id === draggingPickup.unitId);
  draggingPickup = null;

  if (!gi || !picker) return;

  // must still be in range
  if (!unitCanPickup(picker, gi)) return;

  // must drop on a slot
  const slotEl = findSlotElementAtScreen(e.clientX, e.clientY);
  if (!slotEl) return;

  const slotIndex = parseInt(slotEl.dataset.slotIndex, 10);
  // if slot belongs to an entity slot list, handle ground -> entity transfer
  const entityContainer = slotEl.closest && slotEl.closest("#entity-items-list");
  if (entityContainer) {
    const entityId = slotEl.dataset.entityId;
    if (!entityId) return;
    console.log("ground -> entity drop", { entityId, entitySlotIndex: slotIndex, groundId: gi.id });
    socket.emit("ground_give_to_entity", {
      entityId,
      entitySlotIndex: slotIndex,
      groundItemId: gi.id
    });
    return;
  }

  const unitId = slotEl.dataset.unitId;
  const targetUnit = myUnits.find(u => u.id === unitId);
  if (!targetUnit) return;

  if (!targetUnit.itemSlots) targetUnit.itemSlots = [null, null];
  if (targetUnit.itemSlots[slotIndex]) return; // must be empty

  socket.emit("pickup_item", {
    unitId: targetUnit.id,
    slotIndex,
    groundItemId: gi.id
  });
}

canvas.addEventListener("mouseup", (e) => {
  if (e.button !== 0) return;
  if (!draggingPickup) return;

  const gi = groundItems.find(x => x.id === draggingPickup.groundItemId);
  const picker = myUnits.find(u => u.id === draggingPickup.unitId);
  draggingPickup = null;

  if (!gi || !picker) return;

  // Must still be in range at drop time
  if (!unitCanPickup(picker, gi)) return;

  // Must drop onto a slot in the UI
  const slotEl = findSlotElementAtScreen(e.clientX, e.clientY);
  if (!slotEl) return;

  const slotIndex = parseInt(slotEl.dataset.slotIndex, 10);
  const unitId = slotEl.dataset.unitId;

  // Only allow equipping to LOCAL unit equipment panel
  const targetUnit = myUnits.find(u => u.id === unitId);
  if (!targetUnit) return;

  if (!targetUnit.itemSlots) targetUnit.itemSlots = [null, null];

  // slot must be empty
  if (targetUnit.itemSlots[slotIndex]) return;

  // equip
  socket.emit("pickup_item", {
    unitId: targetUnit.id,
    slotIndex,
    groundItemId: gi.id
  });
});

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

        // Assign a stable formation index and total so units keep their relative positions
        selectedUnits.forEach((u, idx) => {
          u._formationIndex = idx;
          u._formationTotal = selectedUnits.length;

        
  u.targetEnemy = null;
  harvesting = null;

    if (clickedResource) {
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

buildBtn.onclick = ()=>{ if(!localBuildingPlaced) buildMode=true; };

// editor collision globals are declared in index.html to avoid duplicates

const editorBtn = document.getElementById("editorBtn");
editorBtn.onclick = () => {
  editorMode = !editorMode;
  editorBtn.textContent = editorMode ? "Editor: ON" : "Editor: OFF";
};
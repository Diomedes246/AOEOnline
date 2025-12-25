// Drawing functions moved from index.html

function drawCircleDebug(x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRectDebug(x, y, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
}

function drawEntityTitle(obj, sx, sy) {
  if (!obj?.meta?.entity) return;

  const title = (obj.meta.title && obj.meta.title.trim())
    ? obj.meta.title
    : getDefaultEntityTitle(obj);

  // Draw title (primary) and owner (smaller, beneath)
  ctx.textAlign = "center";

  // title line
  ctx.fillStyle = "white";
  ctx.font = "13px monospace";
  ctx.fillText(title, sx, sy - 36);

  // owner line
  const owner = obj.owner || (obj.meta && obj.meta.owner) || null;
  if (owner) {
    const ownerShort = String(owner).slice(0,6);
    const ownerColor = (players && players[owner] && players[owner].color) ? players[owner].color : "#ccc";
    ctx.font = "11px monospace";
    ctx.fillStyle = ownerColor;
    ctx.fillText(`owner: ${ownerShort}`, sx, sy - 22);
  }
}

function renderYForWorld(obj) {
  if (obj._type === "building") return obj.y + BUILD_H / 2;

  if (obj._type === "tile") {
    const defH = TILE_DEFS[obj.kind]?.h ?? 256;
    const h = obj.meta?.h ?? defH;
    return obj.y + h / 2;
  }

  if (obj._type === "tree") return obj.y;
  if (obj._type === "resource") return obj.y;
  if (obj._type === "ground") return obj.y;
  return obj.y;
}

function renderYForUnit(u) {
  return u.y;
}

function mouseWorld() {
  return {
    x: camera.x + mouse.x - canvas.width / 2,
    y: camera.y + mouse.y - canvas.height / 2
  };
}

function drawBackground(){
  const cx=canvas.width/2;
  const cy=canvas.height/2;
  const baseCol=Math.floor(camera.x/HALF_W);
  const baseRow=Math.floor(camera.y/HALF_H);
  const range=4;

  for(let r=-range;r<=range;r++){
    for(let c=-range;c<=range;c++){
      const col=baseCol+c;
      const row=baseRow+r;
      const wx=(col-row)*HALF_W;
      const wy=(col+row)*HALF_H;
      ctx.drawImage(tile, cx+wx-camera.x, cy+wy-camera.y);
    }
  }
}

function clamp01(v){ return Math.max(0, Math.min(1, v)); }

function drawHarvestBars() {
  const now = performance.now();

  for (const u of myUnits) {
    if (!u.harvesting) continue;

    const r = resources.find(rr => rr.id === u.harvesting.resourceId);
    if (!r) continue;

    const t = clamp01((now - u.harvesting.startTime) / HARVEST_TIME);

    const sx = canvas.width/2 + r.x - camera.x;
    const sy = canvas.height/2 + r.y - camera.y;

    const w = 46, h = 6;
    const x = sx - w/2;
    const y = sy - 34;

    // background
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x, y, w, h);

    // fill
    ctx.fillStyle = "rgba(0,255,0,0.85)";
    ctx.fillRect(x, y, w * t, h);

    // border
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }
}

function draw() {
  // Wait until all assets have loaded (overlay will be hidden).
  if (!window.ASSETS_LOADED) {
    return;
  }
  update();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw background
  drawBackground();

const worldRenderables = [];

// Trees
for (const t of trees) worldRenderables.push({ _type:"tree", x:t.x, y:t.y });

// Resources
for (const r of resources) worldRenderables.push({ _type:"resource", ...r });

// Ground items
for (const it of groundItems) worldRenderables.push({ _type:"ground", ...it });

// Editor map objects
for (const o of mapObjects) {
  worldRenderables.push({
    _type: o.type === "building" ? "building" : "tile",
    ...o
  });
}

// RTS buildings array
for (const b of buildings) worldRenderables.push({ _type:"building", ...b });

// Sort bottom-last
worldRenderables.sort((a,b) => {
  const ay = renderYForWorld(a), by = renderYForWorld(b);
  if (ay !== by) return ay - by;
  return (a.x - b.x);
});

// Draw world (NO units here)
for (const obj of worldRenderables) {
  const sx = canvas.width/2 + obj.x - camera.x;
  const sy = canvas.height/2 + obj.y - camera.y;
  if (obj._type === "tree") {
    ctx.drawImage(treeImg, sx - TREE_W/2, sy - TREE_H, TREE_W, TREE_H);
    continue;
  }

  if (obj._type === "resource") {
    ctx.drawImage(resourceImg, sx - RES_W/2, sy - RES_H/2, RES_W, RES_H);
    // small colored square above resource to indicate type
    const rtype = obj.type || 'red';
    const colorMap = { red: '#d32f2f', green: '#4CAF50', blue: '#2196F3' };
    const c = colorMap[rtype] || '#888';
    ctx.fillStyle = c;
    const sq = 10;
    ctx.fillRect(sx - sq/2, sy - RES_H/2 - 12 - sq, sq, sq);
    continue;
  }

  if (obj._type === "ground") {
    // Skip drawing if this item is being dragged
    if (draggingPickup && draggingPickup.groundItemId === obj.id) continue;
    
    const icon = itemIcons[obj.name];
    if (icon && icon.complete && icon.naturalWidth > 0) {
      ctx.drawImage(icon, sx - GROUND_ITEM_SIZE/2, sy - GROUND_ITEM_SIZE/2, GROUND_ITEM_SIZE, GROUND_ITEM_SIZE);
    }
    continue;
  }

  if (obj._type === "tile") {
    const def = TILE_DEFS[obj.kind] || { w: obj.meta?.w ?? 256, h: obj.meta?.h ?? 256, _placeholder: true };

    const w = obj.meta?.w ?? def.w ?? 256;
    const h = obj.meta?.h ?? def.h ?? 256;
    const img = tileImages[obj.kind];

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, sx - w / 2, sy - h / 2, w, h);
    } else {
      // Fallback so objects with missing art still render visibly
      ctx.fillStyle = "rgba(120,120,120,0.35)";
      ctx.fillRect(sx - w / 2, sy - h / 2, w, h);
      ctx.strokeStyle = "#f66";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(obj.kind || "tile", sx, sy - h / 2 + 16);
    }

    // Mine production progress (timer-synced)
    if (obj.kind === "mine") {
      const interval = Number(obj.meta?.interval || 30);
      const nextTick = Number(obj.meta?.nextTick || 0);
      const now = Date.now() / 1000;
      const remaining = nextTick ? Math.max(0, nextTick - now) : interval;
      const pct = Math.max(0, Math.min(1, 1 - (remaining / interval)));

      const barW = Math.min(140, w);
      const barH = 10;
      const bx = sx - barW / 2;
      const by = sy - h / 2 - 10; // nudge lower toward the sprite

      // resource color indicator
      const rtype = obj.meta?.mine?.resource || "red";
      const colorMap = { red: "#e53935", green: "#43a047", blue: "#1e88e5" };
      const rc = colorMap[rtype] || "#888";
      const sq = barH;
      ctx.fillStyle = rc;
      ctx.fillRect(bx - sq - 4, by, sq, barH);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - sq - 4, by, sq, barH);

      // progress bar
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = rc;
      ctx.fillRect(bx, by, barW * pct, barH);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, barW, barH);
    }

    // ✅ debug draw tile collision (rect centered on tile x,y)
    if (DEBUG_COLLISIONS && obj.meta?.collides) {
      ctx.strokeStyle = "rgba(0,255,255,0.4)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(
        sx - (obj.meta.cw ?? 0) / 2,
        sy - (obj.meta.ch ?? 0) / 2,
        (obj.meta.cw ?? 0),
        (obj.meta.ch ?? 0)
      );
      ctx.setLineDash([]);
    }
    drawEntityTitle(obj, sx, sy);
    // draw health bar for entity tiles
    if (obj.meta?.entity) {
      const hp = obj.hp ?? obj.meta.hp ?? null;
      if (hp !== null) {
        const wbar = obj.meta?.w ?? def.w;
        const hbar = 8;
        const bx = sx - Math.min(120, wbar) / 2;
        const by = sy - (obj.meta?.h ?? def.h) / 2 - 30; // higher to leave gap above progress bar
        const maxHp = obj.maxHp
          ?? obj.meta?.maxHp
          ?? (obj.kind === 'town_center' ? 500
              : (obj.kind === 'mine' ? 300
                  : (obj.kind === 'blacksmith' ? 300 : 200)));
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx, by, Math.min(120, wbar), hbar);
        const pct = Math.max(0, Math.min(1, (hp / maxHp)));
        ctx.fillStyle = (obj.kind === 'house') ? '#4CAF50' : 'red';
        ctx.fillRect(bx, by, Math.min(120, wbar) * pct, hbar);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, Math.min(120, wbar), hbar);
      }
    }
    continue;
  }


  if (obj._type === "building") {
    ctx.drawImage(buildingImg, sx - BUILD_W/2, sy - BUILD_H/2, BUILD_W, BUILD_H);

    if (obj.selected) {
      ctx.strokeStyle = "cyan";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(sx - BUILD_W/2, sy - BUILD_H/2, BUILD_W, BUILD_H);
      ctx.setLineDash([]);
    }
    // draw health bar for entities
    if (obj.meta?.entity) {
      const hp = obj.hp ?? obj.meta.hp ?? null;
      if (hp !== null) {
        const barW = 70;
        const barH = 8;
        const bx = sx - barW/2;
        const by = sy - BUILD_H/2 - 18;

        const maxHp = obj.maxHp
          ?? obj.meta?.maxHp
          ?? (obj.kind === 'town_center' ? 500
              : (obj.kind === 'mine' ? 300
                  : (obj.kind === 'blacksmith' ? 300 : 200)));

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx, by, barW, barH);
        const pct = Math.max(0, Math.min(1, (hp / maxHp)));
        ctx.fillStyle = (obj.kind === 'house') ? '#4CAF50' : 'red';
        ctx.fillRect(bx, by, barW * pct, barH);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, barW, barH);
      }
    }
    continue;
  }
}

// ===== Editor placement preview (ghost) =====
if (editorMode) {
  const bs = document.getElementById("brushSelect");
  if (bs && bs.value) {
    const { x: wx, y: wy } = mouseWorld();
    const sx = canvas.width / 2 + wx - camera.x;
    const sy = canvas.height / 2 + wy - camera.y;

    const [type, kind] = bs.value.split(":");

    ctx.save();
    ctx.globalAlpha = 0.55;

    if (type === "building" && kind === "building") {
      // building ghost
      if (buildingImg && buildingImg.complete && buildingImg.naturalWidth > 0) {
        ctx.drawImage(buildingImg, sx - BUILD_W / 2, sy - BUILD_H / 2, BUILD_W, BUILD_H);
      } else {
        ctx.strokeStyle = "white";
        ctx.strokeRect(sx - BUILD_W / 2, sy - BUILD_H / 2, BUILD_W, BUILD_H);
      }
    } else if (type === "tile") {
      const def = TILE_DEFS[kind];
      const img = tileImages[kind];

    const w = editorTileW;
    const h = editorTileH;

      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, sx - w / 2, sy - h / 2, w, h);
      } else {
        // fallback ghost box
        ctx.strokeStyle = "white";
        ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
        ctx.fillStyle = "white";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(kind || "tile", sx, sy);
      }
    }

    // extra outline so it’s readable
    ctx.globalAlpha = 1;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;

    if (type === "building") {
      ctx.strokeStyle = "cyan";
      ctx.strokeRect(sx - BUILD_W / 2, sy - BUILD_H / 2, BUILD_W, BUILD_H);
    } else if (type === "tile") {
    const w = editorTileW;
    const h = editorTileH;
      ctx.strokeStyle = "lime";
      ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
    }

    // draw collision preview
if (type === "tile" && editorCollisionEnabled) {
  ctx.save();
  ctx.strokeStyle = "rgba(0,255,255,0.9)";
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeRect(
    sx - editorCollisionW / 2,
    sy - editorCollisionH / 2,
    editorCollisionW,
    editorCollisionH
  );
  ctx.restore();
}


if (type === "tile" && !editorCollisionEnabled) {
  ctx.fillStyle = "rgba(255,0,0,0.6)";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.fillText("NO COLLISION", sx, sy - 40);
}


    ctx.restore();
  }
}



const unitRenderables = [];

// my units (reference)
for (const u of myUnits) unitRenderables.push({ owner: mySid, ref: u });

// other players units (reference)
for (const sid in players) {
  if (sid === mySid) continue;
  for (const u of (players[sid].units || [])) {
    unitRenderables.push({ owner: sid, ref: u });
  }
}

unitRenderables.sort((a,b) => renderYForUnit(a.ref) - renderYForUnit(b.ref));

for (const item of unitRenderables) {
  const u = item.ref;
  const isMine = (item.owner === mySid);

  const sx = canvas.width/2 + u.x - camera.x;
  const sy = canvas.height/2 + u.y - camera.y;

  let frames, framesShadow, frameIndex;

  if (!isMine) {
    if (u.anim === "attack") {
      frames = playerSprites.attack[u.dir];
      framesShadow = playerSprites.attackshadow[u.dir];
      u.renderAttackFrame = (u.renderAttackFrame ?? 0) + ANIM_SPEED;
      if (u.renderAttackFrame >= ATTACK_ANIM_FRAMES) u.renderAttackFrame = 0;
      frameIndex = Math.floor(u.renderAttackFrame);
    } else if (u.anim === "walk") {
      frames = playerSprites.walk[u.dir];
      framesShadow = playerSprites.walkshadow[u.dir];
      u.renderFrame = (u.renderFrame ?? 0) + ANIM_SPEED;
      if (u.renderFrame >= WALK_FRAMES) u.renderFrame = 0;
      frameIndex = Math.floor(u.renderFrame);
    } else {
      frames = playerSprites.idle[u.dir];
      framesShadow = playerSprites.idleshadow[u.dir];
      u.renderFrame = (u.renderFrame ?? 0) + ANIM_SPEED;
      if (u.renderFrame >= IDLE_FRAMES) u.renderFrame = 0;
      frameIndex = Math.floor(u.renderFrame);
    }
  } else {
    if (u.anim === "attack") {
      frames = playerSprites.attack[u.dir];
      framesShadow = playerSprites.attackshadow[u.dir];
      frameIndex = Math.floor(u.attackFrame || 0);
    } else if (u.anim === "walk") {
      frames = playerSprites.walk[u.dir];
      framesShadow = playerSprites.walkshadow[u.dir];
      frameIndex = Math.floor(u.frame || 0);
    } else {
      frames = playerSprites.idle[u.dir];
      framesShadow = playerSprites.idleshadow[u.dir];
      frameIndex = Math.floor(u.frame || 0);
    }
  }

  const img = frames?.[frameIndex];
  const sh  = framesShadow?.[frameIndex];

  if (sh && sh.complete) ctx.drawImage(sh, sx - SPRITE_W/2, sy - SPRITE_H/2, SPRITE_W, SPRITE_H);
  if (img && img.complete) ctx.drawImage(img, sx - SPRITE_W/2, sy - SPRITE_H/2, SPRITE_W, SPRITE_H);

  // HP bar
  const computedStats = (typeof getUnitStats === "function") ? getUnitStats(u) : null;
  const maxHp = u.maxHp || computedStats?.maxHp || UNIT_MAX_HEALTH || 100;
  const hpVal = (typeof u.hp === "number") ? u.hp : maxHp;
  const hpRatio = Math.max(0, Math.min(1, maxHp > 0 ? (hpVal / maxHp) : 0));
  ctx.fillStyle = "red";
  ctx.fillRect(sx - 20, sy - 30, 40, 5);
  ctx.fillStyle = "green";
  ctx.fillRect(sx - 20, sy - 30, 40 * hpRatio, 5);

  // selection ring
  if (isMine && u.selected) {
    ctx.strokeStyle = "yellow";
    ctx.beginPath();
    ctx.arc(sx, sy + SPRITE_H/4, 18, 0, Math.PI*2);
    ctx.stroke();
  }
}







  // Hover outlines
  if (hoveredResource) {
    const x = canvas.width / 2 + hoveredResource.x - camera.x;
    const y = canvas.height / 2 + hoveredResource.y - camera.y;

    ctx.strokeStyle = "yellow";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, RESOURCE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (hoveredPlayerSid && players[hoveredPlayerSid]) {
    const p = players[hoveredPlayerSid];
    const x = canvas.width / 2 + p.x - camera.x;
    const y = canvas.height / 2 + p.y - camera.y;

    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.rect(x - 14, y - 14, 28, 28);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Attack hover for enemy entities
  if (typeof hoveredAttackEntity !== 'undefined' && hoveredAttackEntity) {
    const ent = hoveredAttackEntity;
    const w = (ent.meta && (ent.meta.cw || ent.meta.w)) ? (ent.meta.cw || ent.meta.w) : (ent.type === 'building' ? BUILD_W : (TILE_DEFS[ent.kind]?.w || 256));
    const h = (ent.meta && (ent.meta.ch || ent.meta.h)) ? (ent.meta.ch || ent.meta.h) : (ent.type === 'building' ? BUILD_H : (TILE_DEFS[ent.kind]?.h || 256));
    const ex = canvas.width/2 + ent.x - camera.x;
    const ey = canvas.height/2 + ent.y - camera.y;

    ctx.strokeStyle = 'rgba(255,50,50,0.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6,4]);
    ctx.beginPath();
    ctx.rect(ex - w/2, ey - h/2, w, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }


  drawHarvestBars();




  // Building placement preview
  if (buildMode) {
    ctx.globalAlpha = 0.5;
    const wx = camera.x + mouse.x - canvas.width / 2;
    const wy = camera.y + mouse.y - canvas.height / 2;
    const bx = canvas.width / 2 + wx - camera.x;
    const by = canvas.height / 2 + wy - camera.y;
    ctx.drawImage(buildingImg, bx - BUILD_W / 2, by - BUILD_H / 2, BUILD_W, BUILD_H);
    ctx.globalAlpha = 1;
  }

  // Mine placement preview (mirrors building ghost)
  if (mineMode) {
    ctx.globalAlpha = 0.5;
    const wx = camera.x + mouse.x - canvas.width / 2;
    const wy = camera.y + mouse.y - canvas.height / 2;
    const mx = canvas.width / 2 + wx - camera.x;
    const my = canvas.height / 2 + wy - camera.y;
    try { if (!window.__minePreviewLoggedOnce) { console.log('MINE: drawing ghost preview'); window.__minePreviewLoggedOnce = true; } } catch(e){}
    if (mineImg && mineImg.complete && mineImg.naturalWidth > 0) {
      ctx.drawImage(mineImg, mx - MINE_W / 2, my - MINE_H / 2, MINE_W, MINE_H);
    } else {
      // fallback ghost box so it's visible even before image load
      ctx.strokeStyle = "white";
      ctx.strokeRect(mx - MINE_W / 2, my - MINE_H / 2, MINE_W, MINE_H);
    }
    ctx.globalAlpha = 1;
  }

  // Blacksmith placement preview (mirrors mine ghost)
  if (blacksmithMode) {
    ctx.globalAlpha = 0.5;
    const wx = camera.x + mouse.x - canvas.width / 2;
    const wy = camera.y + mouse.y - canvas.height / 2;
    const mx = canvas.width / 2 + wx - camera.x;
    const my = canvas.height / 2 + wy - camera.y;
    if (blacksmithImg && blacksmithImg.complete && blacksmithImg.naturalWidth > 0) {
      ctx.drawImage(blacksmithImg, mx - BLACKSMITH_W / 2, my - BLACKSMITH_H / 2, BLACKSMITH_W, BLACKSMITH_H);
    } else {
      ctx.strokeStyle = "white";
      ctx.strokeRect(mx - BLACKSMITH_W / 2, my - BLACKSMITH_H / 2, BLACKSMITH_W, BLACKSMITH_H);
    }
    ctx.globalAlpha = 1;
  }

  // Selection box
  if (selecting) {
    ctx.strokeStyle = "white";
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(selectStart.x, selectStart.y, mouse.x - selectStart.x, mouse.y - selectStart.y);
    ctx.setLineDash([]);
  }

  // Panels logic
  const selectedBuilding = buildings.find(b => b.selected);
  const selectedUnits = myUnits.filter(u => u.selected);

  if (selectedBuilding) {
    buildingPanel.style.display = "block";
    panel.style.display = "none";
  } else if (selectedUnits.length > 0) {
    panel.style.display = "block";
    buildingPanel.style.display = "none";
  } else {
    panel.style.display = "none";
    buildingPanel.style.display = "none";
  }



// pick a "current unit" for pickup distance checks: first selected local unit
const picker = myUnits.find(u => u.selected) || null;

const visibleItems = groundItems.slice().sort((a,b)=>a.y-b.y);
for (const it of visibleItems) {
  const sx = canvas.width/2 + it.x - camera.x;
  const sy = canvas.height/2 + it.y - camera.y;

  // icon / fallback
  const icon = itemIcons[it.name];
  if (icon && icon.complete && icon.naturalWidth > 0) {
    ctx.drawImage(icon, sx - GROUND_ITEM_SIZE/2, sy - GROUND_ITEM_SIZE/2, GROUND_ITEM_SIZE, GROUND_ITEM_SIZE);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.arc(sx, sy, 14, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.stroke();
  }

  // name above item (always)
  ctx.fillStyle = "white";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.fillText(it.name, sx, sy - 22);

  // Hover tooltip for ground item stats
  if (hoveredGroundItem && hoveredGroundItem.id === it.id) {
    const statTxt = itemStatText ? itemStatText(it.name) : "";
    if (statTxt) {
      const tip = statTxt;
      ctx.font = "11px monospace";
      const tw = ctx.measureText(tip).width + 12;
      const th = 16;
      const tx = sx - tw / 2;
      const ty = sy - 42;

      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(tx, ty - th, tw, th);
      ctx.strokeStyle = "#0ff";
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, ty - th, tw, th);

      ctx.fillStyle = "#0ff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tip, sx, ty - th / 2);

      // reset baseline for downstream text
      ctx.textBaseline = "alphabetic";
    }
  }

  // show pickup range indicator if a selected unit is near enough
  if (picker && unitCanPickup(picker, it)) {
    ctx.strokeStyle = "lime";
    ctx.beginPath();
    ctx.arc(sx, sy, 18, 0, Math.PI*2);
    ctx.stroke();
  }
}

  if (draggingPickup) {
    const gi = groundItems.find(x => x.id === draggingPickup.groundItemId);
    if (gi) {
      const icon = itemIcons[gi.name];
      const mx = dragMouse.x;
      const my = dragMouse.y;

      ctx.globalAlpha = 0.85;
      if (icon && icon.complete && icon.naturalWidth > 0) {
        ctx.drawImage(icon, mx - 16, my - 16, 32, 32);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.arc(mx, my, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.stroke();
        ctx.fillStyle = "white";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(gi.name, mx, my - 18);
      }
      ctx.globalAlpha = 1;
    }
  }




  // HUD update (safe use of selectedUnits)
  // Population: local units and cap based on owned town centers
  const popCount = myUnits.length;
  const townCentersOwned = (mapObjects || []).filter(o => o.owner === mySid && o.kind === 'town_center').length;
  const popCap = townCentersOwned * (typeof POP_LIMIT === 'number' ? POP_LIMIT : 10);

  const rc = window.resourceCounts || { red:0, green:0, blue:0 };
  hud.innerHTML = `Camera: ${camera.x|0}, ${camera.y|0}<br/>
<span style="color:#d32f2f">■</span> ${rc.red || 0} <span style="color:#4CAF50">■</span> ${rc.green || 0} <span style="color:#2196F3">■</span> ${rc.blue || 0}<br/>
Selected: ${selectedUnits.length}<br/>
Population: ${popCount} / ${popCap}<br/>
TileSize: ${editorTileW}x${editorTileH}  Collision: ${editorCollisionEnabled ? `${editorCollisionW}x${editorCollisionH}` : "OFF"}`;


  requestAnimationFrame(draw);
}
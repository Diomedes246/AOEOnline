// Drawing functions moved from index.html
// Ensure selection globals exist even if input.js loads twice
if (typeof window.selectStart === "undefined") window.selectStart = { x: 0, y: 0 };
if (typeof window.selecting === "undefined") window.selecting = false;
var selectStart = window.selectStart;
var selecting = window.selecting;

const QUEST_MARKER_OFFSET = 6; // pixels above the sprite's head

// Load item tile sheet
const itemTileSheet = new Image();
itemTileSheet.src = 'static/all.png';
window.itemTileSheet = itemTileSheet; // Make it globally accessible
const ITEM_TILE_SIZE = 32;

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
    const ownerColor = (players && players[owner] && players[owner].color) ? players[owner].color : "#ccc";
    ctx.font = "11px monospace";
    ctx.fillStyle = ownerColor;
    ctx.fillText(`owner: ${owner}`, sx, sy - 22);
  }
  
  // Draw quest marker if entity gives a quest
  if (obj.meta && obj.meta.givesQuest) {
    drawQuestMarker(sx, sy - 56); // Just above the title (title is at sy - 36)
  }
}

function drawQuestMarker(sx, sy) {
  // Draw a bright exclamation mark in a star or highlight
  const size = 16;
  
  // Yellow/gold background circle
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.arc(sx, sy, size/2 + 2, 0, Math.PI * 2);
  ctx.fill();
  
  // White border
  ctx.strokeStyle = '#FFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, size/2 + 2, 0, Math.PI * 2);
  ctx.stroke();
  
  // Exclamation mark text
  ctx.fillStyle = '#000';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', sx, sy);
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

  // Persistent NPC animation state (keyed by NPC ID)
  if (typeof window.npcAnimState === 'undefined') {
    window.npcAnimState = {};
  }
  const npcAnimState = window.npcAnimState;

  const worldRenderables = [];

  // Trees
  for (const t of trees) worldRenderables.push({ _type:"tree", x:t.x, y:t.y });

  // Resources
  for (const r of resources) worldRenderables.push({ _type:"resource", ...r });

  // Ground items
  for (const it of groundItems) worldRenderables.push({ _type:"ground", ...it });

  // Editor map objects
  for (const o of mapObjects) {
    // NPCs and spiders get their own type for special rendering
    if (o.kind === 'npc' || o.kind === 'spider') {
      worldRenderables.push({
        _type: "npc",
        ...o
      });
    } else {
      worldRenderables.push({
        _type: o.type === "building" ? "building" : "tile",
        ...o
      });
    }
  }

  // RTS buildings array
  for (const b of buildings) worldRenderables.push({ _type:"building", ...b });

  // Sort bottom-last
  worldRenderables.sort((a,b) => {
    const za = (a.meta && typeof a.meta.z === "number") ? a.meta.z : (typeof a.z === "number" ? a.z : 0);
    const zb = (b.meta && typeof b.meta.z === "number") ? b.meta.z : (typeof b.z === "number" ? b.z : 0);
    if (za !== zb) return za - zb; // higher z draws later
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
      ctx.fillText(obj.name, sx, sy - 22);

      // Hover tooltip for ground item stats
      if (hoveredGroundItem && hoveredGroundItem.id === obj.id) {
        const statTxt = itemStatText ? itemStatText(obj.name) : "";
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
      continue;
    }

    if (obj._type === "tile") {
    // Skip canvas rendering for billboards (they're CSS-only)
    if (obj.kind === 'billboard') {
      // Billboards show title/owner within the CSS element, not as canvas text
      if (obj.meta?.entity) {
        const hp = obj.hp ?? obj.meta.hp ?? null;
        if (hp !== null) {
          const def = TILE_DEFS[obj.kind] || { w: obj.meta?.w ?? 256, h: obj.meta?.h ?? 256 };
          const wbar = obj.meta?.w ?? def.w;
          const hbar = 8;
          const bx = sx - Math.min(120, wbar) / 2;
          const by = sy - (obj.meta?.h ?? def.h) / 2 - 30;
          const maxHp = obj.maxHp ?? obj.meta?.maxHp ?? 200;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(bx, by, Math.min(120, wbar), hbar);
          const pct = Math.max(0, Math.min(1, (hp / maxHp)));
          ctx.fillStyle = 'red';
          ctx.fillRect(bx, by, Math.min(120, wbar) * pct, hbar);
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, Math.min(120, wbar), hbar);
        }
      }
      // Editor mode selection highlight
      if (editorMode && window.selectedEditorEntity && obj.id === window.selectedEditorEntity.id) {
        const w = obj.meta?.w ?? 300;
        const h = obj.meta?.h ?? 200;
        ctx.strokeStyle = "lime";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(sx - w / 2 - 5, sy - h / 2 - 5, w + 10, h + 10);
        ctx.setLineDash([]);
      }
      // Collision debug for billboards
      if (DEBUG_COLLISIONS && obj.meta?.collides) {
        const cx = sx + (obj.meta.cx || 0);
        const cy = sy + (obj.meta.cy || 0);
        ctx.strokeStyle = "rgba(0,255,255,0.4)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(
          cx - (obj.meta.cw ?? 0) / 2,
          cy - (obj.meta.ch ?? 0) / 2,
          (obj.meta.cw ?? 0),
          (obj.meta.ch ?? 0)
        );
        ctx.setLineDash([]);
      }
      continue;
    }

    // Render items from tile sheet
    if (obj.kind === 'item' && obj.meta?.itemTile) {
      // Skip drawing if this item is being dragged
      if (draggingPickup && draggingPickup.mapObjectItemId === obj.id) continue;
      
      const w = obj.meta?.w ?? 64;
      const h = obj.meta?.h ?? 64;
      const itemTile = obj.meta.itemTile;
      
      // Draw from tile sheet if loaded
      if (itemTileSheet.complete && itemTileSheet.naturalWidth > 0) {
        const srcX = itemTile.tx * ITEM_TILE_SIZE;
        const srcY = itemTile.ty * ITEM_TILE_SIZE;
        ctx.drawImage(
          itemTileSheet,
          srcX, srcY, ITEM_TILE_SIZE, ITEM_TILE_SIZE,
          sx - w / 2, sy - h / 2, w, h
        );
      } else {
        // Fallback placeholder
        ctx.fillStyle = "rgba(180,180,100,0.5)";
        ctx.fillRect(sx - w / 2, sy - h / 2, w, h);
        ctx.strokeStyle = "#ff6";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
      }
      
      // Draw title and stats
      drawEntityTitle(obj, sx, sy);
      
      // Editor mode selection highlight
      if (editorMode && window.selectedEditorEntity && obj.id === window.selectedEditorEntity.id) {
        ctx.strokeStyle = "lime";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(sx - w / 2 - 5, sy - h / 2 - 5, w + 10, h + 10);
        ctx.setLineDash([]);
      }
      
      continue;
    }
    
    const def = TILE_DEFS[obj.kind] || { w: obj.meta?.w ?? 256, h: obj.meta?.h ?? 256, _placeholder: true };

    const w = obj.meta?.w ?? def.w ?? 256;
    const h = obj.meta?.h ?? def.h ?? 256;
    const img = getTileFrame(obj.kind);

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

    // ✅ debug draw tile collision (rect with offset)
    if (DEBUG_COLLISIONS && obj.meta?.collides) {
      const cx = sx + (obj.meta.cx || 0);
      const cy = sy + (obj.meta.cy || 0);
      ctx.strokeStyle = "rgba(0,255,255,0.4)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(
        cx - (obj.meta.cw ?? 0) / 2,
        cy - (obj.meta.ch ?? 0) / 2,
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
    // Editor mode: highlight selected entity for movement
    if (editorMode && window.selectedEditorEntity && obj.id === window.selectedEditorEntity.id) {
      ctx.strokeStyle = "lime";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(sx - w / 2 - 5, sy - h / 2 - 5, w + 10, h + 10);
      ctx.setLineDash([]);
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
    // Editor mode: highlight selected entity for movement
    if (editorMode && window.selectedEditorEntity && obj.id === window.selectedEditorEntity.id) {
      ctx.strokeStyle = "lime";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(sx - BUILD_W/2 - 5, sy - BUILD_H/2 - 5, BUILD_W + 10, BUILD_H + 10);
      ctx.setLineDash([]);
    }
    continue;
  }

  if (obj._type === "npc") {
    // Render NPC (same logic as units but from worldRenderables for z-order)
    const u = obj;
    const animState = npcAnimState[u.id] || { renderFrame: 0, renderAttackFrame: 0 };
    
    const anim = u.meta?.anim || 'idle';
    const dir = u.meta?.dir || '000';
    
    // Determine sprite set based on NPC kind
    const isSpider = (u.kind === 'spider');
    const spriteSet = isSpider ? spiderSprites : npcSprites;
    const walkFrameCount = isSpider ? SPIDER_WALK_FRAMES : NPC_WALK_FRAMES;
    
    let frames, framesShadow, frameIndex;
    
    if (isSpider) {
      // Spiders only have walk animation (no idle or shadow)
      frames = spriteSet.walk[dir];
      framesShadow = null;
      animState.renderFrame = (animState.renderFrame ?? 0) + ANIM_SPEED;
      if (animState.renderFrame >= walkFrameCount) animState.renderFrame = 0;
      frameIndex = Math.floor(animState.renderFrame);
    } else if (anim === "attack") {
      frames = npcSprites.attack?.[dir] || npcSprites.attack[dir];
      framesShadow = npcSprites.attackshadow?.[dir] || npcSprites.attackshadow[dir];
      animState.renderAttackFrame = (animState.renderAttackFrame ?? 0) + ANIM_SPEED;
      if (animState.renderAttackFrame >= ATTACK_ANIM_FRAMES) animState.renderAttackFrame = 0;
      frameIndex = Math.floor(animState.renderAttackFrame);
    } else if (anim === "walk") {
      frames = npcSprites.walk[dir];
      framesShadow = npcSprites.walkshadow[dir];
      animState.renderFrame = (animState.renderFrame ?? 0) + ANIM_SPEED;
      if (animState.renderFrame >= NPC_WALK_FRAMES) animState.renderFrame = 0;
      frameIndex = Math.floor(animState.renderFrame);
    } else {
      frames = npcSprites.idle[dir];
      framesShadow = npcSprites.idleshadow[dir];
      animState.renderFrame = (animState.renderFrame ?? 0) + ANIM_SPEED;
      if (animState.renderFrame >= IDLE_FRAMES) animState.renderFrame = 0;
      frameIndex = Math.floor(animState.renderFrame);
    }
    
    const shadowImg = framesShadow?.[frameIndex];
    const bodyImg = frames?.[frameIndex];
    
    // Spiders use smaller sprite size (100px instead of 256px)
    const spriteW = isSpider ? 100 : SPRITE_W;
    const spriteH = isSpider ? 100 : SPRITE_H;
    
    if (shadowImg && shadowImg.complete) {
      ctx.drawImage(shadowImg, sx - spriteW/2, sy - spriteH/2, spriteW, spriteH);
    }
    if (bodyImg && bodyImg.complete) {
      ctx.drawImage(bodyImg, sx - spriteW/2, sy - spriteH/2, spriteW, spriteH);
    }
    
    // Draw health bar for spiders
    if (isSpider) {
      const hp = u.hp ?? 50;
      const maxHp = u.maxHp || 50;
      const barW = 60;
      const barH = 6;
      const bx = sx - barW/2;
      const by = sy - 50 - 15; // Use 50 as half of spider sprite height (100px)
      
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(bx, by, barW, barH);
      const pct = Math.max(0, Math.min(1, hp / maxHp));
      ctx.fillStyle = '#d32f2f';
      ctx.fillRect(bx, by, barW * pct, barH);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, barW, barH);
    }
    
    // Draw title/name for NPCs (not spiders)
    if (!isSpider) {
      drawEntityTitle(u, sx, sy);
    }
    
    // Draw quest marker for spiders that give quests
    if (isSpider && u.meta && u.meta.givesQuest) {
      drawQuestMarker(sx, sy - 50); // Just above where name text appears
    }
    
    // Editor mode selection highlight
    if (editorMode && window.selectedEditorEntity && u.id === window.selectedEditorEntity.id) {
      ctx.strokeStyle = "lime";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      const spriteW = isSpider ? 100 : SPRITE_W;
      const spriteH = isSpider ? 100 : SPRITE_H;
      ctx.strokeRect(sx - spriteW/2 - 5, sy - spriteH/2 - 5, spriteW + 10, spriteH + 10);
      ctx.setLineDash([]);
    }
    
    continue;
  }
}

// ===== Editor placement preview (ghost) =====
// Suppress editor brush preview while placing an item
if (editorMode && !window.itemPlacementMode) {
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
      const img = getTileFrame(kind);

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

// NPCs are now added to worldRenderables to respect z-order
// Ensure their animation state exists and initialize client-side movement
for (const obj of mapObjects) {
  if (obj.kind === 'npc' || obj.kind === 'spider') {
    if (!npcAnimState[obj.id]) {
      npcAnimState[obj.id] = { 
        renderFrame: 0, 
        renderAttackFrame: 0,
        clientX: obj.x,
        clientY: obj.y,
        lastTargetWP: null
      };
    }
    // Only sync to server position when targetWaypoint changes (new waypoint reached)
    const state = npcAnimState[obj.id];
    const targetWP = obj.meta?.targetWaypoint;
    if (targetWP) {
      const wpKey = `${targetWP.x},${targetWP.y}`;
      if (state.lastTargetWP !== wpKey) {
        // New waypoint - check if it's far from client position
        const dist = Math.hypot(targetWP.x - state.clientX, targetWP.y - state.clientY);
        if (dist > 200) {
          // Far away - likely respawn or teleport, snap to server position
          state.clientX = obj.x;
          state.clientY = obj.y;
        }
        state.lastTargetWP = wpKey;
      }
    }
  }
}

// Sort units by z-order first, then Y coordinate
unitRenderables.sort((a,b) => {
  const refA = a.ref;
  const refB = b.ref;
  
  // Check z-order first
  const za = (refA.meta && typeof refA.meta.z === "number") ? refA.meta.z : (typeof refA.z === "number" ? refA.z : 0);
  const zb = (refB.meta && typeof refB.meta.z === "number") ? refB.meta.z : (typeof refB.z === "number" ? refB.z : 0);
  if (za !== zb) return za - zb; // higher z draws later
  
  // Then sort by Y coordinate
  return renderYForUnit(refA) - renderYForUnit(refB);
});

for (const item of unitRenderables) {
  const u = item.ref;
  const isMine = (item.owner === mySid);
  const ownerName = item.owner;
  const isNPC = item.isNPC;

  // Client-side interpolation for NPCs - ALWAYS use client position, never server position
  let renderX, renderY;
  let clientAnim = isNPC ? (u.meta?.anim || 'idle') : u.anim;
  
  if (isNPC && animState) {
    // NPCs always render at client-interpolated position
    const targetWP = u.meta?.targetWaypoint;
    
    if (targetWP) {
      // Smoothly move toward target waypoint
      const dx = targetWP.x - animState.clientX;
      const dy = targetWP.y - animState.clientY;
      const dist = Math.hypot(dx, dy);
      
      if (dist > 1.0) {
        const speed = 2.0; // client-side movement speed (pixels per frame)
        const step = Math.min(speed, dist);
        animState.clientX += (dx / dist) * step;
        animState.clientY += (dy / dist) * step;
        clientAnim = 'walk';
        
        // Update direction based on movement
        const angle = ((Math.atan2(dy, dx) * 180 / Math.PI + 90) % 360);
        const dirs = [0,22,45,67,90,112,135,157,180,202,225,247,270,292,315,337];
        let closest = dirs[0];
        let minDiff = 360;
        for(const d of dirs){
          let diff = Math.abs(d - angle);
          diff = Math.min(diff, 360 - diff);
          if(diff < minDiff){
            minDiff = diff;
            closest = d;
          }
        }
        if (!u.meta) u.meta = {};
        u.meta.dir = closest.toString().padStart(3,"0");
      } else {
        // Reached target
        animState.clientX = targetWP.x;
        animState.clientY = targetWP.y;
        clientAnim = 'idle';
      }
    }
    
    renderX = animState.clientX;
    renderY = animState.clientY;
  } else {
    // Players use server position
    renderX = u.x;
    renderY = u.y;
  }

  const sx = canvas.width/2 + renderX - camera.x;
  const sy = canvas.height/2 + renderY - camera.y;

  let frames, framesShadow, frameIndex;

  // NPCs use meta.anim and meta.dir (with client-side animation override)
  const anim = isNPC ? clientAnim : u.anim;
  const dir = isNPC ? (u.meta?.dir || '000') : u.dir;

  // Choose sprite set (npcSprites for NPCs, playerSprites for players)
  const spriteSet = isNPC ? npcSprites : playerSprites;

  // Get animation state (use persistent store for NPCs)
  let animState = isNPC ? npcAnimState[u.id] : u;
  if (!animState) {
    animState = { renderFrame: 0, renderAttackFrame: 0 };
    if (isNPC) npcAnimState[u.id] = animState;
  }

  if (!isMine || isNPC) {
    if (anim === "attack") {
      frames = spriteSet.attack?.[dir] || playerSprites.attack[dir];
      framesShadow = spriteSet.attackshadow?.[dir] || playerSprites.attackshadow[dir];
      animState.renderAttackFrame = (animState.renderAttackFrame ?? 0) + ANIM_SPEED;
      if (animState.renderAttackFrame >= ATTACK_ANIM_FRAMES) animState.renderAttackFrame = 0;
      frameIndex = Math.floor(animState.renderAttackFrame);
    } else if (anim === "walk") {
      frames = spriteSet.walk[dir];
      framesShadow = spriteSet.walkshadow[dir];
      animState.renderFrame = (animState.renderFrame ?? 0) + ANIM_SPEED;
      const walkFrameCount = isNPC ? NPC_WALK_FRAMES : WALK_FRAMES;
      if (animState.renderFrame >= walkFrameCount) animState.renderFrame = 0;
      frameIndex = Math.floor(animState.renderFrame);
    } else {
      frames = spriteSet.idle[dir];
      framesShadow = spriteSet.idleshadow[dir];
      animState.renderFrame = (animState.renderFrame ?? 0) + ANIM_SPEED;
      if (animState.renderFrame >= IDLE_FRAMES) animState.renderFrame = 0;
      frameIndex = Math.floor(animState.renderFrame);
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

  // NPCs show title instead of HP bar
  if (isNPC) {
    const title = u.meta?.title || 'NPC';
    ctx.fillStyle = "cyan";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(title, sx, sy - 40);
  } else {
  // HP bar
  const computedStats = (typeof getUnitStats === "function") ? getUnitStats(u) : null;
  const maxHp = u.maxHp || computedStats?.maxHp || UNIT_MAX_HEALTH || 100;
  const hpVal = (typeof u.hp === "number") ? u.hp : maxHp;
  const hpRatio = Math.max(0, Math.min(1, maxHp > 0 ? (hpVal / maxHp) : 0));
  ctx.fillStyle = "red";
  ctx.fillRect(sx - 20, sy - 30, 40, 5);
  ctx.fillStyle = "green";
  ctx.fillRect(sx - 20, sy - 30, 40 * hpRatio, 5);
  }

  // Collision debug for units
  if (DEBUG_COLLISIONS) {
    drawCircleDebug(sx, sy, PLAYER_RADIUS, isMine ? "rgba(0,255,255,0.6)" : "rgba(255,0,0,0.45)");
  }

  // Selection highlight
  if (u.selected) {
    ctx.strokeStyle = "yellow";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 20, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Player name above unit
  if (ownerName) {
    const displayName = ownerName.substring(0, 12);
    ctx.fillStyle = players[ownerName]?.color || "white";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(displayName, sx, sy - 40);
  }
}







  // Collision debug overlays for world objects
  if (DEBUG_COLLISIONS) {
    // NPC and Spider paths
    for (const obj of mapObjects) {
      if ((obj.kind === 'npc' || obj.kind === 'spider') && obj.meta?.waypoints) {
        const waypoints = obj.meta.waypoints;
        if (waypoints.length < 2) continue;
        
        ctx.strokeStyle = "rgba(255, 165, 0, 0.8)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        
        for (let i = 0; i < waypoints.length; i++) {
          const wp = waypoints[i];
          const sx = canvas.width/2 + wp.x - camera.x;
          const sy = canvas.height/2 + wp.y - camera.y;
          
          if (i === 0) {
            ctx.moveTo(sx, sy);
          } else {
            ctx.lineTo(sx, sy);
          }
          
          // Draw waypoint markers
          ctx.fillStyle = "rgba(255, 165, 0, 0.6)";
          ctx.fillRect(sx - 4, sy - 4, 8, 8);
          ctx.fillStyle = "white";
          ctx.font = "10px monospace";
          ctx.fillText(i.toString(), sx - 3, sy + 3);
        }
        
        // Close the loop
        const firstWP = waypoints[0];
        const lastSX = canvas.width/2 + firstWP.x - camera.x;
        const lastSY = canvas.height/2 + firstWP.y - camera.y;
        ctx.lineTo(lastSX, lastSY);
        
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    
    // Trees (circle at collision center)
    for (const t of trees) {
      const tx = canvas.width/2 + t.x - camera.x;
      const ty = canvas.height/2 + (t.y - 150) - camera.y;
      drawCircleDebug(tx, ty, TREE_RADIUS, "rgba(0,255,0,0.45)");
    }

    // Buildings list
    for (const b of buildings) {
      const left   = b.x - BUILD_W / 2 - BUILD_COLLISION_PADDING;
      const right  = b.x + BUILD_W / 2 + BUILD_COLLISION_PADDING;
      const top    = b.y - BUILD_H / 2 - BUILD_COLLISION_PADDING;
      const bottom = b.y + BUILD_H / 2 + BUILD_COLLISION_PADDING;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const w = (right - left);
      const h = (bottom - top);
      drawRectDebug(canvas.width/2 + cx - camera.x, canvas.height/2 + cy - camera.y, w, h, "rgba(255,128,0,0.55)");
    }

    // Enemy units (already drawn above for all, but keep consistent color)
    for (const sid in players) {
      if (sid === mySid) continue;
      for (const u of (players[sid].units || [])) {
        const sxu = canvas.width/2 + u.x - camera.x;
        const syu = canvas.height/2 + u.y - camera.y;
        drawCircleDebug(sxu, syu, PLAYER_RADIUS, "rgba(255,0,0,0.45)");
      }
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

  // Hover highlight for units
  if (typeof hoveredUnit !== 'undefined' && hoveredUnit) {
    const sx = canvas.width/2 + hoveredUnit.x - camera.x;
    const sy = canvas.height/2 + hoveredUnit.y - camera.y;
    ctx.strokeStyle = 'rgba(100,200,255,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4,2]);
    ctx.beginPath();
    ctx.rect(sx - 30, sy - 30, 60, 60);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Hover highlight for buildings and entities
  if (typeof hoveredObject !== 'undefined' && hoveredObject) {
    const ox = canvas.width/2 + hoveredObject.x - camera.x;
    const oy = canvas.height/2 + hoveredObject.y - camera.y;
    const ow = hoveredObject.w || 256;
    const oh = hoveredObject.h || 256;
    ctx.strokeStyle = 'rgba(100,200,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4,2]);
    ctx.beginPath();
    ctx.rect(ox - ow/2, oy - oh/2, ow, oh);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Hover highlight for ground items
  if (typeof hoveredGroundItem !== 'undefined' && hoveredGroundItem) {
    const gx = canvas.width/2 + hoveredGroundItem.x - camera.x;
    const gy = canvas.height/2 + hoveredGroundItem.y - camera.y;
    ctx.strokeStyle = 'rgba(100,255,150,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3,3]);
    ctx.beginPath();
    ctx.rect(gx - 24, gy - 24, 48, 48);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Move-to crosshair markers (one per selected unit target)
  try {
    const markers = window.moveMarkers || [];
    const now = performance.now();
    const lifetime = 1200;
    for (let i = markers.length - 1; i >= 0; i--) {
      const mm = markers[i];
      if (!mm || typeof mm.x !== 'number' || typeof mm.y !== 'number' || typeof mm.ts !== 'number') continue;
      const age = now - mm.ts;
      if (age >= lifetime) {
        markers.splice(i,1);
        continue;
      }
      const t = age / lifetime;
      const alpha = Math.max(0, 1 - t);
      const pulse = 12 + 10 * (1 - t);
      const sx = canvas.width / 2 + mm.x - camera.x;
      const sy = canvas.height / 2 + mm.y - camera.y;
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${(0.75 * alpha).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - pulse, sy);
      ctx.lineTo(sx + pulse, sy);
      ctx.moveTo(sx, sy - pulse);
      ctx.lineTo(sx, sy + pulse);
      ctx.stroke();
      ctx.restore();
    }
    window.moveMarkers = markers;
  } catch (e) {}


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

  // Item placement preview (shows selected tile from item picker)
  if (window.itemPlacementMode && window.selectedItemTile && typeof window.itemTileSheet !== "undefined" && window.itemTileSheet.complete) {
    ctx.globalAlpha = 0.7;
    const wx = camera.x + mouse.x - canvas.width / 2;
    const wy = camera.y + mouse.y - canvas.height / 2;
    const ix = canvas.width / 2 + wx - camera.x;
    const iy = canvas.height / 2 + wy - camera.y;
    
    const itemTile = window.selectedItemTile;
    const tileSize = 32;
    const displaySize = 64; // larger preview for visibility
    const srcX = itemTile.tx * tileSize;
    const srcY = itemTile.ty * tileSize;
    
    ctx.drawImage(
      window.itemTileSheet,
      srcX, srcY, tileSize, tileSize,
      ix - displaySize / 2, iy - displaySize / 2, displaySize, displaySize
    );
    
    // Draw crosshair around selected item
    ctx.strokeStyle = "rgba(0,255,100,0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(ix - displaySize / 2, iy - displaySize / 2, displaySize, displaySize);
    ctx.setLineDash([]);
    
    ctx.globalAlpha = 1;
  }
  
  // NOTE: Skip all other placement previews if in item placement mode
  if (!window.itemPlacementMode) {
    // Editor collision preview at cursor (honors offset) - but not when dragging
    if (editorMode && !draggingPickup) {
      const wx = camera.x + mouse.x - canvas.width / 2;
      const wy = camera.y + mouse.y - canvas.height / 2;
      const cx = canvas.width / 2 + wx - camera.x + (editorCollisionOffsetX || 0);
      const cy = canvas.height / 2 + wy - camera.y + (editorCollisionOffsetY || 0);
      const w = editorCollisionW;
      const h = editorCollisionH;
      ctx.save();
      ctx.strokeStyle = "rgba(0,255,255,0.9)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      ctx.setLineDash([]);
      ctx.restore();
    }
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
  const selectedUnitsLocal = myUnits.filter(u => u.selected);
  const unitPanelEl = document.getElementById("unit-panel");

  if (selectedBuilding) {
    buildingPanel.style.display = "block";
    panel.style.display = "none";
    if (unitPanelEl) unitPanelEl.style.display = "none";
  } else if (selectedUnitsLocal.length > 0) {
    panel.style.display = "block";
    buildingPanel.style.display = "none";
    if (unitPanelEl) unitPanelEl.style.display = "block";
  } else {
    panel.style.display = "none";
    buildingPanel.style.display = "none";
    if (unitPanelEl) unitPanelEl.style.display = "none";
    // Clear unit list/items when nothing selected
    try {
      const unitListEl = document.getElementById("unit-list");
      if (unitListEl) unitListEl.innerHTML = "";
      const itemsListEl = document.getElementById("items-list");
      if (itemsListEl) itemsListEl.innerHTML = "";
      const unitItemsTitle = document.querySelector('#unit-panel h4');
      if (unitItemsTitle) unitItemsTitle.textContent = "Unit Items";
    } catch (e) {}
  }

  // pick a "current unit" for pickup distance checks: first selected local unit
  const picker = myUnits.find(u => u.selected) || null;

  // Draw pickup range indicators for ground items
  for (const it of groundItems) {
    if (picker && unitCanPickup(picker, it)) {
      const sx = canvas.width/2 + it.x - camera.x;
      const sy = canvas.height/2 + it.y - camera.y;
      ctx.strokeStyle = "lime";
      ctx.beginPath();
      ctx.arc(sx, sy, 18, 0, Math.PI*2);
      ctx.stroke();
    }
  }

  // Dragging ground item icon follows cursor
  if (draggingPickup) {
    const gi = draggingPickup.groundItemId 
      ? groundItems.find(x => x.id === draggingPickup.groundItemId)
      : mapObjects.find(x => x.id === draggingPickup.mapObjectItemId);
    if (gi) {
      const mx = dragMouse.x;
      const my = dragMouse.y;

      ctx.globalAlpha = 0.85;
      
      // For map object items, draw from tile sheet
      if (draggingPickup.mapObjectItemId && gi.meta?.itemTile && itemTileSheet.complete) {
        const itemTile = gi.meta.itemTile;
        const srcX = itemTile.tx * ITEM_TILE_SIZE;
        const srcY = itemTile.ty * ITEM_TILE_SIZE;
        ctx.drawImage(
          itemTileSheet,
          srcX, srcY, ITEM_TILE_SIZE, ITEM_TILE_SIZE,
          mx - 16, my - 16, 32, 32
        );
      } else if (draggingPickup.groundItemId) {
        // For ground items, use icon
        const icon = itemIcons[gi.name];
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
      }
      ctx.globalAlpha = 1;
    }
  }

  // Cinematic overlay last so it sits above the scene
  drawCinematicOverlay();

  // HUD update (safe use of selectedUnits)
  // Population: local units and cap based on owned town centers
  const popCount = myUnits.length;
  const townCentersOwned = (mapObjects || []).filter(o => o.owner === mySid && o.kind === 'town_center').length;
  const popCap = townCentersOwned * (typeof POP_LIMIT === 'number' ? POP_LIMIT : 10);

  const rc = window.resourceCounts || { red:0, green:0, blue:0 };
  const editorEntityInfo = (editorMode && window.selectedEditorEntity) 
    ? `<br/><span style="color:lime">Selected Entity: ${window.selectedEditorEntity.kind || 'entity'} (Arrow keys to move, Shift+Arrow for collision)</span>` 
    : '';
  hud.innerHTML = `Camera: ${camera.x|0}, ${camera.y|0}<br/>
  <span style="color:#d32f2f">■</span> ${rc.red || 0} <span style="color:#4CAF50">■</span> ${rc.green || 0} <span style="color:#2196F3">■</span> ${rc.blue || 0}<br/>
  Selected: ${selectedUnitsLocal.length}<br/>
  Population: ${popCount} / ${popCap}${editorEntityInfo}`;

  updateEditorStatsPanel();

  // Update billboards (CSS-based rendering)
  if (typeof updateBillboards === 'function') {
    updateBillboards();
  }

  requestAnimationFrame(draw);
}

function drawCinematicOverlay() {
  // Filter disabled per request.
}

function updateEditorStatsPanel() {
  const tileEl = document.getElementById('statTileSize');
  const zEl = document.getElementById('statZ');
  const collEl = document.getElementById('statColl');
  if (!tileEl && !zEl && !collEl) return;

  if (tileEl) tileEl.textContent = `${editorTileW} x ${editorTileH}`;
  if (zEl) {
    const zv = document.getElementById('zOrderInput');
    zEl.textContent = zv ? (zv.value || 0) : 0;
  }
  if (collEl) {
    const coX = typeof editorCollisionOffsetX === 'number' ? editorCollisionOffsetX : 0;
    const coY = typeof editorCollisionOffsetY === 'number' ? editorCollisionOffsetY : 0;
    const cw = typeof editorCollisionW === 'number' ? editorCollisionW : 0;
    const ch = typeof editorCollisionH === 'number' ? editorCollisionH : 0;
    collEl.textContent = `${cw}x${ch} @ (${coX}, ${coY})`;
  }
}

function getTileFrame(kind) {
  const def = TILE_DEFS[kind];
  if (def && def.frames && def.frames.length) {
    const speed = def.animSpeed || 8;
    const idx = Math.floor((performance.now() / 1000) * speed) % def.frames.length;
    return def.frames[idx];
  }
  return tileImages[kind];
}
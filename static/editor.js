// ===== EDITOR BRUSH DEFINITIONS (DYNAMIC) =====
let TILE_DEFS = {};     // kind -> {src,w,h}
let tileImages = {};    // kind -> Image

// You can set defaults here (or extend later with per-tile sizes)
const DEFAULT_TILE_W = 256;
const DEFAULT_TILE_H = 256;

const TILE_SCALE_STEP = 16;
const TILE_SCALE_MIN = 16;
const TILE_SCALE_MAX = 2048;

// Use global collision constants declared in index.html to avoid duplicates

const brushSelect = document.getElementById("brushSelect");

if (brushSelect) {
  brushSelect.addEventListener("change", () => {
  const [type, kind] = brushSelect.value.split(":");
  if (type !== "tile") return;

  const def = TILE_DEFS[kind];
  if (!def) return;

  editorTileOverride = false; // back to file size defaults
  editorTileW = def.w;
  editorTileH = def.h;
  editorTileAspect = editorTileH / editorTileW;
  });
}

function prettyName(stem) {
  // "building2" -> "Building2", "dark_road" -> "Dark Road"
  return stem
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function rebuildBrushSelect(tileNames) {
  const brushSelect = document.getElementById("brushSelect");
  if (!brushSelect) {
    console.error("brushSelect not found in DOM (id='brushSelect').");
    return;
  }

  // keep the first option (Building)
  brushSelect.innerHTML = "";

  // Add billboard option first
  const billboardOpt = document.createElement("option");
  billboardOpt.value = "tile:billboard";
  billboardOpt.textContent = "Special: Billboard";
  brushSelect.appendChild(billboardOpt);

  // Add NPC option
  const npcOpt = document.createElement("option");
  npcOpt.value = "tile:npc";
  npcOpt.textContent = "Special: NPC";
  brushSelect.appendChild(npcOpt);

  // Add Spider option
  const spiderOpt = document.createElement("option");
  spiderOpt.value = "tile:spider";
  spiderOpt.textContent = "Special: Spider";
  brushSelect.appendChild(spiderOpt);

  for (const name of tileNames) {
    const opt = document.createElement("option");
    opt.value = `tile:${name}`;
    opt.textContent = `Tile: ${prettyName(name)}`;
    brushSelect.appendChild(opt);
  }

  if (tileNames.length === 0) {
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "No tiles found in /static/tiles";
    brushSelect.appendChild(opt);
  }
}

async function loadTilesFromServer() {
  const brushSelect = document.getElementById("brushSelect");
  if (!brushSelect) {
    console.error("brushSelect not found; delaying tile load until DOM exists.");
    return;
  }

  try {
    const res = await fetch("/tiles_manifest", { cache: "no-store" });
    if (!res.ok) throw new Error(`tiles_manifest HTTP ${res.status}`);
    const data = await res.json();

    const tileNames = Array.isArray(data.tiles) ? data.tiles : [];
    if (!tileNames.includes("campfire")) tileNames.push("campfire");

    TILE_DEFS = {};
    tileImages = {};

for (const name of tileNames) {
  if (name === "campfire") {
    const frames = [];
    for (let i = 1; i <= 7; i++) {
      const f = new Image();
      f.src = `static/campfire/campfire${i}.png`;
      frames.push(f);
    }

    TILE_DEFS[name] = { src: frames[0].src, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H, frames, animSpeed: 8 };
    tileImages[name] = frames[0];

    const applySize = (img) => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        TILE_DEFS[name].w = img.naturalWidth;
        TILE_DEFS[name].h = img.naturalHeight;
        const bs = document.getElementById("brushSelect");
        if (bs && bs.value === `tile:${name}` && !editorTileOverride) {
          editorTileW = TILE_DEFS[name].w;
          editorTileH = TILE_DEFS[name].h;
          editorTileAspect = editorTileH / editorTileW;
        }
      }
    };
    frames.forEach((img) => {
      if (img.complete) applySize(img);
      else img.onload = () => applySize(img);
    });
  } else {
    const img = new Image();
    img.src = `static/tiles/${name}.png`;

    // set temporary defaults (will be replaced on load)
    TILE_DEFS[name] = { src: img.src, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
    tileImages[name] = img;

    const applySize = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        TILE_DEFS[name].w = img.naturalWidth;
        TILE_DEFS[name].h = img.naturalHeight;

        // If this tile is currently selected, snap editor size to real file size
        const bs = document.getElementById("brushSelect");
        if (bs && bs.value === `tile:${name}` && !editorTileOverride) {
          editorTileW = TILE_DEFS[name].w;
          editorTileH = TILE_DEFS[name].h;
          editorTileAspect = editorTileH / editorTileW;
        }
      }
    };

    // Works for both cached + freshly loaded images
    if (img.complete) applySize();
    else img.onload = applySize;
  }
}

    // If there's no explicit 'town_center' tile but we have a 'building' tile,
    // alias 'town_center' to use the same image so town centers render.
    if (!tileNames.includes("town_center") && tileNames.includes("building")) {
      TILE_DEFS["town_center"] = { ...TILE_DEFS["building"] };
      tileImages["town_center"] = tileImages["building"];
      tileNames.push("town_center");
    }

    // Add billboard as a special tile type
    TILE_DEFS["billboard"] = { w: 300, h: 200, isBillboard: true };
    
    // Add NPC as a special tile type
    TILE_DEFS["npc"] = { w: 64, h: 64, isNPC: true };
    
    // Add Spider as a special tile type
    TILE_DEFS["spider"] = { w: 64, h: 64, isSpider: true };
    
    rebuildBrushSelect(tileNames);
  } catch (err) {
    console.error("Failed to load tiles manifest:", err);

    // fallback UI (safe)
    brushSelect.innerHTML = "";
    const optBuilding = document.createElement("option");
    optBuilding.value = "building:building";
    optBuilding.textContent = "Building";
    brushSelect.appendChild(optBuilding);

    const optFail = document.createElement("option");
    optFail.disabled = true;
    optFail.textContent = "Failed to load tiles";
    brushSelect.appendChild(optFail);
  }
}


window.addEventListener("DOMContentLoaded", () => {
  loadTilesFromServer();
});

canvas.addEventListener("wheel", (e) => {
  if (!editorMode) return;

  e.preventDefault();

  const delta = Math.sign(e.deltaY);

  // If entity is selected, adjust its collision box
  if (window.selectedEditorEntity) {
    const ent = window.selectedEditorEntity;
    if (!ent.meta) ent.meta = {};
    
    const currentCW = ent.meta.cw || 256;
    const currentCH = ent.meta.ch || 256;
    
    const newCW = Math.max(
      COLLISION_MIN,
      Math.min(COLLISION_MAX, currentCW - delta * COLLISION_STEP)
    );
    const newCH = Math.max(
      COLLISION_MIN,
      Math.min(COLLISION_MAX, currentCH - delta * COLLISION_STEP)
    );
    
    ent.meta.cw = newCW;
    ent.meta.ch = newCH;
    
    // Update server
    socket.emit("update_map_object", {
      id: ent.id,
      meta: { cw: newCW, ch: newCH }
    });
    
    return;
  }

  // SHIFT = scale the TILE DRAW SIZE (preview + placed size)
if (e.shiftKey) {
  editorTileOverride = true;

  // Scale width, compute height from aspect ratio
  const newW = Math.max(
    TILE_SCALE_MIN,
    Math.min(TILE_SCALE_MAX, editorTileW - delta * TILE_SCALE_STEP)
  );

  let newH = Math.round(newW * editorTileAspect);

  // Clamp height too, and recompute width if height clamp hit
  if (newH < TILE_SCALE_MIN) {
    newH = TILE_SCALE_MIN;
    const wFromH = Math.round(newH / editorTileAspect);
    editorTileW = Math.max(TILE_SCALE_MIN, Math.min(TILE_SCALE_MAX, wFromH));
    editorTileH = newH;
  } else if (newH > TILE_SCALE_MAX) {
    newH = TILE_SCALE_MAX;
    const wFromH = Math.round(newH / editorTileAspect);
    editorTileW = Math.max(TILE_SCALE_MIN, Math.min(TILE_SCALE_MAX, wFromH));
    editorTileH = newH;
  } else {
    editorTileW = newW;
    editorTileH = newH;
  }

  return;
}


  // Normal wheel = scale COLLISION rectangle (existing)
  editorCollisionW = Math.max(
    COLLISION_MIN,
    Math.min(COLLISION_MAX, editorCollisionW - delta * COLLISION_STEP)
  );
  editorCollisionH = Math.max(
    COLLISION_MIN,
    Math.min(COLLISION_MAX, editorCollisionH - delta * COLLISION_STEP)
  );
}, { passive: false });
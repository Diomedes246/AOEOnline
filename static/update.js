// Update functions moved from index.html

function getDirKey(dx, dy) {
    // invert dy because screen Y increases down but 000 is north
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

    return closest.toString().padStart(3,"0");
}

function getUnitTargetOffset(idx, total) {
    // Spread in a circle around target
    const angle = (idx / total) * Math.PI * 2; // even spacing
    const radius = total*10; // distance from center
    return {
        dx: Math.cos(angle) * radius,
        dy: Math.sin(angle) * radius
    };
}

function findNearestEnemy(u) {
    let nearest = null;
    let nearestDist = Infinity;

    // Check other players' units
    for(const sid in players){
        if(sid === mySid) continue;
        const p = players[sid];
        p.units.forEach((eu, idx) => {
            if(eu.hp <= 0) return;
            const dist = Math.hypot(u.x - eu.x, u.y - eu.y);
            if(dist < nearestDist){
                nearestDist = dist;
                nearest = {
    sid,
    unitId: eu.id,
    x: eu.x,
    y: eu.y
};

            }
        });
    }

    return nearest;
}

function removeDeadUnits(unitsArray) {
    for (let i = unitsArray.length - 1; i >= 0; i--) {
        if (unitsArray[i].hp <= 0) {
            unitsArray.splice(i, 1);
        }
    }
}

function advanceLocalAnim(u) {
  if (u.anim === "attack") {
    u.attackFrame = ((u.attackFrame ?? 0) + ANIM_SPEED) % ATTACK_ANIM_FRAMES;
  } else if (u.anim === "walk") {
    u.frame = ((u.frame ?? 0) + ANIM_SPEED) % WALK_FRAMES;
  } else {
    // idle (default)
    u.frame = ((u.frame ?? 0) + ANIM_SPEED) % IDLE_FRAMES;
  }
}

function resolveCircleRect(unit, radius, rect) {
  const left   = rect.x - rect.w / 2;
  const right  = rect.x + rect.w / 2;
  const top    = rect.y - rect.h / 2;
  const bottom = rect.y + rect.h / 2;

  const closestX = Math.max(left, Math.min(unit.x, right));
  const closestY = Math.max(top, Math.min(unit.y, bottom));

  const dx = unit.x - closestX;
  const dy = unit.y - closestY;
  const dist = Math.hypot(dx, dy);

  if (dist === 0 || dist >= radius) return;

  const overlap = radius - dist;
  const nx = dx / dist;
  const ny = dy / dist;

  unit.x += nx * overlap;
  unit.y += ny * overlap;
}

function resolveCircleCircle(unit, radius, cx, cy, cr) {
  const dx = unit.x - cx;
  const dy = unit.y - cy;
  const dist = Math.hypot(dx, dy);
  const minDist = radius + cr;

  if (dist === 0 || dist >= minDist) return;

  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;

  unit.x += nx * overlap;
  unit.y += ny * overlap;

  if (DEBUG_COLLISIONS) {
    const ux = canvas.width/2 + unit.x - camera.x;
    const uy = canvas.height/2 + unit.y - camera.y;
    drawCircleDebug(ux, uy, radius, "rgba(0,255,255,0.6)");
    drawCircleDebug(canvas.width/2 + cx - camera.x, canvas.height/2 + cy - camera.y, cr, "rgba(255,0,0,0.35)");
  }
}

function resolveCircleBuilding(unit, radius, b) {
  const left   = b.x - BUILD_W / 2 - BUILD_COLLISION_PADDING;
  const right  = b.x + BUILD_W / 2 + BUILD_COLLISION_PADDING;
  const top    = b.y - BUILD_H / 2 - BUILD_COLLISION_PADDING;
  const bottom = b.y + BUILD_H / 2 + BUILD_COLLISION_PADDING;

  const closestX = Math.max(left, Math.min(unit.x, right));
  const closestY = Math.max(top, Math.min(unit.y, bottom));

  const dx = unit.x - closestX;
  const dy = unit.y - closestY;
  const dist = Math.hypot(dx, dy);

  if (dist === 0 || dist >= radius) return;

  const overlap = radius - dist;
  const nx = dx / dist;
  const ny = dy / dist;

  unit.x += nx * overlap;
  unit.y += ny * overlap;

  if (DEBUG_COLLISIONS) {
    drawRectDebug(
      canvas.width/2 + (left+right)/2 - camera.x,
      canvas.height/2 + (top+bottom)/2 - camera.y,
      (right-left),
      (bottom-top),
      "rgba(255,0,0,0.35)"
    );
  }
}

function applyCollisions(u) {
  // Trees (circle-circle)
  for (const t of trees) {
    resolveCircleCircle(u, PLAYER_RADIUS, t.x, t.y - 150, TREE_RADIUS);
  }

  // Resources (circle-circle)
  for (const r of resources) {
    resolveCircleCircle(u, PLAYER_RADIUS, r.x, r.y, RESOURCE_RADIUS_COLLIDE);
  }

  // Buildings (circle-rect using BUILD_W/H)
  for (const b of buildings) {
    resolveCircleBuilding(u, PLAYER_RADIUS, b);
  }

  // Tile collisions (keep your rect version)
  for (const o of mapObjects) {
    if (o.type !== "tile") continue;
    if (!o.meta || !o.meta.collides) continue;

    resolveCircleRect(u, PLAYER_RADIUS, {
      x: o.x, y: o.y,
      w: o.meta.cw, h: o.meta.ch
    });
  }

  // Other local units (circle-circle)
  for (const other of myUnits) {
    if (other === u) continue;
    resolveCircleCircle(u, UNIT_RADIUS, other.x, other.y, UNIT_RADIUS);
  }

  // Other players units (circle-circle)
  for (const sid in players) {
    if (sid === mySid) continue;
    for (const opUnit of players[sid].units) {
      resolveCircleCircle(u, PLAYER_RADIUS, opUnit.x, opUnit.y, UNIT_RADIUS);
    }
  }
}

function update(){
    if (!mySid) return;
    if (!myUnits || myUnits.length === 0) return; // wait for server state
    // --- CAMERA ---
    if(keys.w) camera.y -= camSpeed;
    if(keys.s) camera.y += camSpeed;
    if(keys.a) camera.x -= camSpeed;
    if(keys.d) camera.x += camSpeed;

    const now = performance.now();


    removeDeadUnits(myUnits);

    for (const sid in players) {
        if (sid === mySid) continue;
        if (!players[sid] || !players[sid].units) continue;
        removeDeadUnits(players[sid].units);
    }


    // --- UNIT LOGIC ---
    for(let i = myUnits.length - 1; i >= 0; i--){
        const u = myUnits[i];

        if(u.hp <= 0){
            myUnits.splice(i, 1);
            continue;
        }

          // --- Manual move ---
  if(u.manualMove){
      // Prefer a stable formation index assigned when the move was issued
      const groupMembers = myUnits.filter(mu => mu.selected && mu.manualMove);
      const groupSize = Math.max(1, u._formationTotal || groupMembers.length);
      let unitIndex = (typeof u._formationIndex === 'number') ? u._formationIndex : groupMembers.indexOf(u);
      if (unitIndex < 0) unitIndex = 0;
      const offset = getUnitTargetOffset(unitIndex, groupSize);

      const targetX = u.tx + offset.dx;
      const targetY = u.ty + offset.dy;

      const dx = targetX - u.x;
      const dy = targetY - u.y;
      const dist = Math.hypot(dx, dy);
        if(dist > 1.5){
          const speed = 4.5;
          u.x += (dx / dist) * Math.min(speed, dist);
          u.y += (dy / dist) * Math.min(speed, dist);
          u.anim = "walk";
          u.dir = getDirKey(dx, dy);
      
      } else {
          u.x = targetX;
          u.y = targetY;
          u.manualMove = false;
          u.anim = "idle";
          // clear formation metadata once move completes
          delete u._formationIndex;
          delete u._formationTotal;
          
      }
        // Resolve collisions with other units/buildings after moving
        applyCollisions(u);
        advanceLocalAnim(u);
      u.lastX = u.x;
      u.lastY = u.y;
      continue;
  }


     // --- Resource harvesting ---
if (u.targetResource !== null) {
  const r = resources.find(rr => rr.id === u.targetResource);
  if (!r) {
    u.targetResource = null;
    u.harvesting = null;
  } else {
    const dx = r.x - u.x;
    const dy = r.y - u.y;
    const dist = Math.hypot(dx, dy);

    if (dist > RESOURCE_STOP_RADIUS) {
      const speed = 2.6;
      u.x += (dx / dist) * Math.min(speed, dist);
      u.y += (dy / dist) * Math.min(speed, dist);
      u.anim = "walk";
      u.dir = getDirKey(dx, dy);
     
    } else {
      u.anim = "idle";
  

      // ✅ harvest check uses harvest radius
      if (dist <= RESOURCE_HARVEST_RADIUS) {
        if (!u.harvesting || u.harvesting.resourceId !== r.id) {
          u.harvesting = { resourceId: r.id, startTime: now };
        } else if (now - u.harvesting.startTime >= HARVEST_TIME) {
          resources = resources.filter(rr => rr.id !== r.id);
          resourceCount++;
          u.harvesting = null;
          u.targetResource = null;
        }
      }
      }
    }
      // Resolve collisions after movement while harvesting
      applyCollisions(u);
      advanceLocalAnim(u);
      u.lastX = u.x;
      u.lastY = u.y;
  continue;
}



        // --- Combat & auto-chase ---
        // --- Combat & auto-chase ---
if (!u.manualMove) {

  // validate current targetEnemy by unitId
  if (u.targetEnemy) {
    const enemyPlayer = players[u.targetEnemy.sid];
    if (!enemyPlayer || !enemyPlayer.units || enemyPlayer.units.length === 0) {
      u.targetEnemy = null;
    } else {
      const enemyUnit = enemyPlayer.units.find(eu => eu.id === u.targetEnemy.unitId);
      if (!enemyUnit || (enemyUnit.hp ?? 0) <= 0) u.targetEnemy = null;
    }
  }

  // acquire target if none
  if (!u.targetEnemy) {
    const nearest = findNearestEnemy(u);
    if (nearest) {
      const dist = Math.hypot(u.x - nearest.x, u.y - nearest.y);
      if (dist <= 200) u.targetEnemy = nearest;
    }
  }

  // engage target
  if (u.targetEnemy) {
    const enemyPlayer = players[u.targetEnemy.sid];
    const enemy = enemyPlayer?.units?.find(eu => eu.id === u.targetEnemy.unitId);

    if (!enemy || (enemy.hp ?? 0) <= 0) {
      u.targetEnemy = null;
    } else {
      const dx = enemy.x - u.x;
      const dy = enemy.y - u.y;
      const dist = Math.hypot(dx, dy);

      if (dist > UNIT_ATTACK_RANGE) {
        const moveSpeed = 1.2;
        u.x += (dx / dist) * moveSpeed;
        u.y += (dy / dist) * moveSpeed;
        u.anim = "walk";
        u.dir = getDirKey(dx, dy);
      } else {
        u.anim = "attack";
        if (u.attackCooldown >= ATTACK_COOLDOWN) {
          console.log("ATTACK", u.id, "->", u.targetEnemy.sid, u.targetEnemy.unitId);
          socket.emit("attack_unit", {
            targetSid: u.targetEnemy.sid,
            unitId: u.targetEnemy.unitId,
            damage: UNIT_ATTACK_DPS / 60
          });
          u.attackCooldown = 0;
        }
      }
    }
  } else {
    if (u.anim !== "idle") u.anim = "idle";
  }
}

  // --- Cooldowns ---
  if (u.attackCooldown < ATTACK_COOLDOWN) u.attackCooldown += 16.66;

  // Resolve collisions after combat movement/auto-chase
  applyCollisions(u);

  // ✅ ALWAYS advance animation frames based on current anim
  advanceLocalAnim(u);

u.lastX = u.x;
u.lastY = u.y;
    }

    if(DEBUG_COLLISIONS){
        for(const u of myUnits){
            applyCollisions(u); // only for drawing, don't push
        }
    }


    // --- SEND STATE TO SERVER ---
const unitStates = myUnits.map(u => ({
    id: u.id,          // ⭐ REQUIRED
    x: u.x,
    y: u.y,
    tx: u.tx,
    ty: u.ty,
    anim: u.anim,
    dir: u.dir,
    hp: u.hp
}));
    socket.emit("update_units", { units: unitStates });
}
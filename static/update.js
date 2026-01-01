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

// Movement tuning
const CHASE_SPEED = 4.5;   // speed when auto-chasing enemies/buildings (match run speed)
const HARVEST_SPEED = 3.8; // speed when moving to harvest resources
const FRAME_TIME = 1000 / 60; // baseline frame time

let lastUpdateTime = performance.now();

// Item-driven stat bonuses (keep in sync with server)
const DPS_PER_ATTACK_POINT = 5;   // sword = +1 attack
const HP_PER_DEFENSE_POINT = 15;  // shield = +1 defense

function getUnitStats(u) {
  const slots = (u && u.itemSlots) || [];
  let attack = 0;
  let defense = 0;

  for (const s of slots) {
    if (!s || !s.name) continue;
    const name = String(s.name).toLowerCase();
    if (name === "sword") attack += 1;
    else if (name === "shield") defense += 1;
  }

  const baseHp = typeof UNIT_MAX_HEALTH === "number" ? UNIT_MAX_HEALTH : 100;
  const baseDps = typeof UNIT_ATTACK_DPS === "number" ? UNIT_ATTACK_DPS : 30;

  return {
    attack,
    defense,
    maxHp: baseHp + defense * HP_PER_DEFENSE_POINT,
    dps: baseDps + attack * DPS_PER_ATTACK_POINT
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
        nearest = { kind: 'unit', sid, unitId: eu.id, x: eu.x, y: eu.y };

            }
        });
    }

    // Check enemy buildings (town_center / building / mine)
    for (const o of (mapObjects || [])) {
      if (!(o.kind === 'town_center' || o.type === 'building' || o.kind === 'mine')) continue;
      if (o.owner === mySid) continue; // don't attack own buildings
      const dist = Math.hypot(u.x - o.x, u.y - o.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = { kind: 'entity', entityId: o.id, x: o.x, y: o.y };
      }
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

function advanceLocalAnim(u, dtScale) {
  const step = ANIM_SPEED * (dtScale || 1);
  if (u.anim === "attack") {
    u.attackFrame = ((u.attackFrame ?? 0) + step) % ATTACK_ANIM_FRAMES;
  } else if (u.anim === "walk") {
    u.frame = ((u.frame ?? 0) + step) % WALK_FRAMES;
  } else {
    // idle (default)
    u.frame = ((u.frame ?? 0) + step) % IDLE_FRAMES;
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

  if (dist === 0 || dist >= radius) return null;

  const overlap = radius - dist + 1; // Add 1px buffer to prevent edge-case jitter
  const nx = dist === 0 ? 1 : dx / dist;
  const ny = dist === 0 ? 0 : dy / dist;

  unit.x += nx * overlap;
  unit.y += ny * overlap;

  return { collided: true, nx, ny, cx: rect.x, cy: rect.y, r: Math.max(rect.w, rect.h) / 2 };
}

function resolveCircleCircle(unit, radius, cx, cy, cr) {
  const dx = unit.x - cx;
  const dy = unit.y - cy;
  const dist = Math.hypot(dx, dy);
  const minDist = radius + cr;

  if (dist === 0 || dist >= minDist) return null;

  const overlap = minDist - dist + 0.5; // Add 0.5px buffer to prevent edge-case jitter
  const nx = dist === 0 ? 1 : dx / dist;
  const ny = dist === 0 ? 0 : dy / dist;

  unit.x += nx * overlap;
  unit.y += ny * overlap;

  if (DEBUG_COLLISIONS) {
    const ux = canvas.width/2 + unit.x - camera.x;
    const uy = canvas.height/2 + unit.y - camera.y;
    drawCircleDebug(ux, uy, radius, "rgba(0,255,255,0.6)");
    drawCircleDebug(canvas.width/2 + cx - camera.x, canvas.height/2 + cy - camera.y, cr, "rgba(255,0,0,0.35)");
  }

  return { collided: true, nx, ny, cx, cy, r: cr };
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

  if (dist === 0 || dist >= radius) return null;

  const overlap = radius - dist + 1; // Add 1px buffer to prevent edge-case jitter
  const nx = dist === 0 ? 1 : dx / dist;
  const ny = dist === 0 ? 0 : dy / dist;

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

  const r = Math.max(BUILD_W, BUILD_H) / 2 + BUILD_COLLISION_PADDING;
  return { collided: true, nx, ny, cx: b.x, cy: b.y, r };
}

// Collision probe that does not mutate positions
function collidesAt(u, x, y, radius) {
  // trees (circle)
  for (const t of trees) {
    const dx = x - t.x;
    const dy = y - (t.y - 150);
    const minDist = radius + TREE_RADIUS;
    if ((dx*dx + dy*dy) < minDist * minDist) return true;
  }

  // buildings (rect with padding)
  for (const b of buildings) {
    const left   = b.x - BUILD_W / 2 - BUILD_COLLISION_PADDING;
    const right  = b.x + BUILD_W / 2 + BUILD_COLLISION_PADDING;
    const top    = b.y - BUILD_H / 2 - BUILD_COLLISION_PADDING;
    const bottom = b.y + BUILD_H / 2 + BUILD_COLLISION_PADDING;
    const closestX = Math.max(left, Math.min(x, right));
    const closestY = Math.max(top, Math.min(y, bottom));
    const dx = x - closestX;
    const dy = y - closestY;
    if ((dx*dx + dy*dy) < radius * radius) return true;
  }

  // collidable map tiles (rect)
  for (const o of mapObjects || []) {
    if (o.type !== "tile") continue;
    if (!o.meta || !o.meta.collides) continue;
    const w = o.meta.cw;
    const h = o.meta.ch;
    const cx = o.x + (o.meta.cx || 0);
    const cy = o.y + (o.meta.cy || 0);
    const left   = cx - w / 2;
    const right  = cx + w / 2;
    const top    = cy - h / 2;
    const bottom = cy + h / 2;
    const closestX = Math.max(left, Math.min(x, right));
    const closestY = Math.max(top, Math.min(y, bottom));
    const dx = x - closestX;
    const dy = y - closestY;
    if ((dx*dx + dy*dy) < radius * radius) return true;
  }

  // enemy units
  for (const sid in players) {
    if (sid === mySid) continue;
    for (const opUnit of players[sid].units || []) {
      const dx = x - opUnit.x;
      const dy = y - opUnit.y;
      const minDist = radius + UNIT_RADIUS;
      if ((dx*dx + dy*dy) < minDist * minDist) return true;
    }
  }

  return false;
}

function trySteerMove(u, dx, dy, maxStep) {
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return false;
  const baseX = dx / dist;
  const baseY = dy / dist;
  const step = Math.min(maxStep, dist);
  const angles = [0, 20, -20, 35, -35, 55, -55, 75, -75];
  const stepScales = [1, 0.65, 0.4]; // try shorter steps to avoid penetrating obstacles

  for (const s of stepScales) {
    const effStep = step * s;
    for (const a of angles) {
      const rad = a * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const nx = baseX * cos - baseY * sin;
      const ny = baseX * sin + baseY * cos;
      const newX = u.x + nx * effStep;
      const newY = u.y + ny * effStep;
      if (!collidesAt(u, newX, newY, PLAYER_RADIUS)) {
        u.x = newX;
        u.y = newY;
        u.anim = "walk";
        u.dir = getDirKey(nx, ny);
        return true;
      }
    }
  }
  return false;
}

function applyCollisions(u, nowTs) {
  const prevX = (typeof u.lastX === 'number') ? u.lastX : u.x;
  const prevY = (typeof u.lastY === 'number') ? u.lastY : u.y;
  const mvx = u.x - prevX;
  const mvy = u.y - prevY;
  let firstHit = null;

  const record = (res) => {
    if (res && !firstHit) firstHit = res;
  };

  for (const t of trees) record(resolveCircleCircle(u, PLAYER_RADIUS, t.x, t.y - 150, TREE_RADIUS));
  // Resources are non-colliding to avoid blocking paths
  for (const b of buildings) record(resolveCircleBuilding(u, PLAYER_RADIUS, b));

  for (const o of mapObjects) {
    if (o.type !== "tile") continue;
    if (!o.meta || !o.meta.collides) continue;
    const cx = o.x + (o.meta.cx || 0);
    const cy = o.y + (o.meta.cy || 0);
    record(resolveCircleRect(u, PLAYER_RADIUS, { x: cx, y: cy, w: o.meta.cw, h: o.meta.ch }));
  }

  // Skip collisions against friendly units to prevent bumping
  // (enemy units are still resolved below)

  for (const sid in players) {
    if (sid === mySid) continue;
    for (const opUnit of players[sid].units) {
      record(resolveCircleCircle(u, PLAYER_RADIUS, opUnit.x, opUnit.y, UNIT_RADIUS));
    }
  }

  // Track stuck state
  const moveSpeed = Math.hypot(mvx, mvy);
  if (moveSpeed < 0.5) {
    u._stuckCounter = (u._stuckCounter || 0) + 1;
  } else {
    u._stuckCounter = 0;
  }

  // Emergency unstick: if stuck for too long, teleport away from obstacle
  if (u._stuckCounter > 30 && firstHit) {
    const awayX = u.x - (firstHit.cx || u.x);
    const awayY = u.y - (firstHit.cy || u.y);
    const awayLen = Math.hypot(awayX, awayY);
    if (awayLen > 0.1) {
      u.x += (awayX / awayLen) * 20;
      u.y += (awayY / awayLen) * 20;
      u._stuckCounter = 0;
      u._detour = null;
      return;
    }
  }

  if (firstHit) {
    // revert to previous position and set a detour around the obstacle center
    u.x = prevX;
    u.y = prevY;

    // Nudge slightly outward along collision normal so we don't remain embedded
    if (typeof firstHit.nx === 'number' && typeof firstHit.ny === 'number') {
      u.x += firstHit.nx * 3; // Increased from 2 to 3 for more separation
      u.y += firstHit.ny * 3;
    }

    // Stop movement for this frame to prevent jitter
    u.lastX = u.x;
    u.lastY = u.y;

    const toCenterX = (firstHit.cx ?? u.x) - prevX;
    const toCenterY = (firstHit.cy ?? u.y) - prevY;
    const toTargetX = (typeof u.tx === 'number') ? (u.tx - prevX) : 0;
    const toTargetY = (typeof u.ty === 'number') ? (u.ty - prevY) : 0;
    const isStuck = Math.hypot(mvx, mvy) < 0.01;
    // Stable side choice per obstacle to avoid ping-ponging
    const obsKey = `${Math.round(firstHit.cx || 0)}:${Math.round(firstHit.cy || 0)}`;
    u._detourSides = u._detourSides || {};

    const chooseSide = () => {
      const tLen = Math.hypot(toTargetX, toTargetY);
      const cLen = Math.hypot(toCenterX, toCenterY);
      if (tLen > 0.001 && cLen > 0.001) {
        const tx = toTargetX / tLen;
        const ty = toTargetY / tLen;
        const leftX = -toCenterY;
        const leftY =  toCenterX;
        const rightX = -leftX;
        const rightY = -leftY;
        const leftDot = (leftX * tx + leftY * ty) / Math.hypot(leftX, leftY);
        const rightDot = (rightX * tx + rightY * ty) / Math.hypot(rightX, rightY);
        return leftDot >= rightDot ? 1 : -1; // 1 => left tangent, -1 => right tangent
      }
      const cross = mvx * toCenterY - mvy * toCenterX;
      return cross === 0 ? 1 : Math.sign(cross);
    };

    let side = u._detourSides[obsKey]?.side ?? chooseSide();
    u._detourSides[obsKey] = { side, ts: nowTs || performance.now() };

    let px = -toCenterY * side;
    let py =  toCenterX * side;
    if (isStuck && (toTargetX || toTargetY)) {
      // When stalled, bias toward target while keeping chosen side
      px = px * 0.7 + toTargetX * 0.3;
      py = py * 0.7 + toTargetY * 0.3;
    }
    const mag = Math.hypot(px, py);
    if (mag < 0.001) {
      const seed = (u.id ? u.id.length : 1) + (firstHit.cx || 0);
      px = (Math.sin(seed) || 1);
      py = (Math.cos(seed) || 0);
    } else {
      px /= mag;
      py /= mag;
    }
    const obstacleSize = Math.max(30, (firstHit.r || PLAYER_RADIUS * 2));
    const baseDetour = isStuck ? (obstacleSize * 0.6 + 28) : (obstacleSize + PLAYER_RADIUS + 16);
    const detourDist = (u._detour && u._detour.cx === firstHit.cx && u._detour.cy === firstHit.cy)
      ? baseDetour * (isStuck ? 1.1 : 1.3)
      : baseDetour;
    const expires = (nowTs || performance.now()) + (isStuck ? 600 : 800);
    u._detour = { x: prevX + px * detourDist, y: prevY + py * detourDist, expires, side, cx: firstHit.cx, cy: firstHit.cy };

    // smaller nudge toward detour to avoid immediate re-collision
    u.x += px * Math.min(3, detourDist * 0.04);
    u.y += py * Math.min(3, detourDist * 0.04);
  }
}

function update(){
    if (!mySid) return;
    if (!myUnits || myUnits.length === 0) return; // wait for server state

  const now = performance.now();
  const dtMs = now - lastUpdateTime;
  const dtScale = Math.min(3, dtMs / FRAME_TIME);
  lastUpdateTime = now;

    // --- CAMERA ---
  if(keys.w) camera.y -= camSpeed * dtScale;
  if(keys.s) camera.y += camSpeed * dtScale;
  if(keys.a) camera.x -= camSpeed * dtScale;
  if(keys.d) camera.x += camSpeed * dtScale;


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

        // Keep derived stats (maxHp/dps) in sync client-side
        const stats = getUnitStats(u);
        if (stats) {
          u.maxHp = stats.maxHp;
          if (typeof u.hp === "number") {
            u.hp = Math.min(u.hp, u.maxHp);
          }
        }

        // Detour handling (set when colliding)
        if (u._detour) {
          if (now > (u._detour.expires || 0)) {
            delete u._detour;
          } else {
            const dx = u._detour.x - u.x;
            const dy = u._detour.y - u.y;
            const dist = Math.hypot(dx, dy);
            // Clear detour if we've reached it or if we have a new target that's clear
            if (dist < 3) {
              delete u._detour;
            } else if (u.tx && u.ty) {
              // Check if we can go straight to target now
              const toTargetX = u.tx - u.x;
              const toTargetY = u.ty - u.y;
              const targetDist = Math.hypot(toTargetX, toTargetY);
              const targetDir = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY);
              if (targetDist > 10 && targetDir > 0) {
                const probeX = u.x + (toTargetX / targetDir) * 10;
                const probeY = u.y + (toTargetY / targetDir) * 10;
                if (!collidesAt(u, probeX, probeY, PLAYER_RADIUS)) {
                  delete u._detour;
                }
              }
            }
            
            if (u._detour && dist > 1.5) {
              const speed = 4.5 * dtScale;
              u.x += (dx / dist) * Math.min(speed, dist);
              u.y += (dy / dist) * Math.min(speed, dist);
              u.anim = "walk";
              u.dir = getDirKey(dx, dy);
              applyCollisions(u, now);
              advanceLocalAnim(u, dtScale);
              u.lastX = u.x;
              u.lastY = u.y;
              continue;
            }
          }
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
          const speed = 4.5 * dtScale;
            const moved = trySteerMove(u, dx, dy, Math.min(speed, dist));
            if (!moved) {
              u.x += (dx / dist) * Math.min(speed, dist);
              u.y += (dy / dist) * Math.min(speed, dist);
              u.anim = "walk";
              u.dir = getDirKey(dx, dy);
            }
              applyCollisions(u, now);
      } else {
          u.x = targetX;
          u.y = targetY;
          u.manualMove = false;
          u.anim = "idle";
          // clear formation metadata once move completes
          delete u._formationIndex;
          delete u._formationTotal;
          
      }
        applyCollisions(u, now);
        advanceLocalAnim(u, dtScale);
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
      const speed = HARVEST_SPEED * dtScale;
      const moved = trySteerMove(u, dx, dy, Math.min(speed, dist));
      if (!moved) {
        u.x += (dx / dist) * Math.min(speed, dist);
        u.y += (dy / dist) * Math.min(speed, dist);
        u.anim = "walk";
        u.dir = getDirKey(dx, dy);
      }
      // moved away from resource: reset harvesting progress
      u.harvesting = null;
     
    } else {
      u.anim = "idle";
  

      // ✅ harvest check uses harvest radius
      if (dist <= RESOURCE_HARVEST_RADIUS) {
        if (!u.harvesting || u.harvesting.resourceId !== r.id) {
          u.harvesting = { resourceId: r.id, startTime: now };
        } else if (now - u.harvesting.startTime >= HARVEST_TIME) {
          // optimistically remove locally; server will broadcast authoritative list
          resources = resources.filter(rr => rr.id !== r.id);
          // local bookkeeping per-type
          const rtype = r.type || 'red';
          try { window.resourceCounts = window.resourceCounts || { red:0, green:0, blue:0 }; window.resourceCounts[rtype] = (window.resourceCounts[rtype]||0) + 1; } catch(e) {}
          // inform server of collected resource so server-side accounting is authoritative
          try { socket.emit("collect_resource", { amount: 1, type: rtype, resourceId: r.id, unitId: u.id }); } catch (e) {}
          u.harvesting = null;
          u.targetResource = null;
        }
      }
      }
    }
        // Resolve collisions after movement while harvesting
        applyCollisions(u, now);
        advanceLocalAnim(u, dtScale);
      u.lastX = u.x;
      u.lastY = u.y;
  continue;
}



        // --- Combat & auto-chase ---
        // --- Combat & auto-chase ---
if (!u.manualMove) {

  // validate current targetEnemy by unitId
  if (u.targetEnemy) {
    console.log('[COMBAT] Unit has targetEnemy:', u.targetEnemy.kind, u.targetEnemy.entityId || u.targetEnemy.unitId);
    if (u.targetEnemy.kind === 'unit') {
      const enemyPlayer = players[u.targetEnemy.sid];
      if (!enemyPlayer || !enemyPlayer.units || enemyPlayer.units.length === 0) {
        u.targetEnemy = null;
      } else {
        const enemyUnit = enemyPlayer.units.find(eu => eu.id === u.targetEnemy.unitId);
        if (!enemyUnit || (enemyUnit.hp ?? 0) <= 0) {
          u.targetEnemy = null;
        } else {
          // clear target if it's too far (left aggro)
          const dx = enemyUnit.x - u.x;
          const dy = enemyUnit.y - u.y;
          const dist = Math.hypot(dx, dy);
          if (dist > AGGRO_LOSE_RADIUS && !u.targetEnemy.userIssued) u.targetEnemy = null;
        }
      }
    } else if (u.targetEnemy.kind === 'entity') {
      const ent = (mapObjects || []).find(m => m.id === u.targetEnemy.entityId);
      if (ent) {
        console.log('[VALIDATION] Spider found:', ent.kind, 'Full object:', JSON.stringify({id: ent.id, hp: ent.hp, maxHp: ent.maxHp, owner: ent.owner, kind: ent.kind}));
      }
      console.log('[VALIDATION] Entity found:', !!ent, 'hp:', ent?.hp);
      if (!ent || (ent.hp ?? 0) <= 0) {
        console.log('[VALIDATION] Clearing targetEnemy - entity not found or dead');
        u.targetEnemy = null;
      } else {
        const dx = ent.x - u.x;
        const dy = ent.y - u.y;
        const dist = Math.hypot(dx, dy);

        // approximate entity radius
        const cw = (ent.meta && ent.meta.cw) ? ent.meta.cw : (ent.meta && ent.meta.w ? ent.meta.w : BUILD_W);
        const ch = (ent.meta && ent.meta.ch) ? ent.meta.ch : (ent.meta && ent.meta.h ? ent.meta.h : BUILD_H);
        const entRadius = Math.max(cw, ch) / 2;
        const effectiveDist = Math.max(0, dist - entRadius);
        console.log('[VALIDATION] effectiveDist:', effectiveDist, 'AGGRO_LOSE_RADIUS:', AGGRO_LOSE_RADIUS, 'userIssued:', u.targetEnemy.userIssued);
        if (effectiveDist > AGGRO_LOSE_RADIUS && !u.targetEnemy.userIssued) {
          console.log('[VALIDATION] Clearing targetEnemy - too far and not user issued');
          u.targetEnemy = null;
        }
      }
    }
  }

  // acquire target if none
  if (!u.targetEnemy) {
    const nearest = findNearestEnemy(u);
    if (nearest) {
      const dist = Math.hypot(u.x - nearest.x, u.y - nearest.y);
      if (dist <= AGGRO_RADIUS) u.targetEnemy = nearest;
    }
  }

  console.log('[COMBAT] After acquire, targetEnemy exists:', !!u.targetEnemy, u.targetEnemy?.kind);

  // engage target
    if (u.targetEnemy) {
      if (u.targetEnemy.kind === 'unit') {
        const enemyPlayer = players[u.targetEnemy.sid];
        const enemy = enemyPlayer?.units?.find(eu => eu.id === u.targetEnemy.unitId);

        if (!enemy || (enemy.hp ?? 0) <= 0) {
          u.targetEnemy = null;
        } else {
          const dx = enemy.x - u.x;
          const dy = enemy.y - u.y;
          const dist = Math.hypot(dx, dy);

          if (dist > UNIT_ATTACK_RANGE) {
            const moveSpeed = CHASE_SPEED * dtScale;
            const approach = Math.max(0, dist - UNIT_ATTACK_RANGE);
            const step = Math.min(moveSpeed, approach);
            if (step > 0) {
              const moved = trySteerMove(u, dx, dy, step);
              if (!moved) {
                u.x += (dx / dist) * step;
                u.y += (dy / dist) * step;
              }
            }
            u.anim = "walk";
            u.dir = getDirKey(dx, dy);
          } else {
            u.anim = "attack";
            if (u.attackCooldown >= ATTACK_COOLDOWN) {
              const dmgPerTick = ((stats?.dps ?? UNIT_ATTACK_DPS) / 60) * dtScale;
              socket.emit("attack_unit", {
                targetSid: u.targetEnemy.sid,
                unitId: u.targetEnemy.unitId,
                damage: dmgPerTick,
                attackerId: u.id
              });
              u.attackCooldown = 0;
            }
          }
        }
      } else if (u.targetEnemy.kind === 'entity') {
        console.log('[ENTITY_ATTACK] Starting entity attack, entityId:', u.targetEnemy.entityId);
        const ent = (mapObjects || []).find(m => m.id === u.targetEnemy.entityId);
        if (!ent) {
          console.log('[ENTITY_ATTACK] Entity not found in mapObjects:', u.targetEnemy.entityId);
          u.targetEnemy = null;
        } else if ((ent.hp ?? 0) <= 0) {
          console.log('[ENTITY_ATTACK] Entity dead:', ent.kind, ent.hp);
          u.targetEnemy = null;
        } else {
          // If an attackPoint was provided (from right-click), use it as approach target
          let targetX = ent.x;
          let targetY = ent.y;
          if (u.targetEnemy.attackPoint && typeof u.targetEnemy.attackPoint.x === 'number') {
            targetX = u.targetEnemy.attackPoint.x;
            targetY = u.targetEnemy.attackPoint.y;
          }

          const dx = targetX - u.x;
          const dy = targetY - u.y;
          const dist = Math.hypot(dx, dy) || 1;

          // compute entity collision radius (approx using meta collision or BUILD_W/BUILD_H)
          const cw = (ent.meta && ent.meta.cw) ? ent.meta.cw : (ent.meta && ent.meta.w ? ent.meta.w : BUILD_W);
          const ch = (ent.meta && ent.meta.ch) ? ent.meta.ch : (ent.meta && ent.meta.h ? ent.meta.h : BUILD_H);
          const entRadius = Math.max(cw, ch) / 2;

          // compute distance to entity CENTER for deciding attack (effective distance uses center)
          const dxCenter = ent.x - u.x;
          const dyCenter = ent.y - u.y;
          const distCenter = Math.hypot(dxCenter, dyCenter);
          const effectiveDist = Math.max(0, distCenter - entRadius);

          // If effective distance is greater than attack range, approach the attackPoint (or center). Otherwise attack.
          if (effectiveDist > UNIT_ATTACK_RANGE) {
            console.log('[ENTITY_ATTACK] Moving to entity:', ent.kind, 'dist:', effectiveDist.toFixed(1), 'attackRange:', UNIT_ATTACK_RANGE);
            const moveSpeed = CHASE_SPEED * dtScale;
            const approach = Math.max(0, effectiveDist - UNIT_ATTACK_RANGE);
            const step = Math.min(moveSpeed, approach);
            if (step > 0) {
              // move toward the entity center to reliably reduce effectiveDist
              const dxc = ent.x - u.x;
              const dyc = ent.y - u.y;
              const distc = Math.hypot(dxc, dyc) || 1;
              const moved = trySteerMove(u, dxc, dyc, step);
              if (!moved) {
                u.x += (dxc / distc) * step;
                u.y += (dyc / distc) * step;
              }
            }
            u.anim = "walk";
            u.dir = getDirKey(dx, dy);
          } else {
            console.log('[ENTITY_ATTACK] In range! Attacking:', ent.kind, 'hp:', ent.hp);
            u.anim = "attack";
            if (u.attackCooldown >= ATTACK_COOLDOWN) {
              const dmgPerTick = ((stats?.dps ?? UNIT_ATTACK_DPS) / 60) * dtScale;
              socket.emit("attack_entity", {
                entityId: u.targetEnemy.entityId,
                damage: dmgPerTick,
                attackerId: u.id
              });
              u.attackCooldown = 0;
            }
          }
        }
      }
    } else {
      if (u.anim !== "idle") u.anim = "idle";
    }
}

  // --- Cooldowns ---
  if (u.attackCooldown < ATTACK_COOLDOWN) u.attackCooldown += 16.66 * dtScale;

  // Resolve collisions after combat movement/auto-chase
  applyCollisions(u, now);

  // ✅ ALWAYS advance animation frames based on current anim
  advanceLocalAnim(u, dtScale);

u.lastX = u.x;
u.lastY = u.y;
    }

    // Note: collision debug rendering is handled in draw.js; avoid extra collision passes here


    // --- SEND STATE TO SERVER ---
const unitStates = myUnits.map(u => ({
    id: u.id,          // ⭐ REQUIRED
    x: u.x,
    y: u.y,
    tx: u.tx,
    ty: u.ty,
    anim: u.anim,
    dir: u.dir,
  hp: u.hp,
  maxHp: u.maxHp
}));
    socket.emit("update_units", { units: unitStates });
}

// Aggro radii (pixels)
const AGGRO_RADIUS = 200;      // enter aggro
const AGGRO_LOSE_RADIUS = 260; // leave aggro (hysteresis)
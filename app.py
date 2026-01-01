from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO
import random
import time
import uuid
import math
import json, os, time
from threading import Lock
from pathlib import Path

MAP_FILE = "map_objects.json"
map_lock = Lock()

# Background task guard to ensure mine loop starts exactly once
mine_loop_started = False
mine_loop_lock = Lock()

# NPC background task guard
npc_loop_started = False
npc_loop_lock = Lock()

# Cost constants
TOWN_CENTER_COST = 5

# Combat/stat tuning
BASE_UNIT_HP = 100
BASE_UNIT_DPS = 30
DPS_PER_ATTACK_POINT = 5   # sword grants +1 attack -> +5 DPS
HP_PER_DEFENSE_POINT = 15  # shield grants +1 defense -> +15 HP
TICKS_PER_SECOND = 60.0

GROUND_FILE = "ground_items.json"
ground_lock = Lock()

RES_FILE = "resources.json"
resources_lock = Lock()

# resources: list of {id, x, y, type}
resources = []

# Each object: {id, type, kind, x, y, owner, rot, meta}
map_objects = []

def load_map():
    global map_objects
    if os.path.exists(MAP_FILE):
        with open(MAP_FILE, "r", encoding="utf-8") as f:
            map_objects = json.load(f)
    else:
        map_objects = []
    
    # Spawn spiders if none exist
    spider_count = sum(1 for o in map_objects if o.get("kind") == "spider")
    if spider_count == 0:
        print("[INIT] Spawning spiders...", flush=True)
        spawn_spiders()
    
    # Reset nextTick for any mines that were loaded from file
    # (their old nextTick is likely in the past)
    now = time.time()
    for o in map_objects:
        if o.get("kind") == "mine" and o.get("meta"):
            m = o["meta"]
            # Normalize legacy mines so the production loop will process them
            if not m.get("entity"):
                m["entity"] = True
            mine_meta = m.setdefault("mine", {})
            mine_meta.setdefault("resource", "red")
            interval = int(m.get("interval", 30))
            m["interval"] = interval
            m["nextTick"] = now + interval
            print(f"[LOAD_MAP] Reset mine {o.get('id')} nextTick to {m['nextTick']} interval={interval}", flush=True)

        if o.get("kind") == "blacksmith":
            # Normalize blacksmiths to ensure they act as entities with HP and at least one item slot
            m = o.setdefault("meta", {})
            m["entity"] = True
            if "interval" in m:
                # legacy fields not used by blacksmith anymore
                m.pop("interval", None)
                m.pop("nextTick", None)
            slots = o.setdefault("itemSlots", [])
            if len(slots) == 0:
                slots.append(None)
    
    # Ensure entities that need HP bars have them set
    for o in map_objects:
        if o.get("meta", {}).get("entity"):
            # town_center, building, mine, blacksmith, and spider all need HP bars
            if o.get("kind") in ("town_center", "building", "mine", "blacksmith", "spider"):
                if o.get("hp") is None:
                    # default HP by kind
                    if o.get("kind") == "town_center":
                        o["hp"] = 500
                    elif o.get("kind") == "mine":
                        o["hp"] = 300
                    elif o.get("kind") == "blacksmith":
                        o["hp"] = 300
                    elif o.get("kind") == "spider":
                        o["hp"] = 50
                        o["maxHp"] = 50
                    else:
                        o["hp"] = 200
            else:
                # other entities are invulnerable by default
                if "hp" in o:
                    del o["hp"]

def load_ground():
    global ground_items
    if os.path.exists(GROUND_FILE):
        with open(GROUND_FILE, "r", encoding="utf-8") as f:
            ground_items[:] = json.load(f)
    else:
        ground_items.clear()


def load_resources():
    global resources
    if os.path.exists(RES_FILE):
        with open(RES_FILE, "r", encoding="utf-8") as f:
            resources = json.load(f)
    else:
        resources = []


def save_resources():
    tmp = RES_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(resources, f, ensure_ascii=False, indent=2)
    os.replace(tmp, RES_FILE)

def save_map():
    tmp = MAP_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(map_objects, f, ensure_ascii=False, indent=2)
    os.replace(tmp, MAP_FILE)

def spawn_spiders():
    """Spawn spiders around the map with health and waypoints."""
    
    def point_in_collision(x, y):
        """Check if a point is inside any entity's collision box."""
        for obj in map_objects:
            meta = obj.get("meta", {})
            
            # Skip if no collision enabled
            if not meta.get("collides"):
                continue
            
            # Get collision box dimensions
            obj_x = obj.get("x", 0)
            obj_y = obj.get("y", 0)
            cx = obj_x + meta.get("cx", 0)
            cy = obj_y + meta.get("cy", 0)
            cw = meta.get("cw", 0)
            ch = meta.get("ch", 0)
            
            # Skip if collision box has no size
            if cw <= 0 or ch <= 0:
                continue
            
            # Check if point is inside collision box (with padding)
            padding = 80  # Extra space around collision
            half_w = cw / 2 + padding
            half_h = ch / 2 + padding
            
            if abs(x - cx) < half_w and abs(y - cy) < half_h:
                return True
        return False
    
    def generate_valid_waypoint(center_x, center_y, min_radius, max_radius, max_attempts=50):
        """Generate a waypoint that doesn't collide with entities."""
        for attempt in range(max_attempts):
            angle = random.random() * math.pi * 2
            radius = random.randint(min_radius, max_radius)
            x = center_x + math.cos(angle) * radius
            y = center_y + math.sin(angle) * radius
            
            if not point_in_collision(x, y):
                return {"x": x, "y": y}
        
        # Fallback: try wider radius
        for attempt in range(20):
            angle = random.random() * math.pi * 2
            radius = random.randint(max_radius, max_radius + 200)
            x = center_x + math.cos(angle) * radius
            y = center_y + math.sin(angle) * radius
            
            if not point_in_collision(x, y):
                return {"x": x, "y": y}
        
        # Last resort: return position far from center
        print(f"[SPIDER] Warning: Could not find collision-free waypoint after {max_attempts + 20} attempts", flush=True)
        return {"x": center_x + random.randint(-500, 500), "y": center_y + random.randint(-500, 500)}
    
    # Match resource grid area: 69 cols x 53 rows x 180 spacing
    # Resources span from roughly -6200 to +6200 in x, -4770 to +4770 in y
    spider_count = 100
    print(f"[SPIDER] Spawning {spider_count} spiders, checking collisions with {len(map_objects)} entities", flush=True)
    
    for i in range(spider_count):
        # Spawn randomly within resource area
        center_x = random.randint(-6000, 6000)
        center_y = random.randint(-4500, 4500)
        
        # Create waypoints in a random walk pattern, avoiding collisions
        waypoints = []
        wp_count = random.randint(3, 6)
        for j in range(wp_count):
            wp = generate_valid_waypoint(center_x, center_y, 150, 400)
            waypoints.append(wp)
            print(f"[SPIDER] Spider {i+1} waypoint {j+1}: ({wp['x']:.1f}, {wp['y']:.1f})", flush=True)
        
        spider = {
            "id": str(uuid.uuid4()),
            "type": "tile",
            "kind": "spider",
            "x": waypoints[0]["x"],
            "y": waypoints[0]["y"],
            "owner": None,  # Hostile entity with no owner
            "hp": 50,
            "maxHp": 50,
            "meta": {
                "title": f"Spider {i + 1}",
                "w": 100,
                "h": 100,
                "waypoints": waypoints,
                "currentWaypointIndex": 0,
                "anim": "walk",
                "dir": "000",
                "z": 0,
                "entity": True
            }
        }
        map_objects.append(spider)
        print(f"[SPIDER] Created spider {i+1} with hp={spider.get('hp')}, owner={spider.get('owner')}", flush=True)
    
    save_map()
    print(f"[INIT] Spawned {spider_count} spiders", flush=True)

def save_ground():
    tmp = GROUND_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(ground_items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, GROUND_FILE)


def ensure_mine_loop_started():
    """Start the mine production loop exactly once across any run mode."""
    global mine_loop_started
    with mine_loop_lock:
        if mine_loop_started:
            return
        socketio.start_background_task(mine_production_loop)
        mine_loop_started = True
        print("[MINE_LOOP] Background task started", flush=True)

def ensure_npc_loop_started():
    """Start the NPC movement loop exactly once."""
    global npc_loop_started
    with npc_loop_lock:
        if npc_loop_started:
            return
        socketio.start_background_task(npc_movement_loop)
        npc_loop_started = True
        print("[NPC_LOOP] Background task started", flush=True)

load_map()
load_resources()


app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# State


players = {}     # player_id -> {x, y, color, units, resources}
buildings = []   # list of {x, y, owner}
sid_to_player = {}  # active socket sid -> player_id
player_to_sid = {}  # player_id -> last seen sid

ground_items = []  # [{id, name, x, y}]
PICKUP_DISTANCE = 120

load_ground()

def find_unit(player_id, unit_id):
    p = players.get(player_id)
    if not p:
        return None
    for u in p.get("units", []):
        if u.get("id") == unit_id:
            return u
    return None

def dist_xy(x1, y1, x2, y2):
    return math.hypot(x1 - x2, y1 - y2)

def make_default_slots():
    return [
        {"id": str(uuid.uuid4()), "name": "sword"},
        {"id": str(uuid.uuid4()), "name": "shield"},
        None,
        None,
        None
    ]


def compute_unit_stats(u):
    slots = u.get("itemSlots") or []
    attack_pts = 0
    defense_pts = 0

    for s in slots:
        if not s or not isinstance(s, dict):
            continue
        name = s.get("name", "").lower()
        bonus = 0
        try:
            bonus = int(s.get("bonus", 0))
        except Exception:
            bonus = 0
        bonus = max(0, bonus)
        if name == "sword":
            attack_pts += 1 + bonus
        elif name == "shield":
            defense_pts += 1 + bonus

    max_hp = BASE_UNIT_HP + defense_pts * HP_PER_DEFENSE_POINT
    dps = BASE_UNIT_DPS + attack_pts * DPS_PER_ATTACK_POINT

    return {
        "attack": attack_pts,
        "defense": defense_pts,
        "max_hp": max_hp,
        "dps": dps
    }


def current_player_id():
    return sid_to_player.get(request.sid)


def current_player():
    pid = current_player_id()
    return pid, players.get(pid)


def require_player_id():
    pid = current_player_id()
    if not pid:
        socketio.emit("login_error", {"msg": "Login required"}, to=request.sid)
    return pid


def apply_unit_stats(u, owner_sid=None, broadcast_hp=False):
    """Recompute derived stats (maxHp/dps) from items and optionally broadcast HP."""
    stats = compute_unit_stats(u)

    old_max = float(u.get("maxHp", BASE_UNIT_HP))
    old_hp = float(u.get("hp", BASE_UNIT_HP))

    u["attackStat"] = stats["attack"]
    u["defenseStat"] = stats["defense"]
    u["maxHp"] = stats["max_hp"]
    u["dps"] = stats["dps"]

    # If max HP increased, grant the difference (up to new max). If decreased, clamp.
    if stats["max_hp"] > old_max:
        new_hp = min(stats["max_hp"], old_hp + (stats["max_hp"] - old_max))
    else:
        new_hp = min(old_hp, stats["max_hp"])

    u["hp"] = new_hp

    if broadcast_hp and owner_sid and u.get("id"):
        target_sid = player_to_sid.get(owner_sid, owner_sid)
        socketio.emit("unit_hp_update", {
            "sid": owner_sid,
            "unitId": u["id"],
            "hp": u["hp"],
            "maxHp": u["maxHp"]
        }, to=target_sid)

    return u

# Add global state for trees
trees = []

# Function to generate a random tree
def generate_tree():
    return {"x": random.randint(-8000, 8000), "y": random.randint(-8000, 8000)}

# Function to generate n trees
def generate_trees(n=50):
    global trees
    for _ in range(n):
        trees.append(generate_tree())

# Emit trees to a client
def emit_trees(sid=None):
    if sid:
        socketio.emit("server_trees", trees, to=sid)
    else:
        socketio.emit("server_trees", trees)


def broadcast_state():
    while True:
        socketio.sleep(1/20)  # 20 updates/sec
        state = {
            "players": players,
            "buildings": buildings,
            "trees": trees
        }
        socketio.emit("state", state)

#socketio.start_background_task(broadcast_state)


def random_color():
    return "#" + "".join(random.choices("0123456789ABCDEF", k=6))

# Serve files
@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/static/<path:path>")
def send_static(path):
    return send_from_directory("static", path)

# Helper to emit current state
def emit_state(to_sid=None):
    state = {
        "players": players,
        "buildings": buildings,
        "trees": trees,
        "ground_items": ground_items,
        "map_objects": map_objects,
        "resources": resources
    }
    if to_sid:
        socketio.emit("state", state, to=to_sid)
    else:
        socketio.emit("state", state)






# Socket events

@app.route("/tiles_manifest")
def tiles_manifest():
    """
    Returns available tile images from /static/tiles as:
    { "tiles": ["building2", "tree", ...] }
    """
    tiles_dir = Path(app.root_path) / "static" / "tiles"
    tiles = []

    if tiles_dir.exists():
        for name in os.listdir(tiles_dir):
            # keep only images you want
            if name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                stem = Path(name).stem  # "tree.png" -> "tree"
                tiles.append(stem)

    tiles.sort()
    return {"tiles": tiles}


@socketio.on("request_map")
def on_request_map():
    sid = request.sid
    socketio.emit("map_objects", map_objects, to=sid)


@socketio.on("place_map_object")
def place_map_object(data):
    pid = require_player_id()
    if not pid:
        return
    # Server-side validation: require resources for town_center placement
    kind = data.get("kind")
    if kind == "town_center":
        player = players.get(pid)
        # check red resource by default
        if not player or player.get("resources", {}).get("red", 0) < TOWN_CENTER_COST:
            socketio.emit("server_debug", {"msg": f"Not enough red resources to build Town Center (requires {TOWN_CENTER_COST})"}, to=request.sid)
            return
        # deduct cost from red resource
        player.setdefault("resources", {"red":0,"green":0,"blue":0})
        player["resources"]["red"] = max(0, player["resources"].get("red", 0) - TOWN_CENTER_COST)
    
    if kind == "mine":
        player = players.get(pid)
        mine_cost = 3
        # check blue resource
        if not player or player.get("resources", {}).get("blue", 0) < mine_cost:
            socketio.emit("server_debug", {"msg": f"Not enough blue resources to build Mine (requires {mine_cost})"}, to=request.sid)
            return
        # deduct cost from blue resource
        player.setdefault("resources", {"red":0,"green":0,"blue":0})
        player["resources"]["blue"] = max(0, player["resources"].get("blue", 0) - mine_cost)
        
        # Ensure player exists in players dict for mine production to work
        # Must include units array so client doesn't delete them for having no units
        if pid not in players:
            print(f"[MINE_PLACE] Creating player entry for {pid[:8]} (placing mine)", flush=True)
            players[pid] = {
                "resources": {"red": 0, "green": 0, "blue": 0},
                "units": [],
                "x": 0,
                "y": 0,
                "color": "#fff"
            }

    if kind == "blacksmith":
        player = players.get(pid)
        smith_cost = 3
        # check red resource
        if not player or player.get("resources", {}).get("red", 0) < smith_cost:
            socketio.emit("server_debug", {"msg": f"Not enough red resources to build Blacksmith (requires {smith_cost})"}, to=request.sid)
            return
        player.setdefault("resources", {"red":0,"green":0,"blue":0})
        player["resources"]["red"] = max(0, player["resources"].get("red", 0) - smith_cost)

    with map_lock:
        obj = {
            "id": data.get("id") or str(uuid.uuid4()),
            "type": data.get("type"),
            "kind": data.get("kind"),
            "x": float(data.get("x", 0)),
            "y": float(data.get("y", 0)),
            "meta": data.get("meta") or {},
            # owner: prefer client-provided, otherwise server-assign to the creator
            # Spiders are hostile (no owner) so they can be attacked by all players
            "owner": None if data.get("kind") == "spider" else (data.get("owner") or pid),
            # optional itemSlots for persistent entity items
            "itemSlots": data.get("itemSlots") or []
        }
        # Normalize collision offsets so they persist even if missing
        m = obj["meta"]
        if m is not None:
            if "cx" not in m: m["cx"] = 0
            if "cy" not in m: m["cy"] = 0
        # Initialize mine production meta
        if obj.get("kind") == "mine":
            m = obj.setdefault("meta", {})
            m["entity"] = True  # Mark as entity so production loop processes it
            mine_meta = m.setdefault("mine", {})
            mine_meta.setdefault("resource", "red")
            m.setdefault("interval", 30)
            m.setdefault("nextTick", time.time() + int(m.get("interval", 30)))
        if obj.get("kind") == "blacksmith":
            m = obj.setdefault("meta", {})
            m["entity"] = True
            # ensure legacy timer fields are not set
            m.pop("interval", None)
            m.pop("nextTick", None)
            if not obj.get("itemSlots"):
                obj["itemSlots"] = [None]
        # If this is a building entity, ensure it has HP; other entities are invulnerable by default
        if obj.get("meta", {}).get("entity") and (obj.get("type") == "building" or obj.get("kind") in ["town_center", "mine", "blacksmith", "spider"]):
            if data.get("hp") is not None:
                obj["hp"] = float(data.get("hp"))
            else:
                if obj.get("kind") == "town_center":
                    obj["hp"] = 500
                elif obj.get("kind") == "mine":
                    obj["hp"] = 300
                elif obj.get("kind") == "blacksmith":
                    obj["hp"] = 300
                elif obj.get("kind") == "spider":
                    # Promote meta.hp to top level if present
                    obj["hp"] = float(obj.get("meta", {}).get("hp", 50))
                    obj["maxHp"] = float(obj.get("meta", {}).get("maxHp", 50))
                else:
                    obj["hp"] = 200
        map_objects.append(obj)
        save_map()

    # broadcast map and full state (so resources update on clients)
    socketio.emit("map_objects", map_objects)
    emit_state()

@socketio.on("update_map_object")
def update_map_object(data):
    oid = data.get("id")
    meta = data.get("meta") or {}
    itemSlots = data.get("itemSlots")
    pid = require_player_id()
    if not pid:
        return

    print(f"[UPDATE_MAP_OBJECT] id={oid}, meta keys={list(meta.keys())}, itemSlots={itemSlots is not None}", flush=True)

    with map_lock:
        changed = False
        for o in map_objects:
            if o.get("id") == oid:
                print(f"[UPDATE_MAP_OBJECT] Found object, type={o.get('type')}, kind={o.get('kind')}", flush=True)
                # Only the owner may change a mine's resource type
                try:
                    new_mine_resource = meta.get("mine", {}).get("resource")
                except Exception:
                    new_mine_resource = None
                if new_mine_resource is not None and o.get("kind") == "mine" and o.get("owner") and o.get("owner") != pid:
                    socketio.emit("server_debug", {"msg": "update_map_object: only the owner can change mine resource"}, to=request.sid)
                    break
                o["meta"] = {**(o.get("meta") or {}), **meta}  # merge
                print(f"[UPDATE_MAP_OBJECT] Meta after merge: {o['meta']}", flush=True)
                # update persistent itemSlots if provided
                if itemSlots is not None:
                    o["itemSlots"] = itemSlots
                # update position if provided
                if data.get("x") is not None:
                    o["x"] = float(data.get("x"))
                if data.get("y") is not None:
                    o["y"] = float(data.get("y"))
                # keep hp if provided, but only for building-type entities or town_center kind
                if data.get("hp") is not None and (o.get("type") == "building" or o.get("kind") == "town_center"):
                    try:
                        o["hp"] = float(data.get("hp"))
                    except Exception:
                        pass
                changed = True
                break
        if changed:
            print(f"[UPDATE_MAP_OBJECT] Saving map", flush=True)
            save_map()
        else:
            print(f"[UPDATE_MAP_OBJECT] No object found with id={oid}", flush=True)

    socketio.emit("map_objects", map_objects)


@socketio.on("delete_map_object")
def delete_map_object(data):
    oid = data.get("id")

    with map_lock:
        before = len(map_objects)
        # mutate in-place to avoid any weird reference issues
        map_objects[:] = [o for o in map_objects if o.get("id") != oid]
        if len(map_objects) != before:
            save_map()

    socketio.emit("map_objects", map_objects)


@socketio.on("delete_ground_item")
def delete_ground_item(data):
    gid = data.get("id")
    if not gid:
        return

    global ground_items
    with ground_lock:
        before = len(ground_items)
        ground_items[:] = [g for g in ground_items if g.get("id") != gid]
        if len(ground_items) != before:
            save_ground()

    socketio.emit("ground_items", ground_items)

@socketio.on("connect")
def on_connect():
    sid = request.sid
    ensure_mine_loop_started()
    ensure_npc_loop_started()
    socketio.emit("login_required", {}, to=sid)


@socketio.on("login")
def on_login(data):
    sid = request.sid
    ensure_mine_loop_started()
    ensure_npc_loop_started()
    username = str((data or {}).get("username", "")).strip()
    if not username:
        socketio.emit("login_error", {"msg": "Username required"}, to=sid)
        return
    username = username[:32]

    sid_to_player[sid] = username
    player_to_sid[username] = sid

    if username not in players:
        players[username] = {
            "x": 0,
            "y": 0,
            "color": random_color(),
            "units": [{
                "id": str(uuid.uuid4()),
                "x": 0, "y": 0,
                "tx": 0, "ty": 0,
                "hp": BASE_UNIT_HP,
                "anim": "idle",
                "dir": "000",
                "itemSlots": make_default_slots()
            }],
            "resources": {"red": 0, "green": 0, "blue": 0}
        }
        apply_unit_stats(players[username]["units"][0], owner_sid=username, broadcast_hp=False)
    else:
        # ensure legacy records have required fields
        p = players[username]
        p.setdefault("resources", {"red": 0, "green": 0, "blue": 0})
        p.setdefault("units", [])
        if not p["units"]:
            p["units"].append({
                "id": str(uuid.uuid4()),
                "x": 0, "y": 0,
                "tx": 0, "ty": 0,
                "hp": BASE_UNIT_HP,
                "anim": "idle",
                "dir": "000",
                "itemSlots": make_default_slots()
            })
            apply_unit_stats(p["units"][0], owner_sid=username, broadcast_hp=False)

    if not trees:
        generate_trees(100)

    if not resources:
        cols = 69
        rows = 53
        spacing = 180
        colOffset = cols // 2
        rowOffset = rows // 2
        nextId = 0
        for r in range(rows):
            for c in range(cols):
                if random.random() < 0.6:
                    types = ["red", "green", "blue"]
                    t = random.choice(types)
                    cc = c - colOffset
                    rr = r - rowOffset
                    resources.append({
                        "id": nextId,
                        "x": float((cc - rr) * spacing),
                        "y": float((cc + rr) * spacing / 2),
                        "type": t
                    })
                    nextId += 1
        with resources_lock:
            save_resources()

    socketio.emit("login_success", {"playerId": username}, to=sid)
    emit_state(to_sid=sid)
    emit_trees(sid)
    socketio.emit("map_objects", map_objects, to=sid)
    emit_state()



@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    pid = sid_to_player.pop(sid, None)
    if pid:
        player_to_sid.pop(pid, None)
    emit_state()


@socketio.on("update")
def on_update(data):
    pid = current_player_id()
    if pid and pid in players:
        players[pid]["x"] = data.get("x", players[pid]["x"])
        players[pid]["y"] = data.get("y", players[pid]["y"])
    emit_state()

@socketio.on("spawn_unit")
def spawn_unit(data):
    pid = require_player_id()
    if not pid or pid not in players:
        return

    unit = data.get("unit", {})

    new_unit = {
        # ✅ keep client id if provided
        "id": unit.get("id") or str(uuid.uuid4()),
        "x": unit.get("x", 0),
        "y": unit.get("y", 0),
        "tx": unit.get("tx", unit.get("x", 0)),
        "ty": unit.get("ty", unit.get("y", 0)),
        "hp": unit.get("hp", BASE_UNIT_HP),
        "anim": unit.get("anim", "idle"),
        "dir": unit.get("dir", "000"),
        "itemSlots": make_default_slots()
    }

    apply_unit_stats(new_unit, owner_sid=pid, broadcast_hp=False)

    players[pid]["units"].append(new_unit)
    socketio.emit("update_units", {"sid": pid, "units": players[pid]["units"]})


@socketio.on("spawn_unit_from_entity")
def spawn_unit_from_entity(data):
    pid = require_player_id()
    if not pid:
        return
    entity_id = data.get("entityId")
    if not entity_id:
        return

    # find entity
    with map_lock:
        ent = next((m for m in map_objects if m.get("id") == entity_id), None)
        if not ent:
            return

        # Only allow town_center to spawn units
        kind = ent.get("kind")
        if kind != "town_center":
            return

        # Only allow owner of the town_center to spawn units
        owner = ent.get("owner")
        if owner != pid:
            print(f"[spawn_unit_from_entity] unauthorized: player={pid} owner={owner} entity={entity_id}", flush=True)
            socketio.emit("server_debug", {"msg": "spawn_unit_from_entity: you do not own that town center"}, to=request.sid)
            return

        # Check resource cost: each unit costs 1 green resource
        p = players.get(pid)
        if not p:
            return
        p.setdefault("resources", {"red":0, "green":0, "blue":0})
        if p["resources"].get("green", 0) < 1:
            socketio.emit("server_debug", {"msg": "Not enough green resources to spawn a unit (cost: 1 green)"}, to=request.sid)
            return

        # spawn position: offset from entity
        ex = float(ent.get("x", 0))
        ey = float(ent.get("y", 0))

    # Create unit for requesting player
    p = players.get(pid)
    if not p:
        return

    # Enforce population limit: include existing units owned by the player
    POP_LIMIT = 10
    # count town centers owned by this owner (should be >=1)
    owned_centers = 0
    with map_lock:
        for o in map_objects:
            if o.get("kind") == "town_center" and o.get("owner") == pid:
                owned_centers += 1

    cap = max(POP_LIMIT, POP_LIMIT * owned_centers)
    # count only alive units
    owner_units_count = 0
    for uu in players.get(pid, {}).get("units", []):
        if (uu.get("hp") or 0) > 0:
            owner_units_count += 1

    print(f"[spawn_unit_from_entity] owner={pid} owned_centers={owned_centers} alive_units={owner_units_count} cap={cap}", flush=True)
    socketio.emit("server_debug", {"msg": f"spawn attempt: owned_centers={owned_centers} alive_units={owner_units_count} cap={cap}"}, to=request.sid)

    if owner_units_count >= cap:
        print(f"[spawn_unit_from_entity] owner {pid} unit count {owner_units_count} >= cap {cap}", flush=True)
        socketio.emit("server_debug", {"msg": f"spawn_unit_from_entity: population cap reached ({owner_units_count}/{cap})"}, to=request.sid)
        return

    # generate spawn offset to avoid stacking
    ox = random.randint(-60, 60)
    oy = random.randint(-40, 40)

    new_unit = {
        "id": str(uuid.uuid4()),
        "x": ex + ox,
        "y": ey + oy,
        "tx": ex + ox,
        "ty": ey + oy,
        "hp": BASE_UNIT_HP,
        "anim": "idle",
        "dir": "000",
        "itemSlots": make_default_slots(),
        "spawnedFrom": entity_id
    }

    apply_unit_stats(new_unit, owner_sid=pid, broadcast_hp=False)

    # Deduct green resource cost (server-authoritative)
    try:
        p["resources"]["green"] = max(0, int(p["resources"].get("green", 0)) - 1)
    except Exception:
        p["resources"]["green"] = p["resources"].get("green", 0) - 1

    p.setdefault("units", []).append(new_unit)

    # notify owner and all clients
    socketio.emit("update_units", {"sid": pid, "units": p["units"]})
    emit_state()


@socketio.on("drop_item")
def on_drop_item(data):
    global ground_items
    pid = require_player_id()
    if not pid:
        return
    unit_id = data.get("unitId")
    slot_index = data.get("slotIndex")
    x = data.get("x")
    y = data.get("y")

    if unit_id is None or slot_index is None or x is None or y is None:
        return

    u = find_unit(pid, unit_id)
    if not u:
        return

    slots = u.get("itemSlots") or [None, None, None, None, None]
    if not (0 <= int(slot_index) < len(slots)):
        return

    slot_index = int(slot_index)
    item = slots[slot_index]
    if not item:
        return

    # remove item from unit
    slots[slot_index] = None
    u["itemSlots"] = slots

    # Recompute stats after unequip
    apply_unit_stats(u, owner_sid=pid, broadcast_hp=True)

    # create ground item
    gi = {
        "id": str(uuid.uuid4()),
        "name": item.get("name", "item"),
        "bonus": item.get("bonus", 0),
        "x": float(x),
        "y": float(y)
    }
    ground_items.append(gi)

    # everyone sees it
    socketio.emit("ground_items", ground_items)

    # persist ground items
    with ground_lock:
        save_ground()

    # only the owner needs equipment UI refresh
    socketio.emit("unit_slots_update", {"unitId": unit_id, "itemSlots": slots}, to=request.sid)


@socketio.on("pickup_item")
def on_pickup_item(data):
    pid = require_player_id()
    if not pid:
        return

    unit_id = data.get("unitId")
    slot_index = data.get("slotIndex")
    ground_id = data.get("groundItemId")

    if unit_id is None or slot_index is None or ground_id is None:
        return

    u = find_unit(pid, unit_id)
    if not u:
        return

    slots = u.get("itemSlots") or [None, None, None, None, None]
    slot_index = int(slot_index)

    if slot_index < 0 or slot_index >= len(slots):
        return

    # slot must be empty
    if slots[slot_index] is not None:
        return

    # find ground item
    gi_index = next((i for i, g in enumerate(ground_items) if g.get("id") == ground_id), None)
    if gi_index is None:
        return

    gi = ground_items[gi_index]

    # distance check (server authoritative)
    if dist_xy(u["x"], u["y"], gi["x"], gi["y"]) > PICKUP_DISTANCE:
        return

    # ✅ remove from ground IN-PLACE (no reassignment issues)
    ground_items.pop(gi_index)

    # persist ground items
    with ground_lock:
        save_ground()

    # equip
    slots[slot_index] = {
        "id": str(uuid.uuid4()),
        "name": gi.get("name", "item"),
        "bonus": gi.get("bonus", 0)
    }
    u["itemSlots"] = slots

    # Recompute stats after equip
    apply_unit_stats(u, owner_sid=pid, broadcast_hp=True)

    # ✅ broadcast new ground list to everyone
    socketio.emit("ground_items", ground_items)

    # ✅ owner gets equipment refresh
    socketio.emit("unit_slots_update", {"unitId": unit_id, "itemSlots": slots}, to=request.sid)

    # persist ground items
    with ground_lock:
        save_ground()

    # ✅ optional but recommended: hard-sync state so late-joiners / state-only clients match
    emit_state()


@socketio.on("collect_resource")
def on_collect_resource(data):
    pid = require_player_id()
    if not pid:
        return
    # Expecting: { amount: 1, type: 'red', resourceId: <id> }
    rtype = data.get("type") or "red"
    try:
        amount = int(data.get("amount", 1))
    except Exception:
        amount = 1

    resource_id = data.get("resourceId")

    p = players.get(pid)
    if not p:
        return

    if "resources" not in p or not isinstance(p["resources"], dict):
        p["resources"] = {"red": 0, "green": 0, "blue": 0}

    if resource_id is None:
        # fallback: just credit player (legacy clients)
        p["resources"][rtype] = p["resources"].get(rtype, 0) + amount
        emit_state()
        return

    # remove resource from authoritative list if present
    removed = False
    with resources_lock:
        idx = next((i for i, rr in enumerate(resources) if rr.get("id") == resource_id), None)
        if idx is not None:
            # pop the resource and persist
            resources.pop(idx)
            save_resources()
            removed = True

    if removed:
        # credit player
        p["resources"][rtype] = p["resources"].get(rtype, 0) + amount
        # broadcast updated resources and state to all clients
        socketio.emit("resources", resources)
        emit_state()
    else:
        # resource not found; still send state to keep client in sync
        emit_state()



@socketio.on("attack_unit")
def handle_attack_unit(data):
    target_sid = data.get("targetSid")
    target_id  = data.get("unitId")
    attacker_id = data.get("attackerId")

    attacker_owner = current_player_id()

    # Recompute damage server-side based on attacker's items
    damage = None
    if attacker_id:
        attacker = find_unit(attacker_owner, attacker_id)
        if attacker:
            stats = compute_unit_stats(attacker)
            damage = stats["dps"] / TICKS_PER_SECOND

    if damage is None:
        try:
            damage = float(data.get("damage", 0))
        except (TypeError, ValueError):
            return

    if not target_sid or target_sid not in players:
        return

    units = players[target_sid].get("units", [])
    target = next((u for u in units if u.get("id") == target_id), None)
    if not target:
        return

    target["hp"] = max(0, float(target.get("hp", 100)) - damage)

    socketio.emit("unit_hp_update", {
        "sid": target_sid,
        "unitId": target["id"],
        "hp": target["hp"]
    })

    if target["hp"] <= 0:
        players[target_sid]["units"] = [u for u in units if u.get("hp", 0) > 0]
        socketio.emit("update_units", {
            "sid": target_sid,
            "units": players[target_sid]["units"]
        })
        emit_state()


@socketio.on("attack_entity")
def handle_attack_entity(data):
    # data: { entityId, damage }
    entity_id = data.get("entityId")
    attacker_id = data.get("attackerId")
    attacker_owner = current_player_id()

    damage = None
    if attacker_id:
        attacker = find_unit(attacker_owner, attacker_id)
        if attacker:
            stats = compute_unit_stats(attacker)
            damage = stats["dps"] / TICKS_PER_SECOND

    if damage is None:
        try:
            damage = float(data.get("damage", 0))
        except (TypeError, ValueError):
            return

    if not entity_id:
        return

    with map_lock:
        ent = next((m for m in map_objects if m.get("id") == entity_id), None)
        if not ent:
            return
        # only entities with meta.entity may be attacked
        if not ent.get("meta", {}).get("entity"):
            return
        # only entities that have an HP value (buildings) are damageable
        if ent.get("hp") is None:
            return

        # subtract HP
        ent["hp"] = max(0, float(ent.get("hp", 0)) - damage)

        # broadcast HP update for entity
        socketio.emit("entity_hp_update", {"entityId": entity_id, "hp": ent["hp"]})

        # if destroyed, remove from map_objects
        if ent["hp"] <= 0:
            map_objects[:] = [o for o in map_objects if o.get("id") != entity_id]
            save_map()
            socketio.emit("map_objects", map_objects)
            emit_state()
        else:
            # persist change
            save_map()


@socketio.on("request_state")
def on_request_state():
    emit_state(to_sid=request.sid)


@socketio.on("update_units")
def on_update_units(data):
    pid = require_player_id()
    if not pid:
        return
    incoming = data.get("units", []) or []

    p = players.get(pid)
    if not p:
        return

    units = p.get("units") or []
    by_id = {u.get("id"): u for u in units if isinstance(u, dict) and u.get("id")}

    for u in incoming:
        if not isinstance(u, dict):
            continue

        uid = u.get("id")
        if not uid:
            continue

        su = by_id.get(uid)

        # ✅ IMPORTANT: ignore unknown unit IDs (prevents resurrecting killed units)
        if su is None:
            continue

        # ✅ update only movement/anim fields (hp stays server-authoritative)
        su["x"] = float(u.get("x", su.get("x", 0)))
        su["y"] = float(u.get("y", su.get("y", 0)))
        su["tx"] = float(u.get("tx", su.get("tx", su["x"])))
        su["ty"] = float(u.get("ty", su.get("ty", su["y"])))
        su["anim"] = u.get("anim", su.get("anim", "idle"))
        su["dir"]  = u.get("dir",  su.get("dir", "000"))

    # keep top-level position synced
    if units:
        p["x"] = float(units[0].get("x", p.get("x", 0)))
        p["y"] = float(units[0].get("y", p.get("y", 0)))

    socketio.emit("update_units", {"sid": pid, "units": units})




@socketio.on("place_building")
def place_building(data):
    pid = require_player_id()
    if not pid:
        return
    buildings.append({"x": data["x"], "y": data["y"], "owner": pid})
    emit_state()


@socketio.on("unit_give_to_entity")
def handle_unit_give_to_entity(data):
    pid = require_player_id()
    if not pid:
        return
    print(f"[unit_give_to_entity] called by player={pid} data={data}", flush=True)
    unit_id = data.get("unitId")
    unit_slot_index = int(data.get("unitSlotIndex", -1))
    entity_id = data.get("entityId")
    entity_slot_index = int(data.get("entitySlotIndex", -1))

    if not unit_id or unit_slot_index < 0 or not entity_id or entity_slot_index < 0:
        print(f"[unit_give_to_entity] invalid args: unit_id={unit_id} unit_slot_index={unit_slot_index} entity_id={entity_id} entity_slot_index={entity_slot_index}", flush=True)
        socketio.emit("server_debug", {"msg": "unit_give_to_entity: invalid args"}, to=request.sid)
        return

    u = find_unit(pid, unit_id)
    if not u:
        print(f"[unit_give_to_entity] unit not found for player={pid} unit_id={unit_id}", flush=True)
        socketio.emit("server_debug", {"msg": "unit_give_to_entity: unit not owned by you"}, to=request.sid)
        return

    slots = u.get("itemSlots") or [None, None, None, None, None]
    if unit_slot_index >= len(slots):
        print(f"[unit_give_to_entity] unit_slot_index out of range: {unit_slot_index} >= {len(slots)}", flush=True)
        socketio.emit("server_debug", {"msg": "unit_give_to_entity: slot index out of range"}, to=request.sid)
        return
    item = slots[unit_slot_index]
    if not item:
        print(f"[unit_give_to_entity] no item in unit slot {unit_slot_index}", flush=True)
        socketio.emit("server_debug", {"msg": "unit_give_to_entity: no item in that slot"}, to=request.sid)
        return

    # find entity
    with map_lock:
        ent = next((m for m in map_objects if m.get("id") == entity_id), None)
        if not ent:
            print(f"[unit_give_to_entity] entity not found: {entity_id}", flush=True)
            socketio.emit("server_debug", {"msg": "unit_give_to_entity: entity not found"}, to=request.sid)
            return
        eslots = ent.get("itemSlots") or []
        # expand if needed
        if entity_slot_index >= len(eslots):
            eslots += [None] * (entity_slot_index + 1 - len(eslots))
        if eslots[entity_slot_index] is not None:
            print(f"[unit_give_to_entity] entity slot occupied: {entity_slot_index}", flush=True)
            socketio.emit("server_debug", {"msg": "unit_give_to_entity: entity slot already occupied"}, to=request.sid)
            return
        # transfer
        eslots[entity_slot_index] = item
        ent["itemSlots"] = eslots
        # remove from unit
        slots[unit_slot_index] = None
        u["itemSlots"] = slots
        save_map()

    print(f"[unit_give_to_entity] transfer success: unit {unit_id} slot {unit_slot_index} -> entity {entity_id} slot {entity_slot_index}", flush=True)
    socketio.emit("server_debug", {"msg": "unit_give_to_entity: transfer success"}, to=request.sid)

    # notify clients
    socketio.emit("map_objects", map_objects)
    socketio.emit("unit_slots_update", {"unitId": unit_id, "itemSlots": slots}, to=request.sid)


@socketio.on("ground_give_to_entity")
def handle_ground_give_to_entity(data):
    pid = require_player_id()
    if not pid:
        return
    print(f"[ground_give_to_entity] called by player={pid} data={data}", flush=True)
    entity_id = data.get("entityId")
    try:
        entity_slot_index = int(data.get("entitySlotIndex", -1))
    except Exception:
        entity_slot_index = -1
    ground_id = data.get("groundItemId")

    if not entity_id or entity_slot_index < 0 or not ground_id:
        print(f"[ground_give_to_entity] invalid args: entity_id={entity_id} slot={entity_slot_index} ground_id={ground_id}", flush=True)
        socketio.emit("server_debug", {"msg": "ground_give_to_entity: invalid args"}, to=request.sid)
        return

    # find ground item
    gi_index = next((i for i, g in enumerate(ground_items) if g.get("id") == ground_id), None)
    if gi_index is None:
        print(f"[ground_give_to_entity] ground item not found: {ground_id}", flush=True)
        socketio.emit("server_debug", {"msg": "ground_give_to_entity: ground item not found"}, to=request.sid)
        return

    gi = ground_items[gi_index]

    # find entity and transfer
    with map_lock:
        ent = next((m for m in map_objects if m.get("id") == entity_id), None)
        if not ent:
            print(f"[ground_give_to_entity] entity not found: {entity_id}", flush=True)
            socketio.emit("server_debug", {"msg": "ground_give_to_entity: entity not found"}, to=request.sid)
            return

        eslots = ent.get("itemSlots") or []
        if entity_slot_index >= len(eslots):
            eslots += [None] * (entity_slot_index + 1 - len(eslots))
        if eslots[entity_slot_index] is not None:
            print(f"[ground_give_to_entity] entity slot occupied: {entity_slot_index}", flush=True)
            socketio.emit("server_debug", {"msg": "ground_give_to_entity: entity slot occupied"}, to=request.sid)
            return

        # transfer ground item into entity slot, preserving any upgrade bonus
        eslots[entity_slot_index] = {
            "id": str(uuid.uuid4()),
            "name": gi.get("name"),
            "bonus": gi.get("bonus", 0)
        }
        ent["itemSlots"] = eslots

    # remove ground item
    ground_items.pop(gi_index)

    # persist changes
    with ground_lock:
        save_ground()
    with map_lock:
        save_map()

    print(f"[ground_give_to_entity] success: ground {ground_id} -> entity {entity_id} slot {entity_slot_index}", flush=True)
    socketio.emit("server_debug", {"msg": "ground_give_to_entity: transfer success"}, to=request.sid)

    # notify clients
    socketio.emit("map_objects", map_objects)
    socketio.emit("ground_items", ground_items)


@socketio.on("smith_upgrade_item")
def handle_smith_upgrade_item(data):
    pid = require_player_id()
    if not pid:
        return
    entity_id = data.get("entityId")
    try:
        slot_index = int(data.get("slotIndex", 0))
    except Exception:
        slot_index = 0

    cost_blue = 3

    p = players.get(pid)
    if not p:
        socketio.emit("smith_upgrade_result", {"entityId": entity_id, "success": False, "error": "Player not found"}, to=request.sid)
        socketio.emit("server_debug", {"msg": "Player not found for smith upgrade"}, to=request.sid)
        return
    if p.get("resources", {}).get("blue", 0) < cost_blue:
        socketio.emit("smith_upgrade_result", {"entityId": entity_id, "success": False, "error": "Not enough blue (3)"}, to=request.sid)
        socketio.emit("server_debug", {"msg": "Not enough blue resources to upgrade item (requires 3)"}, to=request.sid)
        return

    with map_lock:
        ent = next((m for m in map_objects if m.get("id") == entity_id), None)
        if not ent:
            socketio.emit("smith_upgrade_result", {"entityId": entity_id, "success": False, "error": "Blacksmith not found"}, to=request.sid)
            socketio.emit("server_debug", {"msg": "Blacksmith not found"}, to=request.sid)
            return
        if ent.get("kind") != "blacksmith":
            socketio.emit("smith_upgrade_result", {"entityId": entity_id, "success": False, "error": "Upgrade allowed only on blacksmith"}, to=request.sid)
            socketio.emit("server_debug", {"msg": "Upgrade allowed only on blacksmith"}, to=request.sid)
            return
        if ent.get("owner") and ent.get("owner") != pid:
            socketio.emit("smith_upgrade_result", {"entityId": entity_id, "success": False, "error": "Only the owner can use this blacksmith"}, to=request.sid)
            socketio.emit("server_debug", {"msg": "Only the owner can use this blacksmith"}, to=request.sid)
            return

        slots = ent.get("itemSlots") or []
        # guarantee at least one slot so upgrades always have a target
        if len(slots) == 0:
            slots = [None]
        if slot_index < 0 or slot_index >= len(slots):
            socketio.emit("smith_upgrade_result", {"entityId": entity_id, "success": False, "error": "Blacksmith slot unavailable"}, to=request.sid)
            socketio.emit("server_debug", {"msg": "Blacksmith slot unavailable"}, to=request.sid)
            return
        item = slots[slot_index]
        if not item:
            socketio.emit("smith_upgrade_result", {"entityId": entity_id, "success": False, "error": "Place an item into the blacksmith slot first"}, to=request.sid)
            socketio.emit("server_debug", {"msg": "Place an item into the blacksmith slot first"}, to=request.sid)
            return

        # normalize legacy items that may be plain strings
        if isinstance(item, str):
            item = {"id": str(uuid.uuid4()), "name": item}
        elif not isinstance(item, dict):
            item = {"id": str(uuid.uuid4()), "name": str(item)}

        # Deduct cost
        p.setdefault("resources", {"red": 0, "green": 0, "blue": 0})
        p["resources"]["blue"] = max(0, p["resources"].get("blue", 0) - cost_blue)

        # Apply upgrade
        try:
            current_bonus = int(item.get("bonus", 0))
        except Exception:
            current_bonus = 0
        current_bonus = max(0, current_bonus)
        item["bonus"] = current_bonus + 1
        slots[slot_index] = item
        ent["itemSlots"] = slots
        save_map()
        new_bonus = item.get("bonus", 0)

    # broadcast updated map and state (for resource counts)
    socketio.emit("map_objects", map_objects)
    emit_state()
    socketio.emit("server_debug", {"msg": f"Upgraded item to bonus +{new_bonus}"}, to=request.sid)
    socketio.emit("smith_upgrade_result", {"entityId": entity_id, "success": True, "bonus": new_bonus}, to=request.sid)


@socketio.on("entity_give_to_unit")
def handle_entity_give_to_unit(data):
    pid = require_player_id()
    if not pid:
        return
    entity_id = data.get("entityId")
    entity_slot_index = int(data.get("entitySlotIndex", -1))
    unit_id = data.get("unitId")
    unit_slot_index = int(data.get("slotIndex", -1))

    if not unit_id or unit_slot_index < 0 or not entity_id or entity_slot_index < 0:
        return

    p = players.get(pid)
    if not p: return

    u = find_unit(pid, unit_id)
    if not u: return

    with map_lock:
        ent = next((m for m in map_objects if m.get("id") == entity_id), None)
        if not ent: return
        eslots = ent.get("itemSlots") or []
        if entity_slot_index >= len(eslots): return
        item = eslots[entity_slot_index]
        if not item: return
        # distance check
        # NOTE: allow transfers to entities regardless of distance (no drop radius)
        # make sure unit slot empty
        uslots = u.get("itemSlots") or [None, None, None, None, None]
        if unit_slot_index >= len(uslots): return
        if uslots[unit_slot_index] is not None: return
        # transfer
        uslots[unit_slot_index] = {
            "id": str(uuid.uuid4()),
            "name": item.get("name"),
            "bonus": item.get("bonus", 0)
        }
        u["itemSlots"] = uslots
        eslots[entity_slot_index] = None
        ent["itemSlots"] = eslots
        save_map()

    # notify clients
    socketio.emit("map_objects", map_objects)
    socketio.emit("unit_slots_update", {"unitId": unit_id, "itemSlots": uslots}, to=request.sid)


@socketio.on("entity_give_to_ground")
def handle_entity_give_to_ground(data):
    pid = require_player_id()
    if not pid:
        return
    entity_id = data.get("entityId")
    try:
        entity_slot_index = int(data.get("entitySlotIndex", -1))
    except Exception:
        entity_slot_index = -1
    x = data.get("x")
    y = data.get("y")

    if not entity_id or entity_slot_index < 0 or x is None or y is None:
        print(f"[entity_give_to_ground] invalid args: entity_id={entity_id} slot={entity_slot_index} x={x} y={y}", flush=True)
        socketio.emit("server_debug", {"msg": "entity_give_to_ground: invalid args"}, to=request.sid)
        return

    with map_lock:
        ent = next((m for m in map_objects if m.get("id") == entity_id), None)
        if not ent:
            print(f"[entity_give_to_ground] entity not found: {entity_id}", flush=True)
            socketio.emit("server_debug", {"msg": "entity_give_to_ground: entity not found"}, to=request.sid)
            return
        eslots = ent.get("itemSlots") or []
        if entity_slot_index >= len(eslots):
            print(f"[entity_give_to_ground] slot index out of range: {entity_slot_index}", flush=True)
            socketio.emit("server_debug", {"msg": "entity_give_to_ground: slot index out of range"}, to=request.sid)
            return
        item = eslots[entity_slot_index]
        if not item:
            print(f"[entity_give_to_ground] no item in slot {entity_slot_index}", flush=True)
            socketio.emit("server_debug", {"msg": "entity_give_to_ground: no item in that slot"}, to=request.sid)
            return

        # remove from entity slot
        eslots[entity_slot_index] = None
        ent["itemSlots"] = eslots

    # create ground item at provided coords
    gi = {
        "id": str(uuid.uuid4()),
        "name": item.get("name", "item"),
        "bonus": item.get("bonus", 0),
        "x": float(x),
        "y": float(y)
    }
    ground_items.append(gi)

    # persist
    with ground_lock:
        save_ground()
    with map_lock:
        save_map()

    print(f"[entity_give_to_ground] success: entity {entity_id} slot {entity_slot_index} -> ground {gi['id']}", flush=True)
    socketio.emit("server_debug", {"msg": "entity_give_to_ground: transfer success"}, to=request.sid)

    # notify clients
    socketio.emit("map_objects", map_objects)
    socketio.emit("ground_items", ground_items)

def mine_production_loop():
    tick_count = 0
    first_run = True
    while True:
        socketio.sleep(1)
        now = time.time()
        changed = False
        tick_count += 1
        
        with map_lock:
            mine_count = len([o for o in map_objects if o.get("kind") == "mine"])
        
        # Log every 30 ticks to avoid spam, and first run
        if tick_count % 30 == 0 or (first_run and mine_count > 0):
            print(f"[MINE_LOOP] Tick {tick_count}: {len(map_objects)} total objects, {mine_count} mines", flush=True)
            first_run = False
        
        with map_lock:
            for o in map_objects:
                if o.get("kind") == "mine":
                    m = o.get("meta", {})
                    entity_flag = m.get("entity", False)
                    
                    if not entity_flag:
                        if tick_count == 1:
                            print(f"[MINE_LOOP] Mine {o.get('id')}: entity flag not set, normalizing and continuing", flush=True)
                        m["entity"] = True
                        # Backfill defaults so the mine can start ticking
                        mine_meta = m.setdefault("mine", {})
                        mine_meta.setdefault("resource", "red")
                        m.setdefault("interval", 30)
                        m.setdefault("nextTick", now + int(m.get("interval", 30)))
                        changed = True
                        continue
                    
                    interval = int(m.get("interval", 30))
                    next_tick = float(m.get("nextTick", now + interval))
                    time_until = next_tick - now
                    
                    # Log every tick for debugging
                    if tick_count <= 5 or (tick_count % 10 == 0 and time_until < 5):
                        print(f"[MINE_LOOP] Tick {tick_count} Mine {o.get('id')}: time_until={time_until:.1f}s", flush=True)
                    
                    if now >= next_tick:
                        owner = o.get("owner")
                        rtype = (m.get("mine", {}) or {}).get("resource", "red")
                        print(f"[MINE_PRODUCE] Mine {o.get('id')} TRIGGERED! owner={owner}, resource={rtype}", flush=True)
                        
                        # Award resource to owner
                        if owner:
                            # Ensure player entry exists with full shape so client keeps it
                            if owner not in players:
                                print(f"[MINE_PRODUCE] Owner {owner[:8]} not in players, creating entry", flush=True)
                                players[owner] = {
                                    "resources": {"red": 0, "green": 0, "blue": 0},
                                    "units": [],
                                    "x": 0,
                                    "y": 0,
                                    "color": "#fff",
                                }
                            # If entry exists but missing fields, patch them
                            players[owner].setdefault("resources", {"red": 0, "green": 0, "blue": 0})
                            players[owner].setdefault("units", [])
                            players[owner].setdefault("x", 0)
                            players[owner].setdefault("y", 0)
                            players[owner].setdefault("color", "#fff")

                            pr = players[owner]["resources"]
                            old_val = pr.get(rtype, 0)
                            pr[rtype] = old_val + 1
                            print(f"[MINE_PRODUCE] Awarded +1 {rtype} to {owner[:8]}. {rtype}: {old_val} -> {pr[rtype]}", flush=True)
                        else:
                            print(f"[MINE_PRODUCE] No owner for mine {o.get('id')}", flush=True)
                        
                        # Schedule next tick
                        m["nextTick"] = now + interval
                        print(f"[MINE_PRODUCE] Next tick scheduled for {now + interval}", flush=True)
                        changed = True
            
            if changed:
                save_map()
                print(f"[MINE_PRODUCE] Map saved, triggering emit_state", flush=True)
        
        if changed:
            emit_state()

def npc_movement_loop():
    """Background task that moves NPCs along their waypoint paths."""
    NPC_SPEED = 1.0  # pixels per tick (reduced for slower walk)
    SPIDER_ATTACK_RANGE = 200  # pixels
    SPIDER_RETURN_RANGE = 400  # pixels - return to waypoints if target is this far
    tick_count = 0
    
    def check_collision(x, y, entity_id):
        """Check if position collides with any entity."""
        for obj in map_objects:
            if obj.get("id") == entity_id:
                continue  # Skip self
            if not obj.get("meta", {}).get("collides"):
                continue
            
            # Get collision box dimensions
            cx = obj.get("x", 0) + obj.get("meta", {}).get("cx", 0)
            cy = obj.get("y", 0) + obj.get("meta", {}).get("cy", 0)
            cw = obj.get("meta", {}).get("cw", 0)
            ch = obj.get("meta", {}).get("ch", 0)
            
            # Check if position is inside collision box
            if (abs(x - cx) < cw/2 + 20 and 
                abs(y - cy) < ch/2 + 20):
                return True
        return False
    
    while True:
        socketio.sleep(0.016)  # ~60 FPS
        tick_count += 1
        
        with map_lock:
            changed = False
            npc_count = 0
            for o in map_objects:
                # Support both 'npc' and 'spider' kinds
                if o.get("kind") not in ["npc", "spider"]:
                    continue
                
                npc_count += 1
                m = o.get("meta", {})
                waypoints = m.get("waypoints", [])
                if len(waypoints) < 2:
                    if tick_count % 600 == 0:  # Log every 10 seconds
                        print(f"[NPC_LOOP] NPC {o.get('id')[:8]} has insufficient waypoints ({len(waypoints)})", flush=True)
                    continue
                
                # Spider AI: attack nearby players
                is_spider = (o.get("kind") == "spider")
                target_player = None
                
                if is_spider:
                    # Find nearest player unit
                    nearest_dist = SPIDER_ATTACK_RANGE
                    for sid, p in players.items():
                        for unit in p.get("units", []):
                            if unit.get("hp", 0) <= 0:
                                continue
                            dist = math.hypot(unit["x"] - o["x"], unit["y"] - o["y"])
                            if dist < nearest_dist:
                                nearest_dist = dist
                                target_player = {"sid": sid, "unit": unit, "dist": dist}
                    
                    # Check if current target is too far (return to waypoints)
                    if target_player and m.get("chasing"):
                        if target_player["dist"] > SPIDER_RETURN_RANGE:
                            target_player = None
                            m["chasing"] = False
                
                # If spider has a target, chase and attack
                if is_spider and target_player:
                    m["chasing"] = True
                    tx = target_player["unit"]["x"]
                    ty = target_player["unit"]["y"]
                    
                    dx = tx - o["x"]
                    dy = ty - o["y"]
                    dist = math.hypot(dx, dy)
                    
                    # Move towards player
                    if dist > 30:  # Stop when close enough
                        new_x = o["x"] + (dx / dist) * NPC_SPEED
                        new_y = o["y"] + (dy / dist) * NPC_SPEED
                        
                        # Only move if not colliding
                        if not check_collision(new_x, new_y, o.get("id")):
                            o["x"] = new_x
                            o["y"] = new_y
                            changed = True
                    
                    # Update direction
                    if dist > 0.1:
                        angle_deg = (math.degrees(math.atan2(dy, dx)) + 90) % 360
                        directions = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337]
                        closest_dir = min(directions, key=lambda d: min(abs(angle_deg - d), abs(angle_deg - d + 360), abs(angle_deg - d - 360)))
                        m["dir"] = str(closest_dir).zfill(3)
                        m["anim"] = "walk"
                else:
                    # Follow waypoints (default behavior for NPCs and spiders without targets)
                    m["chasing"] = False
                    current_idx = m.get("currentWaypointIndex", 0)
                    if current_idx >= len(waypoints):
                        current_idx = 0
                        m["currentWaypointIndex"] = current_idx
                    
                    target_wp = waypoints[current_idx]
                    tx, ty = target_wp["x"], target_wp["y"]
                    
                    # Move towards target
                    dx = tx - o["x"]
                    dy = ty - o["y"]
                    dist = math.hypot(dx, dy)
                    
                    if dist < NPC_SPEED:
                        # Reached waypoint, move to next
                        o["x"] = tx
                        o["y"] = ty
                        m["currentWaypointIndex"] = (current_idx + 1) % len(waypoints)
                        changed = True
                    else:
                        # Move towards waypoint with collision checking
                        new_x = o["x"] + (dx / dist) * NPC_SPEED
                        new_y = o["y"] + (dy / dist) * NPC_SPEED
                        
                        # Only move if not colliding
                        if not check_collision(new_x, new_y, o.get("id")):
                            o["x"] = new_x
                            o["y"] = new_y
                            changed = True
                        else:
                            # Try to slide around obstacle
                            # Try moving only in X direction
                            if not check_collision(new_x, o["y"], o.get("id")):
                                o["x"] = new_x
                                changed = True
                            # Try moving only in Y direction
                            elif not check_collision(o["x"], new_y, o.get("id")):
                                o["y"] = new_y
                                changed = True
                    
                    # Update direction for animation (match client getDirKey logic)
                    if dist > 0.1:
                        # Match client: atan2(dy, dx) * 180/PI + 90
                        angle_deg = (math.degrees(math.atan2(dy, dx)) + 90) % 360
                        # Snap to nearest direction (16 directions)
                        directions = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337]
                        closest_dir = min(directions, key=lambda d: min(abs(angle_deg - d), abs(angle_deg - d + 360), abs(angle_deg - d - 360)))
                        m["dir"] = str(closest_dir).zfill(3)
                        m["anim"] = "walk"
                    else:
                        m["anim"] = "idle"
            
            # Log NPC count periodically
            if tick_count % 600 == 0 and npc_count > 0:  # Every 10 seconds
                print(f"[NPC_LOOP] Tick {tick_count}: {npc_count} NPCs active", flush=True)
            
            if changed:
                # Save periodically (every 60 ticks / 1 second)
                if not hasattr(npc_movement_loop, '_tick_counter'):
                    npc_movement_loop._tick_counter = 0
                npc_movement_loop._tick_counter += 1
                
                if npc_movement_loop._tick_counter % 60 == 0:
                    save_map()
        
        if changed:
            # Debug: check if spider has hp before emitting
            for o in map_objects:
                if o.get("kind") == "spider":
                    print(f"[NPC_LOOP] Emitting spider {o.get('id')[:8]} hp={o.get('hp')} maxHp={o.get('maxHp')}", flush=True)
                    break
            socketio.emit("map_objects", map_objects)

# Run server
if __name__ == "__main__":
    ensure_mine_loop_started()
    ensure_npc_loop_started()
    socketio.run(app, host="0.0.0.0", port=8080)
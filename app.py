from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO
import random
import time
import uuid
import math

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# State


players = {}     # sid -> {x, y, color}
buildings = []   # list of {x, y, owner}

ground_items = []  # [{id, name, x, y}]
PICKUP_DISTANCE = 120

def find_unit(sid, unit_id):
    p = players.get(sid)
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
        {"id": str(uuid.uuid4()), "name": "shield"}
    ]




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
        "ground_items": ground_items
    }
    if to_sid:
        socketio.emit("state", state, to=to_sid)
    else:
        socketio.emit("state", state)


# Socket events
@socketio.on("connect")
def on_connect():
    sid = request.sid

    players[sid] = {
        "x": 0,
        "y": 0,
        "color": random_color(),
        "units": [{
            "id": str(uuid.uuid4()),
            "x": 0, "y": 0,
            "tx": 0, "ty": 0,
            "hp": 100,
            "anim": "idle",
            "dir": "000",
            "itemSlots": make_default_slots()
        }]
    }

    if not trees:
        generate_trees(100)

    # send full state to the new client
    emit_state(to_sid=sid)
    emit_trees(sid)

    # also broadcast to everyone so they see the new player immediately
    emit_state()



@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid

    # Remove player
    if sid in players:
        players.pop(sid)

    # Remove their buildings
    global buildings
    buildings = [b for b in buildings if b["owner"] != sid]

    # Tell ALL clients to hard-sync
    emit_state()


@socketio.on("update")
def on_update(data):
    sid = request.sid
    if sid in players:
        players[sid]["x"] = data.get("x", players[sid]["x"])
        players[sid]["y"] = data.get("y", players[sid]["y"])
    emit_state()

@socketio.on("spawn_unit")
def spawn_unit(data):
    sid = request.sid
    if sid not in players:
        return

    unit = data.get("unit", {})

    new_unit = {
        "id": str(uuid.uuid4()),
        "x": unit.get("x", 0),
        "y": unit.get("y", 0),
        "tx": unit.get("x", 0),
        "ty": unit.get("y", 0),
        "hp": 100,
        "anim": "idle",
        "dir": "000",
        "itemSlots": make_default_slots()
    }

    players[sid]["units"].append(new_unit)

    socketio.emit("update_units", {"sid": sid, "units": players[sid]["units"]})

@socketio.on("drop_item")
def on_drop_item(data):
    global ground_items
    sid = request.sid
    unit_id = data.get("unitId")
    slot_index = data.get("slotIndex")
    x = data.get("x")
    y = data.get("y")

    if unit_id is None or slot_index is None or x is None or y is None:
        return

    u = find_unit(sid, unit_id)
    if not u:
        return

    slots = u.get("itemSlots") or [None, None]
    if not (0 <= int(slot_index) < len(slots)):
        return

    slot_index = int(slot_index)
    item = slots[slot_index]
    if not item:
        return

    # remove item from unit
    slots[slot_index] = None
    u["itemSlots"] = slots

    # create ground item
    gi = {
        "id": str(uuid.uuid4()),
        "name": item.get("name", "item"),
        "x": float(x),
        "y": float(y)
    }
    ground_items.append(gi)

    # everyone sees it
    socketio.emit("ground_items", ground_items)

    # only the owner needs equipment UI refresh
    socketio.emit("unit_slots_update", {"unitId": unit_id, "itemSlots": slots}, to=sid)


@socketio.on("pickup_item")
def on_pickup_item(data):
    sid = request.sid

    unit_id = data.get("unitId")
    slot_index = data.get("slotIndex")
    ground_id = data.get("groundItemId")

    if unit_id is None or slot_index is None or ground_id is None:
        return

    u = find_unit(sid, unit_id)
    if not u:
        return

    slots = u.get("itemSlots") or [None, None]
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

    # equip
    slots[slot_index] = {
        "id": str(uuid.uuid4()),
        "name": gi.get("name", "item")
    }
    u["itemSlots"] = slots

    # ✅ broadcast new ground list to everyone
    socketio.emit("ground_items", ground_items)

    # ✅ owner gets equipment refresh
    socketio.emit("unit_slots_update", {"unitId": unit_id, "itemSlots": slots}, to=sid)

    # ✅ optional but recommended: hard-sync state so late-joiners / state-only clients match
    emit_state()



@socketio.on("attack_unit")
def handle_attack_unit(data):
    target_sid = data.get("targetSid")
    target_id = data.get("unitId")
    damage = data.get("damage", 0)

    if target_sid not in players:
        return

    units = players[target_sid]["units"]
    target = next((u for u in units if u["id"] == target_id), None)
    if not target:
        return

    # Apply damage
    target["hp"] -= damage
    if target["hp"] <= 0:
        target["hp"] = 0
        target["dead"] = True
        target["anim"] = "idle"

    # 🔥 Emit HP update **before removing** dead unit
    socketio.emit("unit_hp_update", {
        "sid": target_sid,
        "unitId": target["id"],
        "hp": target["hp"]
    })

    # Remove dead units from server state
    players[target_sid]["units"] = [u for u in units if u["hp"] > 0]

    # Optional: emit full unit list for clients to resync
    socketio.emit("update_units", {
        "sid": target_sid,
        "units": players[target_sid]["units"]
    })




@socketio.on("update_units")
def on_update_units(data):
    sid = request.sid
    if sid not in players:
        return

    client_units = data.get("units", [])
    server_units = players[sid].get("units", [])

    # map server units by id
    by_id = {u.get("id"): u for u in server_units}

    for cu in client_units:
        uid = cu.get("id")
        if not uid or uid not in by_id:
            continue

        su = by_id[uid]

        su["x"] = cu.get("x", su["x"])
        su["y"] = cu.get("y", su["y"])
        su["tx"] = cu.get("tx", su.get("tx", 0))
        su["ty"] = cu.get("ty", su.get("ty", 0))
        su["dir"] = cu.get("dir", su.get("dir", "000"))

        if cu.get("anim") and cu["anim"] != su.get("anim"):
            su["anim"] = cu["anim"]

        # keep su["itemSlots"] server-side; do NOT accept client changes to equipment

    socketio.emit("update_units", {"sid": sid, "units": server_units})



@socketio.on("place_building")
def place_building(data):
    sid = request.sid
    buildings.append({"x": data["x"], "y": data["y"], "owner": sid})
    emit_state()

# Run server
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8080)
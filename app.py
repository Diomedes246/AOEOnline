from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO
import random
import time
import uuid

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# State


players = {}     # sid -> {x, y, color}
buildings = []   # list of {x, y, owner}



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
def emit_state():
    socketio.emit("state", {"players": players, "buildings": buildings})

# Socket events
@socketio.on("connect")
def on_connect():
    sid = request.sid
    # Add player
    players[sid] = {
    "x": 0,
    "y": 0,
    "color": random_color(),
    "units": [{
        "id": str(uuid.uuid4()),
        "x": 0,
        "y": 0,
        "tx": 0,
        "ty": 0,
        "hp": 100,
        "anim": "idle",
        "dir": "000"
    }]
}
    
    # Generate trees once
    if not trees:
        generate_trees(100)  # for example, 100 trees

    # Send current state and trees
    emit_state()
    emit_trees(sid)



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
    socketio.emit("state", {
        "players": players,
        "buildings": buildings
    })

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
        "id": str(uuid.uuid4()),   # ⭐ SERVER GENERATED
        "x": unit.get("x", 0),
        "y": unit.get("y", 0),
        "tx": unit.get("x", 0),
        "ty": unit.get("y", 0),
        "hp": 100,
        "anim": "idle",
        "dir": "000"
    }

    players[sid]["units"].append(new_unit)

    socketio.emit("update_units", {
        "sid": sid,
        "units": players[sid]["units"]
    })



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

    for i, cu in enumerate(client_units):
        if i >= len(server_units):
            continue

        su = server_units[i]

        # Position updates are OK
        su["x"] = cu.get("x", su["x"])
        su["y"] = cu.get("y", su["y"])
        su["tx"] = cu.get("tx", su.get("tx", 0))
        su["ty"] = cu.get("ty", su.get("ty", 0))
        su["dir"] = cu.get("dir", su.get("dir", "000"))

        # ⚠️ ONLY change anim if different
        if cu.get("anim") and cu["anim"] != su.get("anim"):
            su["anim"] = cu["anim"]

        # NEVER sync frames
        # NEVER sync attackFrame
        # NEVER sync selected

    socketio.emit("update_units", {
        "sid": sid,
        "units": server_units
    })


@socketio.on("place_building")
def place_building(data):
    sid = request.sid
    buildings.append({"x": data["x"], "y": data["y"], "owner": sid})
    emit_state()

# Run server
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8080)